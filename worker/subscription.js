const OPENAI_AUTH_BASE_URL = 'https://auth.openai.com'
const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_DEVICE_CALLBACK_URL = `${OPENAI_AUTH_BASE_URL}/deviceauth/callback`
const OPENAI_CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CLAUDE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages?beta=true'

const GEMINI_REDIRECT_URI = 'https://codeassist.google.com/authcode'
const GEMINI_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GEMINI_CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com'
const GEMINI_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const GROK_REDIRECT_URI = 'http://127.0.0.1:56121/callback'
const GROK_TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const GROK_RESPONSES_URL = 'https://cli-chat-proxy.grok.com/v1/responses'

const MAX_ERROR_BODY = 8192
const MAX_PROMPT_LENGTH = 200_000

export function subscriptionConfigured() {
  return true
}

export async function handleSubscriptionApi(request, env, url, cors) {
  if (request.method === 'POST' && url.pathname === '/api/oauth/openai/device/start') {
    return startOpenAIDeviceLogin(cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/oauth/openai/device/poll') {
    return pollOpenAIDeviceLogin(request, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/oauth/openai/refresh') {
    return refreshOpenAI(request, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/oauth/claude/exchange') {
    return exchangeClaude(request, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/oauth/claude/refresh') {
    return refreshClaude(request, cors)
  }
  if (request.method === 'GET' && url.pathname === '/api/oauth/gemini/config') {
    const { clientId } = geminiOAuthConfig(env, false)
    return json({ clientId, redirectUri: GEMINI_REDIRECT_URI }, 200, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/oauth/gemini/exchange') {
    return exchangeGemini(request, env, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/oauth/gemini/refresh') {
    return refreshGemini(request, env, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/oauth/grok/exchange') {
    return exchangeGrok(request, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/oauth/grok/refresh') {
    return refreshGrok(request, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/subscription/openai/responses') {
    return proxyOpenAIResponses(request, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/subscription/claude/messages') {
    return proxyClaudeMessages(request, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/subscription/gemini/generate') {
    return proxyGeminiGenerate(request, cors)
  }
  if (request.method === 'POST' && url.pathname === '/api/subscription/grok/responses') {
    return proxyGrokResponses(request, cors)
  }

  throw httpError(404, 'Subscription route was not found.')
}

async function startOpenAIDeviceLogin(cors) {
  const upstream = await fetch(`${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: openAIAuthHeaders('application/json'),
    body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
  })
  const payload = await readUpstreamJson(upstream, 'OpenAI device-code request')
  const deviceAuthId = safeText(payload.device_auth_id, 512)
  const userCode = safeText(payload.user_code ?? payload.usercode, 128)
  if (!deviceAuthId || !userCode) throw httpError(502, 'OpenAI did not return a usable device code.')
  return json(
    {
      provider: 'openai',
      verificationUrl: `${OPENAI_AUTH_BASE_URL}/codex/device`,
      deviceAuthId,
      userCode,
      intervalSeconds: clampNumber(payload.interval, 2, 15, 5),
      expiresAt: Date.now() + 15 * 60 * 1000,
    },
    201,
    cors,
  )
}

async function pollOpenAIDeviceLogin(request, cors) {
  const body = await readJson(request)
  const deviceAuthId = requiredText(body.deviceAuthId, 'deviceAuthId', 1, 512)
  const userCode = requiredText(body.userCode, 'userCode', 1, 128)
  const authorization = await fetch(`${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/token`, {
    method: 'POST',
    headers: openAIAuthHeaders('application/json'),
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  })
  if (authorization.status === 403 || authorization.status === 404) {
    return json({ status: 'pending', intervalSeconds: 5 }, 202, cors)
  }
  const authorizationPayload = await readUpstreamJson(authorization, 'OpenAI device authorization')
  const authorizationCode = safeText(authorizationPayload.authorization_code, 4096)
  const codeVerifier = safeText(authorizationPayload.code_verifier, 4096)
  if (!authorizationCode || !codeVerifier) throw httpError(502, 'OpenAI authorization response was incomplete.')

  const tokenResponse = await fetch(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: openAIAuthHeaders('application/x-www-form-urlencoded'),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: OPENAI_DEVICE_CALLBACK_URL,
      client_id: OPENAI_CODEX_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  })
  const credential = normalizeOAuthTokens(await readUpstreamJson(tokenResponse, 'OpenAI token exchange'))
  const identity = decodeOpenAIIdentity(credential.accessToken)
  if (!identity.accountId) throw httpError(502, 'OpenAI token did not contain a ChatGPT account id.')
  credential.accountId = identity.accountId
  return json(
    {
      status: 'complete',
      account: accountMetadata('openai', identity.accountId, maskEmail(identity.email) || `ChatGPT · ${identity.accountId.slice(-6)}`, identity.planType),
      credential,
    },
    200,
    cors,
  )
}

async function refreshOpenAI(request, cors) {
  const body = await readJson(request)
  const refreshToken = requiredText(body.refreshToken, 'refreshToken', 10, 100_000)
  const response = await fetch(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: openAIAuthHeaders('application/x-www-form-urlencoded'),
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: OPENAI_CODEX_CLIENT_ID }),
  })
  const credential = normalizeOAuthTokens(await readUpstreamJson(response, 'OpenAI token refresh'), refreshToken)
  const identity = decodeOpenAIIdentity(credential.accessToken)
  const accountId = identity.accountId || optionalText(body.accountId, 256)
  if (accountId) credential.accountId = accountId
  return json({ credential }, 200, cors)
}

async function exchangeClaude(request, cors) {
  const body = await readJson(request)
  const code = requiredText(body.code, 'code', 1, 16_384)
  const state = requiredText(body.state, 'state', 8, 512)
  const expectedState = requiredText(body.expectedState, 'expectedState', 8, 512)
  if (state !== expectedState) throw httpError(400, 'Claude OAuth state did not match.')
  const response = await fetch(CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLAUDE_CLIENT_ID,
      redirect_uri: CLAUDE_REDIRECT_URI,
      code,
      state,
      code_verifier: requiredText(body.codeVerifier, 'codeVerifier', 32, 512),
    }),
  })
  const payload = await readUpstreamJson(response, 'Claude token exchange')
  const credential = normalizeOAuthTokens(payload)
  const organizationUuid = safeText(payload.organization?.uuid, 256)
  const accountUuid = safeText(payload.account?.uuid, 256)
  const email = safeText(payload.account?.email_address, 320)
  credential.organizationUuid = organizationUuid
  credential.accountUuid = accountUuid
  credential.deviceId = randomHex(32)
  credential.sessionId = crypto.randomUUID()
  return json(
    {
      account: accountMetadata('claude', accountUuid || email || organizationUuid || randomHex(12), maskEmail(email) || `Claude · ${(accountUuid || organizationUuid).slice(-6)}`, 'Claude Code'),
      credential,
    },
    200,
    cors,
  )
}

async function refreshClaude(request, cors) {
  const body = await readJson(request)
  const refreshToken = requiredText(body.refreshToken, 'refreshToken', 10, 100_000)
  const response = await fetch(CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLAUDE_CLIENT_ID }),
  })
  return json({ credential: normalizeOAuthTokens(await readUpstreamJson(response, 'Claude token refresh'), refreshToken) }, 200, cors)
}

function geminiOAuthConfig(env, requireSecret = true) {
  const clientId = safeText(env?.GEMINI_OAUTH_CLIENT_ID, 512)
  const clientSecret = safeText(env?.GEMINI_OAUTH_CLIENT_SECRET, 512)
  if (!clientId || (requireSecret && !clientSecret)) {
    throw httpError(503, 'Gemini OAuth is not configured on this Worker.')
  }
  return { clientId, clientSecret }
}

async function exchangeGemini(request, env, cors) {
  const { clientId, clientSecret } = geminiOAuthConfig(env)
  const body = await readJson(request)
  const response = await fetch(GEMINI_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: requiredText(body.code, 'code', 1, 16_384),
      code_verifier: requiredText(body.codeVerifier, 'codeVerifier', 32, 512),
      redirect_uri: GEMINI_REDIRECT_URI,
    }),
  })
  const credential = normalizeOAuthTokens(await readUpstreamJson(response, 'Gemini token exchange'))
  const [userinfo, codeAssist] = await Promise.all([
    fetchGeminiUserinfo(credential.accessToken),
    loadGeminiCodeAssist(credential.accessToken),
  ])
  const tierId = geminiTier(codeAssist)
  const projectId = safeText(codeAssist.cloudaicompanionProject, 256)
    || optionalText(body.projectId, 256)
    || await discoverGeminiProject(credential.accessToken, codeAssist, tierId)
  if (!projectId) throw httpError(422, 'Gemini Code Assist did not return a project. Enter a Google Cloud project ID and authorize again.')
  credential.projectId = projectId
  credential.tierId = tierId
  const email = safeText(userinfo.email, 320)
  const identityKey = safeText(userinfo.id, 256) || email || projectId
  return json(
    {
      account: accountMetadata('gemini', identityKey, maskEmail(email) || `Gemini · ${projectId.slice(-8)}`, credential.tierId),
      credential,
    },
    200,
    cors,
  )
}

async function refreshGemini(request, env, cors) {
  const { clientId, clientSecret } = geminiOAuthConfig(env)
  const body = await readJson(request)
  const refreshToken = requiredText(body.refreshToken, 'refreshToken', 10, 100_000)
  const response = await fetch(GEMINI_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  return json({ credential: normalizeOAuthTokens(await readUpstreamJson(response, 'Gemini token refresh'), refreshToken) }, 200, cors)
}

async function fetchGeminiUserinfo(accessToken) {
  const response = await fetch(GEMINI_USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } })
  return readUpstreamJson(response, 'Gemini user profile')
}

async function loadGeminiCodeAssist(accessToken) {
  const response = await fetch(`${GEMINI_CODE_ASSIST_BASE}/v1internal:loadCodeAssist`, {
    method: 'POST',
    headers: geminiHeaders(accessToken),
    body: JSON.stringify({ metadata: geminiMetadata() }),
  })
  return readUpstreamJson(response, 'Gemini Code Assist discovery')
}

async function discoverGeminiProject(accessToken, codeAssist, tierId) {
  const registeredTier = tierValue(codeAssist.paidTier) || tierValue(codeAssist.currentTier)
  if (!registeredTier) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${GEMINI_CODE_ASSIST_BASE}/v1internal:onboardUser`, {
        method: 'POST',
        headers: geminiHeaders(accessToken),
        body: JSON.stringify({ tierId, metadata: geminiMetadata() }),
      })
      const payload = await readUpstreamJson(response, 'Gemini Code Assist onboarding')
      const project = extractGeminiProject(payload.response?.cloudaicompanionProject)
      if (payload.done && project) return project
      if (payload.done) break
      await delay(2000)
    }
  }
  return fetchGeminiResourceProject(accessToken)
}

async function fetchGeminiResourceProject(accessToken) {
  const response = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects', {
    headers: { authorization: `Bearer ${accessToken}`, 'User-Agent': 'GeminiCLI/0.1.5 (Windows; AMD64)' },
  })
  if (!response.ok) return ''
  const payload = await response.json().catch(() => ({}))
  const projects = Array.isArray(payload.projects)
    ? payload.projects.filter((project) => project.lifecycleState === 'ACTIVE' && safeText(project.projectId, 256))
    : []
  const preferred = projects.find((project) => /cloud-ai-companion|code assist/i.test(`${project.projectId} ${project.name}`))
    || projects.find((project) => /default/i.test(`${project.projectId} ${project.name}`))
    || projects[0]
  return safeText(preferred?.projectId, 256)
}

function geminiTier(codeAssist) {
  const registered = tierValue(codeAssist.paidTier) || tierValue(codeAssist.currentTier)
  if (registered) return registered
  const tiers = Array.isArray(codeAssist.allowedTiers) ? codeAssist.allowedTiers : []
  return safeText(tiers.find((tier) => tier?.isDefault)?.id, 128)
    || safeText(tiers.find((tier) => tier?.id)?.id, 128)
    || 'LEGACY'
}

function tierValue(value) {
  return safeText(typeof value === 'string' ? value : value?.id, 128)
}

function extractGeminiProject(value) {
  return safeText(typeof value === 'string' ? value : value?.id, 256)
}

async function exchangeGrok(request, cors) {
  const body = await readJson(request)
  const response = await fetch(GROK_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: GROK_CLIENT_ID,
      code: requiredText(body.code, 'code', 1, 16_384),
      redirect_uri: GROK_REDIRECT_URI,
      code_verifier: requiredText(body.codeVerifier, 'codeVerifier', 32, 512),
    }),
  })
  const payload = await readUpstreamJson(response, 'Grok token exchange')
  const credential = normalizeOAuthTokens(payload)
  const identity = decodeJwt(payload.id_token || credential.accessToken) || {}
  const email = safeText(identity.email, 320)
  const identityKey = safeText(identity.sub, 256) || email || randomHex(12)
  return json(
    {
      account: accountMetadata('grok', identityKey, maskEmail(email) || `Grok · ${identityKey.slice(-6)}`, 'Grok subscription'),
      credential,
    },
    200,
    cors,
  )
}

async function refreshGrok(request, cors) {
  const body = await readJson(request)
  const refreshToken = requiredText(body.refreshToken, 'refreshToken', 10, 100_000)
  const response = await fetch(GROK_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: GROK_CLIENT_ID, refresh_token: refreshToken }),
  })
  return json({ credential: normalizeOAuthTokens(await readUpstreamJson(response, 'Grok token refresh'), refreshToken) }, 200, cors)
}

async function proxyOpenAIResponses(request, cors) {
  const body = await readJson(request)
  const credential = readProxyCredential(body, true)
  const model = validModel(body.model)
  const prompt = requiredText(body.prompt, 'prompt', 1, MAX_PROMPT_LENGTH)
  const systemPrompt = optionalText(body.systemPrompt, 100_000)
  const maxOutput = integer(body.maxOutput, 'maxOutput', 1, 100_000)
  const reasoningEffort = ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(body.reasoningEffort) ? body.reasoningEffort : 'high'
  const upstreamBody = {
    model,
    store: false,
    stream: true,
    instructions: [systemPrompt || 'You are a helpful assistant.', `Keep this response to approximately ${maxOutput} tokens or fewer and stop cleanly.`].join('\n\n'),
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    text: { verbosity: 'low' },
    reasoning: { effort: reasoningEffort, summary: 'auto' },
    include: ['reasoning.encrypted_content'],
  }
  return proxyStream(
    OPENAI_CODEX_RESPONSES_URL,
    {
      Authorization: `Bearer ${credential.accessToken}`,
      'chatgpt-account-id': requiredText(credential.accountId, 'accountId', 1, 256),
      originator: 'token_killer',
      'User-Agent': 'token_killer/0.3.0 (Cloudflare Worker)',
      'OpenAI-Beta': 'responses=experimental',
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    upstreamBody,
    request.signal,
    cors,
    'ChatGPT Codex',
  )
}

async function proxyClaudeMessages(request, cors) {
  const body = await readJson(request)
  const credential = readProxyCredential(body)
  const prompt = requiredText(body.prompt, 'prompt', 1, MAX_PROMPT_LENGTH)
  const maxOutput = integer(body.maxOutput, 'maxOutput', 1, 100_000)
  const accountUuid = optionalText(credential.accountUuid, 256)
  const sessionId = optionalText(credential.sessionId, 128) || crypto.randomUUID()
  const deviceId = optionalText(credential.deviceId, 128) || randomHex(32)
  const billingFingerprint = await claudeFingerprint(prompt)
  const system = [
    { type: 'text', text: `x-anthropic-billing-header: cc_version=2.1.161.${billingFingerprint}; cc_entrypoint=cli;`, cache_control: { type: 'ephemeral', ttl: '5m' } },
    { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI for Claude.', cache_control: { type: 'ephemeral', ttl: '5m' } },
  ]
  if (body.systemPrompt) system.push({ type: 'text', text: optionalText(body.systemPrompt, 100_000), cache_control: { type: 'ephemeral', ttl: '5m' } })
  const upstreamBody = {
    model: validModel(body.model),
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    tools: [],
    temperature: 1,
    max_tokens: maxOutput,
    stream: true,
    metadata: { user_id: JSON.stringify({ device_id: deviceId, account_uuid: accountUuid, session_id: sessionId }) },
  }
  return proxyStream(
    CLAUDE_MESSAGES_URL,
    {
      authorization: `Bearer ${credential.accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05,effort-2025-11-24,context-management-2025-06-27,extended-cache-ttl-2025-04-11',
      'User-Agent': 'claude-cli/2.1.161 (external, cli)',
      'x-app': 'cli',
      'x-client-request-id': crypto.randomUUID(),
      'x-stainless-helper-method': 'stream',
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    upstreamBody,
    request.signal,
    cors,
    'Claude Code',
  )
}

async function proxyGeminiGenerate(request, cors) {
  const body = await readJson(request)
  const credential = readProxyCredential(body)
  const maxOutput = integer(body.maxOutput, 'maxOutput', 1, 65_536)
  const nativeRequest = {
    contents: [{ role: 'user', parts: [{ text: requiredText(body.prompt, 'prompt', 1, MAX_PROMPT_LENGTH) }] }],
    generationConfig: { maxOutputTokens: maxOutput },
  }
  if (body.systemPrompt) nativeRequest.systemInstruction = { parts: [{ text: optionalText(body.systemPrompt, 100_000) }] }
  return proxyStream(
    `${GEMINI_CODE_ASSIST_BASE}/v1internal:streamGenerateContent?alt=sse`,
    geminiHeaders(credential.accessToken),
    { model: validModel(body.model), project: requiredText(credential.projectId, 'projectId', 1, 256), request: nativeRequest },
    request.signal,
    cors,
    'Gemini Code Assist',
  )
}

async function proxyGrokResponses(request, cors) {
  const body = await readJson(request)
  const credential = readProxyCredential(body)
  const maxOutput = integer(body.maxOutput, 'maxOutput', 1, 100_000)
  const upstreamBody = {
    model: validModel(body.model),
    stream: true,
    store: false,
    instructions: optionalText(body.systemPrompt, 100_000) || undefined,
    input: [{ role: 'user', content: [{ type: 'input_text', text: requiredText(body.prompt, 'prompt', 1, MAX_PROMPT_LENGTH) }] }],
    max_output_tokens: maxOutput,
  }
  return proxyStream(
    GROK_RESPONSES_URL,
    {
      authorization: `Bearer ${credential.accessToken}`,
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-grok-client-version': '0.2.93',
      'User-Agent': 'xai-grok-workspace/0.2.93',
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    upstreamBody,
    request.signal,
    cors,
    'Grok',
  )
}

async function proxyStream(url, headers, body, signal, cors, operation) {
  const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!upstream.ok) {
    const detail = sanitizeErrorText((await upstream.text()).slice(0, MAX_ERROR_BODY))
    throw httpError(upstream.status, detail || `${operation} returned ${upstream.status}.`)
  }
  const responseHeaders = new Headers(cors)
  responseHeaders.set('content-type', upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8')
  responseHeaders.set('cache-control', 'no-store')
  responseHeaders.set('x-content-type-options', 'nosniff')
  const requestId = upstream.headers.get('x-request-id') || upstream.headers.get('request-id')
  if (requestId) responseHeaders.set('x-upstream-request-id', requestId)
  return new Response(upstream.body, { status: 200, headers: responseHeaders })
}

function readProxyCredential(body, requireAccountId = false) {
  const accessToken = requiredText(body.accessToken, 'accessToken', 10, 100_000)
  const credential = { accessToken }
  for (const key of ['accountId', 'accountUuid', 'organizationUuid', 'projectId', 'deviceId', 'sessionId']) {
    if (body[key]) credential[key] = optionalText(body[key], 512)
  }
  if (requireAccountId && !credential.accountId) throw httpError(400, 'accountId is invalid.')
  return credential
}

function normalizeOAuthTokens(payload, fallbackRefreshToken = '') {
  const accessToken = safeText(payload.access_token, 100_000)
  const refreshToken = safeText(payload.refresh_token, 100_000) || fallbackRefreshToken
  if (!accessToken || !refreshToken) throw httpError(502, 'OAuth response did not include access and refresh tokens.')
  const claims = decodeJwt(accessToken)
  const jwtExpires = Number(claims?.exp || 0) * 1000
  const durationExpires = Date.now() + clampNumber(payload.expires_in, 60, 31_536_000, 3600) * 1000
  return { accessToken, refreshToken, expiresAt: jwtExpires > Date.now() ? jwtExpires : durationExpires }
}

function decodeOpenAIIdentity(accessToken) {
  const payload = decodeJwt(accessToken) || {}
  const auth = payload['https://api.openai.com/auth'] || {}
  const profile = payload['https://api.openai.com/profile'] || {}
  return {
    accountId: safeText(auth.chatgpt_account_id, 256),
    planType: safeText(auth.chatgpt_plan_type, 64),
    email: safeText(profile.email || payload.email, 320),
  }
}

function decodeJwt(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])))
  } catch {
    return null
  }
}

function accountMetadata(provider, identityKey, displayName, planType = '') {
  return { id: crypto.randomUUID(), provider, identityKey, displayName, planType, createdAt: Date.now() }
}

function geminiMetadata() {
  return { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' }
}

function geminiHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    accept: 'text/event-stream, application/json',
    'User-Agent': 'GeminiCLI/0.1.5 (Windows; AMD64)',
  }
}

async function claudeFingerprint(prompt) {
  const characters = Array.from(prompt)
  const sample = `${characters[4] || '0'}${characters[7] || '0'}${characters[20] || '0'}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`59cf53e54c78${sample}2.1.161`))
  return Array.from(new Uint8Array(digest)).slice(0, 2).map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 3)
}

function openAIAuthHeaders(contentType) {
  return { 'Content-Type': contentType, originator: 'token_killer', 'User-Agent': 'token_killer/0.3.0' }
}

async function readUpstreamJson(response, operation) {
  const text = (await response.text()).slice(0, response.ok ? 256_000 : MAX_ERROR_BODY)
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  if (!response.ok) {
    const detail = sanitizeErrorText(payload?.error_description || payload?.error?.message || payload?.error || payload?.message || text)
    throw httpError(response.status >= 400 && response.status < 500 ? response.status : 502, `${operation} failed: ${detail || response.status}`)
  }
  if (!payload || typeof payload !== 'object') throw httpError(502, `${operation} returned invalid JSON.`)
  return payload
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) throw httpError(415, 'Expected application/json.')
  try {
    return await request.json()
  } catch {
    throw httpError(400, 'Invalid JSON body.')
  }
}

function json(payload, status, extraHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extraHeaders },
  })
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function validModel(value) {
  const model = requiredText(value, 'model', 1, 160)
  if (!/^[A-Za-z0-9._:/-]+$/.test(model)) throw httpError(400, 'model is invalid.')
  return model
}

function requiredText(value, name, min, max) {
  const text = String(value || '').trim()
  if (text.length < min || text.length > max) throw httpError(400, `${name} is invalid.`)
  return text
}

function optionalText(value, max) {
  const text = String(value || '').trim()
  if (text.length > max) throw httpError(400, 'Text field is too long.')
  return text
}

function integer(value, name, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) throw httpError(400, `${name} is invalid.`)
  return number
}

function safeText(value, max) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= max ? text : ''
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@')
  if (!local || !domain) return ''
  return `${local.slice(0, 1)}${local.length > 1 ? '***' : ''}@${domain}`
}

function sanitizeErrorText(value) {
  return Array.from(String(value || ''))
    .filter((character) => character.codePointAt(0) > 31 && character.codePointAt(0) !== 127)
    .join('')
    .replace(/(?:access|refresh|id)[_-]?token["'=:\s]+[^\s,"'}]+/gi, '[redacted-token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200)
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function randomHex(byteLength) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteLength))).map((value) => value.toString(16).padStart(2, '0')).join('')
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
