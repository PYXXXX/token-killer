import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkGeoService,
  clearGeoAssertionCache,
  defaultGeoEndpoint,
  deriveGeoEndpoint,
  resolveGeoAssertion,
} from '../src/lib/geo.js'

test('derives a geo assertion endpoint from either a base URL or full endpoint', () => {
  assert.equal(
    deriveGeoEndpoint('https://geo.example.cn/'),
    'https://geo.example.cn/geo',
  )
  assert.equal(deriveGeoEndpoint('https://geo.example.cn/geo'), 'https://geo.example.cn/geo')
  assert.equal(
    deriveGeoEndpoint('https://geo.example.cn/prefix/api/geo/assertion?ignored=1'),
    'https://geo.example.cn/prefix/api/geo/assertion',
  )
  assert.match(defaultGeoEndpoint(), /\/geo$/)
})

test('uses and caches a signed region assertion', async (context) => {
  clearGeoAssertionCache()
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
    clearGeoAssertionCache()
  })
  let requests = 0
  globalThis.fetch = async (url, options) => {
    requests += 1
    assert.equal(url, 'https://geo.example.cn/geo')
    assert.equal(options.method, 'POST')
    assert.ok(JSON.parse(options.body).nonce.length >= 16)
    return new Response(JSON.stringify({
      located: true,
      assertion: 'signed-region-location',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const [first, second] = await Promise.all([
    resolveGeoAssertion('https://geo.example.cn'),
    resolveGeoAssertion('https://geo.example.cn'),
  ])
  const cached = await resolveGeoAssertion('https://geo.example.cn')
  assert.equal(first, 'signed-region-location')
  assert.equal(second, first)
  assert.equal(cached, first)
  assert.equal(requests, 1)
})

test('manual probe reports a signed non-China network exit', async (context) => {
  clearGeoAssertionCache()
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
    clearGeoAssertionCache()
  })
  globalThis.fetch = async () => new Response(JSON.stringify({
    located: true,
    assertion: 'signed-singapore-location',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    context: { directory: ['新加坡'] },
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  const result = await checkGeoService('https://geo.example.cn')
  assert.equal(result.reachable, true)
  assert.equal(result.located, true)
  assert.equal(result.assertion, 'signed-singapore-location')
  assert.deepEqual(result.context.directory, ['新加坡'])
})

test('falls back silently for unknown and failed probes', async (context) => {
  clearGeoAssertionCache()
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
    clearGeoAssertionCache()
  })

  globalThis.fetch = async () => new Response(JSON.stringify({ located: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(await resolveGeoAssertion('https://unknown.example'), '')

  globalThis.fetch = async () => {
    throw new TypeError('network failed')
  }
  assert.equal(await resolveGeoAssertion('https://unreachable.example'), '')
  assert.equal(await resolveGeoAssertion('not a valid URL'), '')
})
