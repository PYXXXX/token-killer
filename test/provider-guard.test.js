import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.js'
import {
  buildRequest,
  buildSubscriptionPayload,
  callProvider,
  loadProviderModels,
} from '../src/lib/api.js'
import {
  REQUEST_MARKER,
  appendRequestMarker,
  classifyProviderError,
  getProviderIdentity,
} from '../src/lib/providerGuard.js'
import {
  blockProvider,
  clearLocalData,
  clearProviderBlocklist,
  isProviderBlocked,
  readProviderBlocklist,
  unblockProvider,
} from '../src/lib/storage.js'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }

  clear() {
    this.values.clear()
  }
}

globalThis.localStorage = new MemoryStorage()

const markerCount = (value) => String(value).split(REQUEST_MARKER).length - 1

function directSettings(overrides = {}) {
  return {
    provider: 'custom',
    apiFormat: 'openai',
    endpoint: 'https://relay.example/tenant/v1/chat/completions',
    model: 'test-model',
    apiKey: 'test-key',
    authMode: 'bearer',
    tokenParam: 'max_tokens',
    stream: false,
    systemPrompt: 'System text',
    extraHeaders: '',
    ...overrides,
  }
}

function assertMarked(value) {
  assert.equal(String(value).endsWith(REQUEST_MARKER), true)
  assert.equal(markerCount(value), 1)
  assert.equal(/\s$/.test(String(value)), false)
}

test.beforeEach(() => {
  localStorage.clear()
})

test('request marker is exact, idempotent, unique, and supports empty user text', () => {
  assert.equal(appendRequestMarker(''), REQUEST_MARKER)
  assert.equal(appendRequestMarker('hello'), `hello\n\n${REQUEST_MARKER}`)
  assert.equal(appendRequestMarker(`hello\n\n${REQUEST_MARKER}`), `hello\n\n${REQUEST_MARKER}`)
  const normalized = appendRequestMarker(`mention ${REQUEST_MARKER} here\n\n${REQUEST_MARKER}\n`)
  assertMarked(normalized)
})

test('all direct inference formats mark the final user text without changing system text', () => {
  const prompt = 'Original prompt'
  const systemPrompt = 'System prompt must stay unchanged'
  const cases = [
    {
      format: 'openai',
      endpoint: 'https://api.example/v1/chat/completions',
      read: (body) => body.messages.at(-1).content,
      system: (body) => body.messages[0].content,
    },
    {
      format: 'openai-responses',
      endpoint: 'https://api.example/v1/responses',
      read: (body) => body.input.at(-1).content.at(-1).text,
      system: (body) => body.instructions,
    },
    {
      format: 'openai-completions',
      endpoint: 'https://api.example/v1/completions',
      read: (body) => body.prompt,
      system: (body) => body.prompt.startsWith(`${systemPrompt}\n\n`),
    },
    {
      format: 'anthropic',
      endpoint: 'https://api.example/v1/messages',
      read: (body) => body.messages.at(-1).content,
      system: (body) => body.system,
    },
    {
      format: 'gemini',
      endpoint: 'https://api.example/v1beta/models/{model}:generateContent',
      read: (body) => body.contents.at(-1).parts.at(-1).text,
      system: (body) => body.systemInstruction.parts[0].text,
    },
  ]

  for (const entry of cases) {
    const request = buildRequest(directSettings({
      apiFormat: entry.format,
      endpoint: entry.endpoint,
      systemPrompt,
    }), prompt, 100)
    assertMarked(entry.read(request.body))
    if (entry.format === 'openai-completions') assert.equal(entry.system(request.body), true)
    else assert.equal(entry.system(request.body), systemPrompt)
  }
})

