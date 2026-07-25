import { refreshSubscriptionCredential } from './accounts.js'
import { getLocalAccount, saveLocalAccount } from './localVault.js'
import {
  ProviderBlockedError,
  appendRequestMarker,
  classifyProviderError,
  getProviderIdentity,
  providerBlockedMessage,
} from './providerGuard.js'
import { blockProvider, isProviderBlocked } from './storage.js'
import { API_ROUTES, apiServiceUrl } from './apiRoutes.js'
import { buildHeaders, buildRequest, directFormat } from './providers/requestAdapters.js'
import {
  extractResponseText,
  normalizeUsage,
  readProviderStream,
} from './providers/responseAdapters.js'

export { buildRequest } from './providers/requestAdapters.js'

function extractError(payload, fallback) {
  return payload?.error?.message || payload?.message || payload?.error?.type || fallback
}

const SUBSCRIPTION_PROVIDERS = ['chatgpt', 'claude_subscription', 'gemini_subscription', 'grok_subscription']
const subscriptionRefreshLocks = new Map()

export class RequestOutcomeUnknownError extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'RequestOutcomeUnknownError'
    this.outcomeUnknown = true
  }
}

async function fetchInference(url, options, timeoutSeconds) {
  const externalSignal = options.signal
  const controller = new AbortController()
  const timeoutMs = Math.max(0, Number(timeoutSeconds) || 0) * 1000
  let timedOut = false
  const forwardAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) forwardAbort()
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = timeoutMs
    ? globalThis.setTimeout(() => {
        timedOut = true
        controller.abort(new DOMException('Request timed out', 'TimeoutError'))
      }, timeoutMs)
    : 0

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (externalSignal?.aborted) throw error
    if (timedOut) {
      throw new RequestOutcomeUnknownError('请求超时；上游可能已经收到请求，本轮不会自动重试。', error)
    }
    if (error?.providerBlock) throw error
    throw new RequestOutcomeUnknownError(
      `网络连接中断；无法确认上游是否已经处理，本轮不会自动重试。${error?.message ? ` ${error.message}` : ''}`,
      error,
    )
  } finally {
    if (timeout) globalThis.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', forwardAbort)
  }
}

function createInferenceDeadline(externalSignal, timeoutSeconds) {
  const controller = new AbortController()
  const timeoutMs = Math.max(0, Number(timeoutSeconds) || 0) * 1000
  let timedOut = false
  const forwardAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) forwardAbort()
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = timeoutMs
    ? globalThis.setTimeout(() => {
        timedOut = true
        controller.abort(new DOMException('Request timed out', 'TimeoutError'))
      }, timeoutMs)
    : 0

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose() {
      if (timeout) globalThis.clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', forwardAbort)
    },
  }
}

function rememberProviderBlock(settings, error) {
  if (!error?.providerBlock) return error
  const { key } = getProviderIdentity(settings)
  error.providerKey = key
  blockProvider(settings, error)
  return error
}

function assertProviderAvailable(settings) {
  const record = isProviderBlocked(settings)
  if (!record) return
  throw new ProviderBlockedError({
    providerKey: record.key,
    status: record.status,
    code: record.reasonCode,
    message: providerBlockedMessage(),
    localBlock: true,
  })
}

