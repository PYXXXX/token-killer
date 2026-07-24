import assert from 'node:assert/strict'
import test from 'node:test'
import {
  geoContextFromCity,
  isGeoAssertionPath,
  lookupGeoContext,
  mergeGeoContexts,
  normalizeClientIp,
  requestClientIp,
  trustedCloudflareGeoContext,
} from '../server/geo.js'

const maxMindChina = {
  country: 'CN',
  regionCode: 'ZJ',
  region: '浙江省',
  city: '杭州市',
}

function trustedHeaders(values = {}) {
  const entries = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]))
  return { get: (name) => entries.get(String(name).toLowerCase()) || '' }
}

test('normalizes direct, forwarded, and IPv4-mapped client addresses', () => {
  assert.equal(normalizeClientIp('203.0.113.8'), '203.0.113.8')
  assert.equal(normalizeClientIp('203.0.113.8:443'), '203.0.113.8')
  assert.equal(normalizeClientIp('::ffff:203.0.113.8'), '203.0.113.8')
  assert.equal(normalizeClientIp('2001:db8::1'), '2001:db8::1')
  assert.equal(normalizeClientIp('not-an-ip'), '')
})

test('uses proxy IP headers only when explicitly trusted', () => {
  const request = { socket: { remoteAddress: '10.0.0.2' } }
  const headers = new Headers({ 'x-real-ip': '203.0.113.8' })
  assert.equal(requestClientIp(request, headers, false), '10.0.0.2')
  assert.equal(requestClientIp(request, headers, true), '203.0.113.8')
})

test('converts a MaxMind city response into Worker geo metadata', () => {
  const response = {
    country: { isoCode: 'CN' },
    subdivisions: [{ isoCode: 'ZJ', names: { en: 'Zhejiang', 'zh-CN': '浙江省' } }],
    city: { names: { en: 'Hangzhou', 'zh-CN': '杭州市' } },
  }
  assert.deepEqual(geoContextFromCity(response), {
    country: 'CN',
    regionCode: 'ZJ',
    region: '浙江省',
    city: '杭州市',
  })
  assert.deepEqual(lookupGeoContext({ city: () => response }, '203.0.113.8'), geoContextFromCity(response))
  assert.deepEqual(lookupGeoContext({
    city: () => { throw new Error('wrong database type') },
    country: () => ({ country: { isoCode: 'CN' } }),
  }, '203.0.113.8'), {
    country: 'CN',
    regionCode: '',
    region: '',
    city: '',
  })
  assert.equal(lookupGeoContext({
    city: () => { throw new Error('not found') },
    country: () => { throw new Error('not found') },
  }, '203.0.113.8'), null)
})

test('trusted Cloudflare country, region, and city take priority over MaxMind', () => {
  const cloudflare = trustedCloudflareGeoContext(new Headers({
    'x-token-killer-geo-country': 'CN',
    'x-token-killer-geo-region-code': 'BJ',
    'x-token-killer-geo-region': 'Beijing',
    'x-token-killer-geo-city': 'Beijing',
  }), true)
  assert.deepEqual(mergeGeoContexts(cloudflare, maxMindChina), {
    country: 'CN',
    regionCode: 'BJ',
    region: 'Beijing',
    city: 'Beijing',
  })
})

test('MaxMind supplements Cloudflare country-only data for the same country', () => {
  const cloudflare = trustedCloudflareGeoContext(new Headers({
    'x-token-killer-geo-country': 'CN',
  }), true)
  assert.deepEqual(mergeGeoContexts(cloudflare, maxMindChina), maxMindChina)
})

test('Cloudflare and MaxMind country conflicts are never mixed', () => {
  const cloudflare = trustedCloudflareGeoContext(new Headers({
    'x-token-killer-geo-country': 'US',
  }), true)
  assert.deepEqual(mergeGeoContexts(cloudflare, maxMindChina), {
    country: 'US',
    regionCode: '',
    region: '',
    city: '',
  })
})

test('MaxMind city is not used when province information conflicts', () => {
  const cloudflare = trustedCloudflareGeoContext(new Headers({
    'x-token-killer-geo-country': 'CN',
    'x-token-killer-geo-region-code': 'JS',
    'x-token-killer-geo-region': 'Jiangsu',
  }), true)
  assert.deepEqual(mergeGeoContexts(cloudflare, maxMindChina), {
    country: 'CN',
    regionCode: 'JS',
    region: 'Jiangsu',
    city: '',
  })
})

test('MaxMind behavior is unchanged without trusted Cloudflare data', () => {
  assert.deepEqual(mergeGeoContexts(null, maxMindChina), maxMindChina)
})

test('trusted Cloudflare fields require valid countries and clean control characters', () => {
  assert.equal(trustedCloudflareGeoContext(new Headers({
    'x-token-killer-geo-country': 'C1',
  }), true), null)
  assert.equal(trustedCloudflareGeoContext(new Headers({
    'x-token-killer-geo-country': 'cn',
  }), true), null)
  assert.equal(trustedCloudflareGeoContext(new Headers({
    'x-token-killer-geo-country': 'XX',
  }), true), null)

  const cleaned = trustedCloudflareGeoContext(trustedHeaders({
    'x-token-killer-geo-country': 'CN',
    'x-token-killer-geo-region-code': 'CN-ZJ',
    'x-token-killer-geo-region': 'Zhe\u0000jiang',
    'x-token-killer-geo-city': 'Hang\u0007zhou',
  }), true)
  assert.deepEqual(cleaned, {
    country: 'CN',
    regionCode: 'ZJ',
    region: 'Zhejiang',
    city: 'Hangzhou',
  })
  assert.equal(trustedCloudflareGeoContext(trustedHeaders({
    'x-token-killer-geo-country': 'CN',
    'x-token-killer-geo-region': 'R'.repeat(120),
    'x-token-killer-geo-city': 'C'.repeat(120),
  }), true).region.length, 80)
  assert.equal(trustedCloudflareGeoContext(trustedHeaders({
    'x-token-killer-geo-country': 'CN',
    'x-token-killer-geo-city': 'C'.repeat(120),
  }), true).city.length, 80)
})

test('direct requests cannot activate forged Cloudflare or internal geo headers', () => {
  const forged = new Headers({
    'cf-ipcountry': 'US',
    'cf-region-code': 'CA',
    'cf-ipcity': 'San Francisco',
    'x-token-killer-geo-country': 'US',
    'x-token-killer-geo-region-code': 'CA',
    'x-token-killer-geo-city': 'San Francisco',
  })
  assert.equal(trustedCloudflareGeoContext(forged, false), null)
  assert.deepEqual(mergeGeoContexts(trustedCloudflareGeoContext(forged, false), maxMindChina), maxMindChina)
  assert.equal(trustedCloudflareGeoContext(new Headers({ 'cf-ipcountry': 'US' }), true), null)
})

test('/geo and /api/geo/assertion share the same Node geo path', () => {
  assert.equal(isGeoAssertionPath('/geo'), true)
  assert.equal(isGeoAssertionPath('/api/geo/assertion'), true)
  assert.equal(isGeoAssertionPath('/api/leaderboard'), false)
})
