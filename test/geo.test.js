import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearMainlandGeoAssertionCache,
  checkMainlandGeoService,
  defaultMainlandGeoEndpoint,
  deriveMainlandGeoEndpoint,
  resolveMainlandGeoAssertion,
} from '../src/lib/geo.js'

test('derives a geo assertion endpoint from either a base URL or full endpoint', () => {
  assert.equal(
    deriveMainlandGeoEndpoint('https://geo.example.cn/'),
    'https://geo.example.cn/geo',
  )
  assert.equal(deriveMainlandGeoEndpoint('https://geo.example.cn/geo'), 'https://geo.example.cn/geo')
  assert.equal(
    deriveMainlandGeoEndpoint('https://geo.example.cn/prefix/api/geo/assertion?ignored=1'),
    'https://geo.example.cn/prefix/api/geo/assertion',
  )
  assert.match(defaultMainlandGeoEndpoint(), /\/geo$/)
})

test('uses and caches only a positive mainland assertion', async (context) => {
  clearMainlandGeoAssertionCache()
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
    clearMainlandGeoAssertionCache()
  })
  let requests = 0
  globalThis.fetch = async (url, options) => {
    requests += 1
    assert.equal(url, 'https://geo.example.cn/geo')
    assert.equal(options.method, 'POST')
    assert.ok(JSON.parse(options.body).nonce.length >= 16)
    return new Response(JSON.stringify({
      mainland: true,
      assertion: 'signed-mainland-location',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const [first, second] = await Promise.all([
    resolveMainlandGeoAssertion('https://geo.example.cn'),
    resolveMainlandGeoAssertion('https://geo.example.cn'),
  ])
  const cached = await resolveMainlandGeoAssertion('https://geo.example.cn')
  assert.equal(first, 'signed-mainland-location')
  assert.equal(second, first)
  assert.equal(cached, first)
  assert.equal(requests, 1)
})

test('manual probe reports a reachable non-mainland result without an assertion', async (context) => {
  clearMainlandGeoAssertionCache()
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
    clearMainlandGeoAssertionCache()
  })
  globalThis.fetch = async () => new Response(JSON.stringify({
    mainland: false,
    context: { directory: ['新加坡'] },
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  const result = await checkMainlandGeoService('https://geo.example.cn')
  assert.equal(result.reachable, true)
  assert.equal(result.mainland, false)
  assert.deepEqual(result.context.directory, ['新加坡'])
})

test('falls back silently for non-mainland and failed probes', async (context) => {
  clearMainlandGeoAssertionCache()
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
    clearMainlandGeoAssertionCache()
  })

  globalThis.fetch = async () => new Response(JSON.stringify({ mainland: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(await resolveMainlandGeoAssertion('https://outside.example'), '')

  globalThis.fetch = async () => {
    throw new TypeError('network failed')
  }
  assert.equal(await resolveMainlandGeoAssertion('https://unreachable.example'), '')
  assert.equal(await resolveMainlandGeoAssertion('not a valid URL'), '')
})
