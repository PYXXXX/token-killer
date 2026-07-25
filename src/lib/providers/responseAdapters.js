import { classifyProviderError } from '../providerGuard.js'

export function normalizeUsage(usage, fallbackInput = 0, fallbackOutput = 0) {
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
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'))
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
      ? {
          input: input + cacheRead + cacheCreation,
          output,
          total: input + cacheRead + cacheCreation + output,
          reasoning: 0,
          cached: cacheRead,
          verified: true,
        }
      : normalizeUsage(null, inputEstimate, outputEstimate),
  }
}

const STREAM_READERS = {
  anthropic: readAnthropicStream,
  'openai-responses': readResponsesStream,
  gemini: readGeminiStream,
  openai: readOpenAIStream,
}

export function readProviderStream(format, response, inputEstimate, onChunk) {
  return (STREAM_READERS[format] || STREAM_READERS.openai)(response, inputEstimate, onChunk)
}

function extractResponsesText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text
  return (payload.output || [])
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((part) => part.type === 'output_text' || typeof part.text === 'string')
    .map((part) => part.text || '')
    .join('')
}

export function extractResponseText(format, payload) {
  if (format === 'anthropic') {
    return payload.content?.map((part) => part.text || '').join('') || ''
  }
  if (format === 'openai-responses') return extractResponsesText(payload)
  if (format === 'gemini') {
    return payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
  }
  if (format === 'openai-completions') return payload.choices?.[0]?.text || ''
  return payload.choices?.[0]?.message?.content || payload.output_text || ''
}