export function deriveModelsEndpoint(endpoint, format) {
  const source = String(endpoint || '').trim()
  if (!source) throw new Error('请先填写 API 请求地址')
  let url
  try {
    url = new URL(source)
  } catch {
    throw new Error('API 请求地址格式无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('模型目录仅支持 HTTP(S) 地址')

  if (format === 'gemini') {
    url.pathname = url.pathname
      .replace(/\/models\/[^/]+(?::(?:stream)?generateContent)?\/?$/i, '/models')
      .replace(/\/$/, '')
    if (!/\/models$/i.test(url.pathname)) url.pathname = `${url.pathname}/models`.replace(/\/+/g, '/')
    url.search = ''
    url.searchParams.set('pageSize', '1000')
    return url.toString()
  }

  const replaced = url.pathname.replace(
    /\/(?:chat\/completions|responses|completions|messages)\/?$/i,
    '/models',
  )
  url.pathname = replaced === url.pathname
    ? `${url.pathname.replace(/\/$/, '')}/models`.replace(/\/+/g, '/')
    : replaced
  url.search = ''
  return url.toString()
}

function normalizeModelList(payload, format) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []
  return items
    .filter((item) => {
      if (format !== 'gemini' || !Array.isArray(item.supportedGenerationMethods)) return true
      return item.supportedGenerationMethods.includes('generateContent')
    })
    .map((item) => {
      const rawId = typeof item === 'string' ? item : item.id || item.name || item.model || ''
      const id = format === 'gemini' ? String(rawId).replace(/^models\//, '') : String(rawId)
      return {
        id,
        name: typeof item === 'string' ? item : item.displayName || item.name || item.id || id,
      }
    })
    .filter((item) => item.id)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function loadProviderModels(settings, signal) {
  const format = directFormat(settings)
  const endpoint = deriveModelsEndpoint(settings.endpoint, format)
  let response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: buildHeaders(settings, format, false),
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(`无法连接模型目录。${error.message ? ` ${error.message}` : ''}`)
  }
  if (!response.ok) {
    let payload
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    throw new Error(extractError(payload, `模型目录返回 ${response.status} ${response.statusText}`))
  }
  const payload = await response.json()
  const models = normalizeModelList(payload, format)
  if (!models.length) throw new Error('模型目录没有返回可用模型')
  return { endpoint, models }
}

export function estimatePromptTokens(systemPrompt, prompt) {
  const text = `${systemPrompt || ''}\n${appendRequestMarker(prompt)}`
  let ascii = 0
  let wide = 0
  for (const character of text) {
    if (character.charCodeAt(0) < 128) ascii += 1
    else wide += 1
  }
  return Math.ceil(ascii / 3.2 + wide * 1.35 + 24)
}

export function guardedPromptEstimate(systemPrompt, prompt) {
  return Math.ceil(estimatePromptTokens(systemPrompt, prompt) * 1.18 + 16)
}

async function resolveSubscriptionAccount(settings) {
  if (!settings.selectedAccountId) throw new Error('请先连接并选择一个消费版订阅账号')
  const account = await getLocalAccount(settings.selectedAccountId)
  const expectedProvider = {
    chatgpt: 'openai',
    claude_subscription: 'claude',
    gemini_subscription: 'gemini',
    grok_subscription: 'grok',
  }[settings.provider]
  if (account.provider !== expectedProvider) throw new Error('所选订阅账号与当前供应商不匹配')
  if (Number(account.credential.expiresAt || 0) > Date.now() + 60_000) return account

  const lockKey = account.id
  if (!subscriptionRefreshLocks.has(lockKey)) {
    subscriptionRefreshLocks.set(lockKey, (async () => {
      const refreshed = await refreshSubscriptionCredential(
        settings.subscriptionApiUrl,
        account.provider,
        account.credential,
      )
      const credential = { ...account.credential, ...refreshed.credential }
      const saved = await saveLocalAccount({ ...account, credential })
      return { ...saved, credential }
    })().finally(() => subscriptionRefreshLocks.delete(lockKey)))
  }
  return subscriptionRefreshLocks.get(lockKey)
}

export function buildSubscriptionPayload(settings, credential, prompt, maxOutput) {
  return {
    accessToken: credential.accessToken,
    accountId: credential.accountId,
    accountUuid: credential.accountUuid,
    organizationUuid: credential.organizationUuid,
    projectId: credential.projectId,
    deviceId: credential.deviceId,
    sessionId: credential.sessionId,
    model: settings.model,
    prompt: appendRequestMarker(prompt),
    systemPrompt: settings.systemPrompt,
    maxOutput,
    reasoningEffort: settings.reasoningEffort || 'high',
  }
}

async function callSubscription(settings, prompt, maxOutput, signal, onChunk) {
  if (!settings.model?.trim()) throw new Error('请先填写模型 ID')
  const account = await resolveSubscriptionAccount(settings)
  const routes = {
    openai: API_ROUTES.subscription.openaiResponses,
    claude: API_ROUTES.subscription.claudeMessages,
    gemini: API_ROUTES.subscription.geminiGenerate,
    grok: API_ROUTES.subscription.grokResponses,
  }
  let response
  try {
    assertProviderAvailable(settings)
    response = await fetchInference(apiServiceUrl(settings.subscriptionApiUrl, routes[account.provider]), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSubscriptionPayload(settings, account.credential, prompt, maxOutput)),
      signal,
    }, 0)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    if (error.providerBlock) throw error
    if (error.outcomeUnknown) throw error
    throw new Error(`订阅代理连接失败。${error.message ? ` ${error.message}` : ''}`)
  }

  if (!response.ok) {
    let payload
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    throw rememberProviderBlock(settings, classifyProviderError({
      payload,
      status: response.status,
      fallback: `订阅代理返回 ${response.status} ${response.statusText}`,
    }))
  }

  const inputEstimate = estimatePromptTokens(settings.systemPrompt, prompt)
  let result
  try {
    const responseFormat = account.provider === 'claude'
      ? 'anthropic'
      : account.provider === 'gemini'
        ? 'gemini'
        : 'openai-responses'
    result = await readProviderStream(responseFormat, response, inputEstimate, onChunk)
  } catch (error) {
    throw rememberProviderBlock(settings, error)
  }
  return {
    ...result,
    requestId: response.headers.get('x-upstream-request-id') || '',
  }
}