test('subscription frontend payload and all Worker proxy formats keep one final marker', async () => {
  const originalFetch = globalThis.fetch
  const credential = {
    accessToken: 'access-token-long-enough',
    accountId: 'account-id',
    accountUuid: 'account-uuid',
    organizationUuid: 'organization-uuid',
    projectId: 'project-id',
    deviceId: 'device-id',
    sessionId: 'session-id',
  }
  const cases = [
    {
      provider: 'chatgpt',
      route: '/api/subscription/openai/responses',
      read: (body) => body.input[0].content[0].text,
    },
    {
      provider: 'claude_subscription',
      route: '/api/subscription/claude/messages',
      read: (body) => body.messages[0].content[0].text,
    },
    {
      provider: 'gemini_subscription',
      route: '/api/subscription/gemini/generate',
      read: (body) => body.request.contents[0].parts[0].text,
    },
    {
      provider: 'grok_subscription',
      route: '/api/subscription/grok/responses',
      read: (body) => body.input[0].content[0].text,
    },
  ]

  try {
    for (const entry of cases) {
      let upstreamBody
      globalThis.fetch = async (_url, init) => {
        upstreamBody = JSON.parse(init.body)
        return new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      const settings = {
        provider: entry.provider,
        model: 'test-model',
        systemPrompt: 'System prompt',
        reasoningEffort: 'high',
      }
      const frontendPayload = buildSubscriptionPayload(settings, credential, 'Original prompt', 100)
      assertMarked(frontendPayload.prompt)
      const response = await worker.fetch(new Request(`https://worker.example${entry.route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(frontendPayload),
      }), {})
      assert.equal(response.status, 200)
      await response.text()
      assertMarked(entry.read(upstreamBody))
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('structured block codes are detected regardless of status or supported code location', () => {
  const payloads = [
    { error: { code: 'sensitive_words_detected', message: 'blocked' } },
    { code: 'content_policy_violation', message: 'blocked' },
    { error: { type: 'content_policy_violation', message: 'blocked' } },
    { type: 'sensitive_words_detected', message: 'blocked' },
  ]
  for (const payload of payloads) {
    const error = classifyProviderError({ payload, status: 500, providerKey: 'provider-key' })
    assert.equal(error.providerBlock, true)
    assert.equal(error.status, 500)
    assert.equal(error.providerKey, 'provider-key')
    assert.equal(error.message, 'blocked')
  }
})

test('ordinary HTTP and vague message errors never classify as provider blocks', () => {
  for (const status of [403, 429, 500]) {
    const error = classifyProviderError({
      payload: { error: { code: 'forbidden', message: 'sensitive words policy failure' } },
      status,
    })
    assert.equal(error.providerBlock, false)
    assert.equal(error.status, status)
  }
})

test('explicit direct API refusal persists the block and prevents later fetches', async () => {
  const originalFetch = globalThis.fetch
  const settings = directSettings()
  let fetches = 0
  try {
    globalThis.fetch = async () => {
      fetches += 1
      return new Response(JSON.stringify({
        error: { code: 'sensitive_words_detected', message: 'Marker rejected' },
      }), { status: 500, headers: { 'content-type': 'application/json' } })
    }
    await assert.rejects(
      callProvider(settings, 'Prompt', 32),
      (error) => error.providerBlock && error.code === 'sensitive_words_detected' && error.status === 500,
    )
    assert.equal(fetches, 1)
    assert.equal(isProviderBlocked(settings)?.reasonCode, 'sensitive_words_detected')

    globalThis.fetch = async () => {
      fetches += 1
      throw new Error('must not fetch')
    }
    await assert.rejects(
      callProvider(settings, 'Prompt', 32),
      (error) => error.providerBlock && error.localBlock,
    )
    assert.equal(fetches, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('content_policy_violation blocks, while HTTP and network failures do not persist', async () => {
  const originalFetch = globalThis.fetch
  const settings = directSettings()
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      type: 'content_policy_violation',
      message: 'Marker rejected',
    }), { status: 500, headers: { 'content-type': 'application/json' } })
    await assert.rejects(callProvider(settings, 'Prompt', 32), (error) => error.providerBlock)
    assert.equal(readProviderBlocklist().length, 1)

    for (const status of [403, 429, 500]) {
      clearProviderBlocklist()
      globalThis.fetch = async () => new Response(JSON.stringify({
        error: { code: 'ordinary_error', message: 'Request failed' },
      }), { status, headers: { 'content-type': 'application/json' } })
      await assert.rejects(callProvider(settings, 'Prompt', 32), (error) => !error.providerBlock)
      assert.equal(readProviderBlocklist().length, 0)
    }

    globalThis.fetch = async () => {
      throw new TypeError('CORS or network failure')
    }
    await assert.rejects(callProvider(settings, 'Prompt', 32), /网络请求失败/)
    assert.equal(readProviderBlocklist().length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('provider keys collapse inference suffixes without mixing base paths, domains, or subscription providers', () => {
  const chat = getProviderIdentity(directSettings({
    apiFormat: 'openai',
    endpoint: 'https://relay.example/tenant-a/v1/chat/completions?trace=1#fragment',
  }))
  const responses = getProviderIdentity(directSettings({
    apiFormat: 'openai-responses',
    endpoint: 'https://relay.example/tenant-a/v1/responses/',
  }))
  const otherPath = getProviderIdentity(directSettings({ endpoint: 'https://relay.example/tenant-b/v1/chat/completions' }))
  const otherDomain = getProviderIdentity(directSettings({ endpoint: 'https://other.example/tenant-a/v1/chat/completions' }))
  assert.equal(chat.key, responses.key)
  assert.notEqual(chat.key, otherPath.key)
  assert.notEqual(chat.key, otherDomain.key)

  const chatgpt = getProviderIdentity({ provider: 'chatgpt', subscriptionApiUrl: 'https://worker.example/' })
  const claude = getProviderIdentity({ provider: 'claude_subscription', subscriptionApiUrl: 'https://worker.example/' })
  assert.notEqual(chatgpt.key, claude.key)
})

test('blocklist persists, deduplicates, unblocks, and is cleared with all local data', () => {
  const settings = directSettings()
  const first = blockProvider(settings, { code: 'sensitive_words_detected', status: 500 })
  blockProvider(settings, { code: 'content_policy_violation', status: 400 })
  assert.equal(readProviderBlocklist().length, 1)
  assert.equal(readProviderBlocklist()[0].reasonCode, 'content_policy_violation')
  assert.equal(unblockProvider(first.key), true)
  assert.equal(isProviderBlocked(settings), null)

  blockProvider(settings, { code: 'sensitive_words_detected', status: 500 })
  clearLocalData()
  assert.deepEqual(readProviderBlocklist(), [])
})

test('Worker preserves an explicit upstream block code even when upstream returns 500', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { code: 'content_policy_violation', message: 'Marker rejected upstream' },
    }), { status: 500, headers: { 'content-type': 'application/json' } })
    const body = buildSubscriptionPayload(
      { provider: 'chatgpt', model: 'test-model', systemPrompt: '' },
      { accessToken: 'access-token-long-enough', accountId: 'account-id' },
      'Prompt',
      100,
    )
    const response = await worker.fetch(new Request('https://worker.example/api/subscription/openai/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), {})
    const payload = await response.json()
    assert.equal(response.status, 500)
    assert.equal(payload.error.code, 'content_policy_violation')
    assert.equal(classifyProviderError({ payload, status: response.status }).providerBlock, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('model catalog and OAuth requests do not carry the inference marker', async () => {
  const originalFetch = globalThis.fetch
  const captured = []
  try {
    globalThis.fetch = async (url, init = {}) => {
      captured.push({ url: String(url), init })
      if (String(url).includes('/api/accounts/deviceauth/usercode')) {
        return new Response(JSON.stringify({ device_auth_id: 'device-id', user_code: 'ABCD-EFGH' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    await loadProviderModels(directSettings(), undefined)
    await worker.fetch(new Request('https://worker.example/api/oauth/openai/device/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }), {})
    assert.equal(captured[0].init.method, 'GET')
    assert.equal(captured[0].init.body, undefined)
    assert.equal(String(captured[1].init.body).includes(REQUEST_MARKER), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
