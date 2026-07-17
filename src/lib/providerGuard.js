export const REQUEST_MARKER = '[token-killer]'

const BLOCKING_ERROR_CODES = new Set([
  'sensitive_words_detected',
  'content_policy_violation',
])

const SUBSCRIPTION_PROVIDERS = new Set([
  'chatgpt',
  'claude_subscription',
  'gemini_subscription',
  'grok_subscription',
])

const STANDARD_INFERENCE_FORMATS = new Set([
  'openai',
  'openai-responses',
  'openai-completions',
  'anthropic',
  'gemini',
])

export class ProviderRequestError extends Error {
  constructor({ status = 0, code = '', message = 'Provider request failed.', providerKey = '' } = {}) {
    super(message)
    this.name = 'ProviderRequestError'
    this.status = Number(status) || 0
    this.code = String(code || '')
    this.providerKey = String(providerKey || '')
    this.providerBlock = false
  }
}

export class ProviderBlockedError extends ProviderRequestError {
  constructor({ status = 0, code = '', message = 'Provider rejected Token Killer traffic.', providerKey = '', localBlock = false } = {}) {
    super({ status, code, message, providerKey })
    this.name = 'ProviderBlockedError'
    this.providerBlock = true
    this.localBlock = Boolean(localBlock)
  }
}

export function appendRequestMarker(value) {
  const text = String(value ?? '').split(REQUEST_MARKER).join('').trimEnd()
  if (!text) return REQUEST_MARKER
  return `${text}\n\n${REQUEST_MARKER}`
}

function errorCodeCandidates(payload) {
  return [
    payload?.error?.code,
    payload?.code,
    payload?.error?.type,
    payload?.type,
  ]
}

function errorMessage(payload, fallback) {
  const value = payload?.error?.message
    ?? payload?.message
    ?? (typeof payload?.error === 'string' ? payload.error : '')
    ?? fallback
  return String(value || fallback || 'Provider request failed.')
}

export function classifyProviderError({ payload, status = 0, fallback = '', providerKey = '' } = {}) {
  const rawCode = errorCodeCandidates(payload).find((value) => typeof value === 'string' && value.trim()) || ''
  const code = rawCode.trim().toLowerCase()
  const details = {
    status: Number(status) || 0,
    code,
    message: errorMessage(payload, fallback),
    providerKey,
  }
  return BLOCKING_ERROR_CODES.has(code)
    ? new ProviderBlockedError(details)
    : new ProviderRequestError(details)
}

function currentOrigin() {
  const origin = globalThis.location?.origin
  return typeof origin === 'string' && origin !== 'null' ? origin : 'https://same-origin.invalid'
}

function stripInferenceSuffix(pathname) {
  const patterns = [
    /\/(?:v\d+(?:beta\d+)?)\/(?:chat\/completions|responses|completions|messages)$/i,
    /\/(?:chat\/completions|responses|completions|messages)$/i,
    /\/(?:v\d+(?:beta\d+)?)\/models\/[^/]+:(?:stream)?generateContent$/i,
    /\/models\/[^/]+:(?:stream)?generateContent$/i,
  ]
  let path = pathname.replace(/\/+$/, '')
  for (const pattern of patterns) {
    if (pattern.test(path)) {
      path = path.replace(pattern, '')
      break
    }
  }
  return path.replace(/\/+$/, '')
}

export function normalizeProviderEndpoint(value, { subscription = false } = {}) {
  const source = String(value || '').trim()
  const fallback = currentOrigin()
  try {
    const url = new URL(source || fallback, fallback)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    const pathname = subscription ? url.pathname.replace(/\/+$/, '') : stripInferenceSuffix(url.pathname)
    const normalized = `${url.origin}${pathname && pathname !== '/' ? pathname : ''}`
    return normalized === 'https://same-origin.invalid' ? 'same-origin' : normalized
  } catch {
    const withoutQuery = source.split(/[?#]/, 1)[0].replace(/\/+$/, '')
    return withoutQuery || (subscription ? 'same-origin' : 'invalid-endpoint')
  }
}

function formatScope(apiFormat) {
  const format = String(apiFormat || 'openai').trim().toLowerCase()
  return STANDARD_INFERENCE_FORMATS.has(format) ? 'text-inference' : format || 'text-inference'
}

export function getProviderIdentity(settings = {}) {
  const provider = String(settings.provider || 'custom').trim() || 'custom'
  const subscription = SUBSCRIPTION_PROVIDERS.has(provider)
  const apiFormat = String(settings.apiFormat || 'openai').trim().toLowerCase() || 'openai'
  const endpoint = normalizeProviderEndpoint(
    subscription ? settings.subscriptionApiUrl : settings.endpoint,
    { subscription },
  )
  const key = subscription
    ? `subscription|${provider}|${endpoint}`
    : `direct|${provider}|${formatScope(apiFormat)}|${endpoint}`
  return { key, provider, apiFormat, endpoint, subscription }
}

export function providerBlockedMessage() {
  return `该 Provider 已明确拒绝带有 ${REQUEST_MARKER} 标记的请求，已在本浏览器停用。可前往设置解除屏蔽。`
}