async function callProviderOnce(settings, prompt, maxOutput, signal, onChunk) {
  assertProviderAvailable(settings)
  if (SUBSCRIPTION_PROVIDERS.includes(settings.provider)) {
    return callSubscription(settings, prompt, maxOutput, signal, onChunk)
  }
  if (!settings.endpoint?.trim()) throw new Error('请先填写 API 请求地址')
  if (!settings.model?.trim()) throw new Error('请先填写模型 ID')
  if (!settings.apiKey?.trim() && settings.authMode !== 'none') throw new Error('请先填写 API Key')

  let request
  try {
    request = buildRequest(settings, prompt, maxOutput)
  } catch (error) {
    throw new Error(`请求配置无效: ${error.message}`)
  }

  let response
  try {
    assertProviderAvailable(settings)
    response = await fetchInference(request.endpoint || settings.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal,
    }, 0)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    if (error.providerBlock) throw error
    if (error.outcomeUnknown) throw error
    throw new Error(`网络请求失败，请检查请求地址和连接设置。${error.message ? ` ${error.message}` : ''}`)
  }

  if (!response.ok) {
    let payload
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    throw rememberProviderBlock(settings, classifyProviderError({
      payload,
      status: response.status,
      fallback: `API 返回 ${response.status} ${response.statusText}`,
    }))
  }

  const inputEstimate = estimatePromptTokens(settings.systemPrompt, prompt)
  let result
  const useStream = settings.stream && request.format !== 'openai-completions'
  if (useStream) {
    try {
      result = await readProviderStream(request.format, response, inputEstimate, onChunk)
    } catch (error) {
      throw rememberProviderBlock(settings, error)
    }
  } else {
    const payload = await response.json()
    const structuredError = classifyProviderError({ payload, status: response.status })
    if (structuredError.providerBlock) throw rememberProviderBlock(settings, structuredError)
    const text = extractResponseText(request.format, payload)
    result = {
      text,
      usage: normalizeUsage(
        request.format === 'gemini' ? payload.usageMetadata : payload.usage,
        inputEstimate,
        Math.ceil(Array.from(text).length / 2.6),
      ),
    }
  }

  return {
    ...result,
    requestId: response.headers.get('x-request-id') || response.headers.get('request-id') || '',
  }
}

export async function callProvider(settings, prompt, maxOutput, signal, onChunk) {
  const deadline = createInferenceDeadline(signal, settings.requestTimeoutSeconds)
  try {
    return await callProviderOnce(settings, prompt, maxOutput, deadline.signal, onChunk)
  } catch (error) {
    if (deadline.didTimeOut()) {
      throw new RequestOutcomeUnknownError('请求超时；上游可能已经收到请求，本轮不会自动重试。', error)
    }
    throw error
  } finally {
    deadline.dispose()
  }
}
