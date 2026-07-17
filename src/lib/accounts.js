import { deleteLocalAccount, listLocalAccounts, saveLocalAccount } from './localVault.js'

const REQUEST_TIMEOUT = 30_000
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CLAUDE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
const CLAUDE_SCOPE = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
const GEMINI_REDIRECT_URI = 'https://codeassist.google.com/authcode'
const GEMINI_SCOPE = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const GROK_REDIRECT_URI = 'http://127.0.0.1:56121/callback'
const GROK_SCOPE = 'openid profile email offline_access grok-cli:access api:access'

function apiUrl(base, path) {
  return `${String(base || '').trim().replace(/\/$/, '')}${path}`
}

async function request(base, path, options = {}) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetch(apiUrl(base, path), {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new Error('订阅授权服务返回了无法识别的响应')
    }
    if (!response.ok && response.status !== 202) throw new Error(payload.error || `订阅授权服务返回 ${response.status}`)
    return payload
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('订阅授权服务连接超时')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomValue(length = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(length)))
}

async function pkce() {
  const verifier = randomValue(64)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

function extractCodeAndState(raw, fallbackState = '') {
  const value = String(raw || '').trim()
  if (!value) throw new Error('请粘贴授权码或完整回调地址')
  try {
    const url = new URL(value)
    return {
      code: url.searchParams.get('code') || '',
      state: url.searchParams.get('state') || fallbackState,
    }
  } catch {
    const [code, state] = value.split('#')
    return { code: code.trim(), state: (state || fallbackState).trim() }
  }
}

async function storeOAuthResult(payload) {
  if (!payload?.account || !payload?.credential) throw new Error('授权服务没有返回完整账号凭据')
  return saveLocalAccount({ ...payload.account, credential: payload.credential })
}

export function listSubscriptionAccounts() {
  return listLocalAccounts()
}

export function deleteSubscriptionAccount(_base, accountId) {
  return deleteLocalAccount(accountId)
}

export async function checkSubscriptionService(base) {
  let payload
  try {
    payload = await request(base, '/api/health')
  } catch (error) {
    if (/无法识别的响应/.test(error.message)) {
      throw new Error('没有检测到兼容的 OAuth 授权服务')
    }
    if (/Origin is not allowed/.test(error.message)) {
      throw new Error('当前站点不在 OAuth 授权服务的允许列表')
    }
    if (error instanceof TypeError) {
      throw new Error('无法连接 OAuth 授权服务，请检查地址和跨域设置')
    }
    throw error
  }

  if (payload?.service !== 'token-killer-community' || !payload.subscriptionOAuth) {
    throw new Error('当前地址不是兼容的 OAuth 授权服务')
  }

  const status = payload.subscriptionOAuth
  const providers = status === true
    ? { openai: true, claude: true, gemini: true, grok: true }
    : {
        openai: Boolean(status.providers?.openai),
        claude: Boolean(status.providers?.claude),
        gemini: Boolean(status.providers?.gemini),
        grok: Boolean(status.providers?.grok),
      }

  if (!Object.values(providers).some(Boolean)) {
    throw new Error('OAuth 授权服务尚未启用任何平台')
  }

  return { providers }
}

export function startChatGPTDeviceLogin(base) {
  return request(base, '/api/oauth/openai/device/start', { method: 'POST', body: '{}' })
}

export async function pollChatGPTDeviceLogin(base, session) {
  const payload = await request(base, '/api/oauth/openai/device/poll', {
    method: 'POST',
    body: JSON.stringify({ deviceAuthId: session.deviceAuthId, userCode: session.userCode }),
  })
  if (payload.status !== 'complete') return payload
  const account = await storeOAuthResult(payload)
  return { ...payload, account }
}

export async function startClaudeLogin() {
  const { verifier, challenge } = await pkce()
  const state = randomValue(24)
  const url = new URL('https://claude.ai/oauth/authorize')
  url.search = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: CLAUDE_REDIRECT_URI,
    scope: CLAUDE_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return { provider: 'claude', authorizationUrl: url.toString(), verifier, state, redirectUri: CLAUDE_REDIRECT_URI }
}

export async function finishClaudeLogin(base, session, callbackValue) {
  const parsed = extractCodeAndState(callbackValue, session.state)
  const payload = await request(base, '/api/oauth/claude/exchange', {
    method: 'POST',
    body: JSON.stringify({ code: parsed.code, state: parsed.state, expectedState: session.state, codeVerifier: session.verifier }),
  })
  return storeOAuthResult(payload)
}

export async function startGeminiLogin(base, projectId = '') {
  const config = await request(base, '/api/oauth/gemini/config')
  if (!config.clientId) throw new Error('Gemini OAuth 尚未配置')
  const { verifier, challenge } = await pkce()
  const state = randomValue(24)
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: GEMINI_REDIRECT_URI,
    scope: GEMINI_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  if (projectId.trim()) params.set('project_id', projectId.trim())
  return { provider: 'gemini', authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, verifier, state, projectId: projectId.trim(), redirectUri: GEMINI_REDIRECT_URI }
}

export async function finishGeminiLogin(base, session, callbackValue) {
  const parsed = extractCodeAndState(callbackValue, session.state)
  if (parsed.state && parsed.state !== session.state) throw new Error('Gemini OAuth state 不匹配，请重新发起登录')
  const payload = await request(base, '/api/oauth/gemini/exchange', {
    method: 'POST',
    body: JSON.stringify({ code: parsed.code, codeVerifier: session.verifier, projectId: session.projectId }),
  })
  return storeOAuthResult(payload)
}

export async function startGrokLogin() {
  const { verifier, challenge } = await pkce()
  const state = randomValue(24)
  const nonce = randomValue(24)
  const url = new URL('https://auth.x.ai/oauth2/authorize')
  url.search = new URLSearchParams({
    client_id: GROK_CLIENT_ID,
    response_type: 'code',
    redirect_uri: GROK_REDIRECT_URI,
    scope: GROK_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    plan: 'generic',
    referrer: 'token-killer',
  })
  return { provider: 'grok', authorizationUrl: url.toString(), verifier, state, redirectUri: GROK_REDIRECT_URI }
}

export async function finishGrokLogin(base, session, callbackValue) {
  const parsed = extractCodeAndState(callbackValue, session.state)
  if (parsed.state !== session.state) throw new Error('Grok OAuth state 不匹配，请重新发起登录')
  const payload = await request(base, '/api/oauth/grok/exchange', {
    method: 'POST',
    body: JSON.stringify({ code: parsed.code, codeVerifier: session.verifier }),
  })
  return storeOAuthResult(payload)
}

export function refreshSubscriptionCredential(base, provider, credential) {
  return request(base, `/api/oauth/${provider}/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken: credential.refreshToken }),
  })
}
