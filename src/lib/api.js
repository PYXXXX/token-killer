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

function parseExtraHeaders(raw) {
  if (!raw?.trim()) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('自定义 Header 必须是 JSON 对象')
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
}

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

function directFormat(settings) {
  if (settings.apiFormat) return settings.apiFormat
  if (settings.provider === 'anthropic') return 'anthropic'
  if (settings.provider === 'openai') return 'openai-responses'
  return 'openai'
}

function buildHeaders(settings, format, includeContentType = true) {
  const headers = {
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...parseExtraHeaders(settings.extraHeaders),
  }

  if (settings.authMode === 'x-api-key') {
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey
  } else if (settings.authMode === 'x-goog-api-key') {
    if (settings.apiKey) headers['x-goog-api-key'] = settings.apiKey
  } else if (settings.authMode !== 'none' && settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`
  }

  if (format === 'anthropic') {
    headers['anthropic-version'] = settings.anthropicVersion || '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  }
  return headers
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

function normalizeUsage(usage, fallbackInput = 0, fallbackOutput = 0) {
  if (!usage) {
    return {
      input: fallbackInput,
      output: fallbackOutput,
      total: fallbackInput + fallbackOutput,
      reasoning: 0,
      cached: 0,
      verified: false,
      cost: 0,
    }
  }

  const rawInput = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? 0)
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? 0)
  const cached = Number(
    usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
  )
  const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0)
  const hasSeparateAnthropicCache = usage.cache_read_input_tokens != null || usage.cache_creation_input_tokens != null
  const input = hasSeparateAnthropicCache ? rawInput + cached + cacheCreation : rawInput
  const reasoning = Number(
    usage.completion_tokens_details?.reasoning_tokens ??
      usage.output_tokens_details?.reasoning_tokens ??
      usage.output_tokens_details?.thinking_tokens ??
      usage.thoughtsTokenCount ??
      0,
  )
  const total = Number(usage.total_tokens ?? usage.totalTokenCount ?? input + output + reasoning)

  return { input, output, total, reasoning, cached, verified: true, cost: Number(usage.cost ?? 0) }
}

export function buildRequest(settings, prompt, maxOutput) {
  const format = directFormat(settings)
  const headers = buildHeaders(settings, format)
  const markedPrompt = appendRequestMarker(prompt)

  if (format === 'anthropic') {
    return {
      format,
      headers,
      body: {
        model: settings.model,
        system: settings.systemPrompt || undefined,
        messages: [{ role: 'user', content: markedPrompt }],
        max_tokens: maxOutput,
        stream: settings.stream,
      },
    }
  }

  if (format === 'gemini') {
    const method = settings.stream ? 'streamGenerateContent' : 'generateContent'
    const model = encodeURIComponent(settings.model)
    const sourceEndpoint = String(settings.endpoint || '')
    let endpoint = sourceEndpoint.replace(/\{model\}|%7Bmodel%7D/gi, model)
    if (/:(?:stream)?generateContent(?:\?.*)?$/i.test(endpoint)) {
      endpoint = endpoint.replace(/:(?:stream)?generateContent/i, `:${method}`)
    } else if (/\/models\/?(?:\?.*)?$/i.test(endpoint)) {
      endpoint = endpoint.replace(/\/models\/?/i, `/models/${model}:${method}`)
    } else if (!/\/models\/[^/]+:/i.test(endpoint)) {
      endpoint = `${endpoint.replace(/\/$/, '')}/models/${model}:${method}`
    }
    const url = new URL(endpoint)
    if (settings.stream) url.searchParams.set('alt', 'sse')
    return {
      format,
      endpoint: url.toString(),
      headers,
      body: {
        systemInstruction: settings.systemPrompt
          ? { parts: [{ text: settings.systemPrompt }] }
          : undefined,
        contents: [{ role: 'user', parts: [{ text: markedPrompt }] }],
        generationConfig: { maxOutputTokens: maxOutput },
      },
    }
  }

  if (format === 'openai-responses') {
    return {
      format,
      headers,
      body: {
        model: settings.model,
        instructions: settings.systemPrompt || undefined,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: markedPrompt }],
          },
        ],
        max_output_tokens: maxOutput,
        stream: settings.stream,
        store: false,
      },
    }
  }

  if (format === 'openai-completions') {
    return {
      format,
      headers,
      body: {
        model: settings.model,
        prompt: settings.systemPrompt ? `${settings.systemPrompt}\n\n${markedPrompt}` : markedPrompt,
        max_tokens: maxOutput,
        stream: false,
      },
    }
  }

  const tokenField =
    settings.tokenParam === 'auto'
      ? settings.provider === 'openai' || /\/\/api\.openai\.com\//i.test(settings.endpoint)
        ? 'max_completion_tokens'
        : 'max_tokens'
      : settings.tokenParam
  const body = {
    model: settings.model,
    messages: [
      ...(settings.systemPrompt ? [{ role: 'system', content: settings.systemPrompt }] : []),
      { role: 'user', content: markedPrompt },
    ],
    stream: settings.stream,
    [tokenField]: maxOutput,
  }
  if (settings.stream) body.stream_options = { include_usage: true }
  if (/\/\/api\.deepseek\.com\//i.test(settings.endpoint) && settings.deepThinking) {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = settings.reasoningEffort || 'high'
  }
  return { format, headers, body }
}

async function readResponsesStream(response, inputEstimate, onChunk) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let event
      try {
        event = JSON.parse(data)
      } catch {
        continue
      }
      if (event.type === 'error' || event.error || event.response?.error) {
        throw classifyProviderError({
          payload: event.response || event,
          status: response.status,
          fallback: 'Responses 请求失败',
        })
      }
      const delta = event.type === 'response.output_text.delta' ? event.delta || '' : ''
      if (delta) {
        text += delta
        onChunk?.(delta)
      }
      if (event.response?.usage) usage = event.response.usage
      if (event.usage) usage = event.usage
    }
  }

  const outputEstimate = Math.ceil(Array.from(text).length / 2.6)
  return { text, usage: normalizeUsage(usage, inputEstimate, outputEstimate) }
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
    result = account.provider === 'claude'
      ? await readAnthropicStream(response, inputEstimate, onChunk)
      : account.provider === 'gemini'
        ? await readGeminiStream(response, inputEstimate, onChunk)
        : await readResponsesStream(response, inputEstimate, onChunk)
  } catch (error) {
    throw rememberProviderBlock(settings, error)
  }
  return {
    ...result,
    requestId: response.headers.get('x-upstream-request-id') || '',
  }
}

async function readGeminiStream(response, inputEstimate, onChunk) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage = null

  const consume = (line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    let event
    try {
      event = JSON.parse(data)
    } catch {
      return
    }
    if (event.error) {
      throw classifyProviderError({ payload: event, status: response.status, fallback: 'Gemini 请求失败' })
    }
    const payload = event.response || event
    if (payload.usageMetadata) usage = payload.usageMetadata
    const delta = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
    if (delta) {
      text += delta
      onChunk?.(delta)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) consume(line)
  }
  if (buffer) consume(buffer)

  const outputEstimate = Math.ceil(Array.from(text).length / 2.6)
  return { text, usage: normalizeUsage(usage, inputEstimate, outputEstimate) }
}

async function readOpenAIStream(response, inputEstimate, onChunk) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let event
      try {
        event = JSON.parse(data)
      } catch {
        continue
      }
      if (event.error) {
        throw classifyProviderError({ payload: event, status: response.status, fallback: '流式请求失败' })
      }
      if (event.usage) usage = event.usage
      const delta = event.choices?.[0]?.delta?.content || event.choices?.[0]?.text || ''
      if (delta) {
        text += delta
        onChunk?.(delta)
      }
    }
  }

  const outputEstimate = Math.ceil(Array.from(text).length / 2.6)
  return { text, usage: normalizeUsage(usage, inputEstimate, outputEstimate) }
}

async function readAnthropicStream(response, inputEstimate, onChunk) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheCreation = 0
  let sawUsage = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      const dataLine = block
        .split('\n')
        .find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      let event
      try {
        event = JSON.parse(dataLine.slice(5).trim())
      } catch {
        continue
      }
      if (event.type === 'error') {
        throw classifyProviderError({ payload: event, status: response.status, fallback: '流式请求失败' })
      }
      if (event.message?.usage) {
        input = Number(event.message.usage.input_tokens || 0)
        output = Number(event.message.usage.output_tokens || 0)
        cacheRead = Number(event.message.usage.cache_read_input_tokens || 0)
        cacheCreation = Number(event.message.usage.cache_creation_input_tokens || 0)
        sawUsage = true
      }
      if (event.usage) {
        input = Number(event.usage.input_tokens ?? input)
        output = Number(event.usage.output_tokens ?? output)
        cacheRead = Number(event.usage.cache_read_input_tokens ?? cacheRead)
        cacheCreation = Number(event.usage.cache_creation_input_tokens ?? cacheCreation)
        sawUsage = true
      }
      const delta = event.delta?.text || ''
      if (delta) {
        text += delta
        onChunk?.(delta)
      }
    }
  }

  const outputEstimate = Math.ceil(Array.from(text).length / 2.6)
  return {
    text,
    usage: sawUsage
      ? { input: input + cacheRead + cacheCreation, output, total: input + cacheRead + cacheCreation + output, reasoning: 0, cached: cacheRead, verified: true }
      : normalizeUsage(null, inputEstimate, outputEstimate),
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
      result =
        request.format === 'anthropic'
          ? await readAnthropicStream(response, inputEstimate, onChunk)
          : request.format === 'openai-responses'
            ? await readResponsesStream(response, inputEstimate, onChunk)
            : request.format === 'gemini'
              ? await readGeminiStream(response, inputEstimate, onChunk)
              : await readOpenAIStream(response, inputEstimate, onChunk)
    } catch (error) {
      throw rememberProviderBlock(settings, error)
    }
  } else {
    const payload = await response.json()
    const structuredError = classifyProviderError({ payload, status: response.status })
    if (structuredError.providerBlock) throw rememberProviderBlock(settings, structuredError)
    const text =
      request.format === 'anthropic'
        ? payload.content?.map((part) => part.text || '').join('') || ''
        : request.format === 'openai-responses'
          ? extractResponsesText(payload)
          : request.format === 'gemini'
            ? payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
            : request.format === 'openai-completions'
              ? payload.choices?.[0]?.text || ''
              : payload.choices?.[0]?.message?.content || payload.output_text || ''
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

function extractResponsesText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text
  return (payload.output || [])
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((part) => part.type === 'output_text' || typeof part.text === 'string')
    .map((part) => part.text || '')
    .join('')
}
