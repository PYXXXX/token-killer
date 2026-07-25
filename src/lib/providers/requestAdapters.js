import { appendRequestMarker } from '../providerGuard.js'

function parseExtraHeaders(raw) {
  if (!raw?.trim()) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('自定义 Header 必须是 JSON 对象')
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
}

export function directFormat(settings) {
  if (settings.apiFormat) return settings.apiFormat
  if (settings.provider === 'anthropic') return 'anthropic'
  if (settings.provider === 'openai') return 'openai-responses'
  return 'openai'
}

export function buildHeaders(settings, format, includeContentType = true) {
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

function anthropicRequest(settings, markedPrompt, maxOutput, headers) {
  return {
    format: 'anthropic',
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

function geminiRequest(settings, markedPrompt, maxOutput, headers) {
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
    format: 'gemini',
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

function responsesRequest(settings, markedPrompt, maxOutput, headers) {
  return {
    format: 'openai-responses',
    headers,
    body: {
      model: settings.model,
      instructions: settings.systemPrompt || undefined,
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: markedPrompt }],
      }],
      max_output_tokens: maxOutput,
      stream: settings.stream,
      store: false,
    },
  }
}

function completionsRequest(settings, markedPrompt, maxOutput, headers) {
  return {
    format: 'openai-completions',
    headers,
    body: {
      model: settings.model,
      prompt: settings.systemPrompt ? `${settings.systemPrompt}\n\n${markedPrompt}` : markedPrompt,
      max_tokens: maxOutput,
      stream: false,
    },
  }
}

function chatCompletionsRequest(settings, markedPrompt, maxOutput, headers) {
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
  return { format: 'openai', headers, body }
}

const ADAPTERS = {
  anthropic: anthropicRequest,
  gemini: geminiRequest,
  'openai-responses': responsesRequest,
  'openai-completions': completionsRequest,
  openai: chatCompletionsRequest,
}

export function buildRequest(settings, prompt, maxOutput) {
  const format = directFormat(settings)
  const adapter = ADAPTERS[format] || ADAPTERS.openai
  return adapter(settings, appendRequestMarker(prompt), maxOutput, buildHeaders(settings, format))
}
