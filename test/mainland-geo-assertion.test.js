import assert from 'node:assert/strict'
import test from 'node:test'
import worker, { preferredGeo } from '../worker/index.js'

const SECRET = 'a-dedicated-mainland-geo-secret-with-more-than-32-characters'
const ORIGIN = 'https://frontend.example'

function geoRequest(country, geo = {}, headers = {}) {
  const request = new Request('https://geo.example.cn/api/geo/assertion', {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ nonce: crypto.randomUUID(), locale: 'zh-CN' }),
  })
  if (country) {
    Object.defineProperty(request, 'cf', {
      configurable: true,
      value: { country, ...geo },
    })
  }
  return request
}

function leaderboardRequest(country, geo = {}) {
  const request = new Request('https://rank.example/api/leaderboard')
  Object.defineProperty(request, 'cf', {
    configurable: true,
    value: { country, ...geo },
  })
  return request
}

test('a signed mainland assertion overrides a proxy exit location', async () => {
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    GEO_ASSERTION_HMAC_SECRET: SECRET,
  }
  const response = await worker.fetch(geoRequest('CN', {
    regionCode: 'ZJ',
    region: 'Zhejiang',
    city: 'Hangzhou',
  }), env)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.mainland, true)
  assert.equal(payload.context.countryName, '中国')
  assert.equal(payload.context.provinceName, '浙江省')

  const geo = await preferredGeo(leaderboardRequest('US'), env, payload.assertion)
  assert.deepEqual(geo, {
    countryCode: 'CN',
    provinceCode: 'ZJ',
    provinceName: '浙江省',
    cityName: 'Hangzhou',
    source: 'mainland-direct',
  })
})

test('invalid assertions fall back to the leaderboard edge location', async () => {
  const request = leaderboardRequest('US')
  const geo = await preferredGeo(request, { GEO_ASSERTION_HMAC_SECRET: SECRET }, 'invalid.assertion')
  assert.deepEqual(geo, {
    countryCode: 'US',
    provinceCode: null,
    provinceName: null,
    cityName: null,
    source: 'edge',
  })
})

test('Hong Kong, Macao, and Taiwan never receive mainland-direct assertions', async () => {
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    GEO_ASSERTION_HMAC_SECRET: SECRET,
  }
  for (const country of ['HK', 'MO', 'TW']) {
    const response = await worker.fetch(geoRequest(country), env)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { mainland: false })
  }
})

test('self-hosted geo headers are accepted only when explicitly trusted', async () => {
  const headers = {
    'x-geo-country': 'CN',
    'x-geo-region-code': 'GD',
    'x-geo-region': 'Guangdong',
    'x-geo-city': 'Shenzhen',
  }
  const baseEnv = {
    ALLOWED_ORIGINS: ORIGIN,
    GEO_ASSERTION_HMAC_SECRET: SECRET,
  }
  const rejected = await worker.fetch(geoRequest('', {}, headers), baseEnv)
  assert.deepEqual(await rejected.json(), { mainland: false })

  const accepted = await worker.fetch(
    geoRequest('', {}, headers),
    { ...baseEnv, TRUST_GEO_HEADERS: 'true' },
  )
  const payload = await accepted.json()
  assert.equal(payload.mainland, true)
  assert.equal(payload.context.cityName, 'Shenzhen')
})
