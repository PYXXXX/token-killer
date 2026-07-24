import assert from 'node:assert/strict'
import test from 'node:test'
import worker, { preferredGeo } from '../worker/index.js'

const SECRET = 'a-dedicated-region-geo-secret-with-more-than-32-characters'
const ORIGIN = 'https://frontend.example'

function geoRequest(country, geo = {}, headers = {}, pathname = '/geo') {
  const request = new Request(`https://geo.example${pathname}`, {
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

test('a signed China region assertion overrides another network exit', async () => {
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
  assert.equal(payload.located, true)
  assert.equal(payload.context.countryName, '中国')
  assert.equal(payload.context.provinceName, '浙江省')

  const geo = await preferredGeo(leaderboardRequest('US'), env, payload.assertion)
  assert.deepEqual(geo, {
    countryCode: 'CN',
    provinceCode: 'ZJ',
    provinceName: '浙江省',
    cityName: 'Hangzhou',
    source: 'geo-service',
  })
})

test('a signed non-China assertion keeps its region and city ranking', async () => {
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    GEO_ASSERTION_HMAC_SECRET: SECRET,
  }
  const response = await worker.fetch(geoRequest('SG', {
    regionCode: '01',
    region: 'Central Singapore',
    city: 'Singapore',
  }), env)
  const payload = await response.json()
  assert.equal(payload.located, true)
  assert.deepEqual(payload.context.directory, ['新加坡', 'Central Singapore', 'Singapore'])
  assert.deepEqual(await preferredGeo(leaderboardRequest('US'), env, payload.assertion), {
    countryCode: 'SG',
    provinceCode: '01',
    provinceName: 'Central Singapore',
    cityName: 'Singapore',
    source: 'geo-service',
  })
})

test('a manual region overrides the network exit and is sanitized', async () => {
  const geo = await preferredGeo(
    leaderboardRequest('HK'),
    {},
    '',
    {
      countryCode: 'US',
      regionCode: 'US-CA',
      regionName: 'California<script>',
      cityName: 'San Francisco',
    },
  )
  assert.deepEqual(geo, {
    countryCode: 'US',
    provinceCode: 'CA',
    provinceName: 'California script',
    cityName: 'San Francisco',
    source: 'manual',
  })
})

test('the legacy geo assertion path remains available', async () => {
  const response = await worker.fetch(geoRequest('CN', { regionCode: 'BJ', city: 'Beijing' }, {}, '/api/geo/assertion'), {
    ALLOWED_ORIGINS: ORIGIN,
    GEO_ASSERTION_HMAC_SECRET: SECRET,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).located, true)
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

test('Hong Kong and Macao stay in China at province level', async () => {
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    GEO_ASSERTION_HMAC_SECRET: SECRET,
  }
  const expected = {
    HK: '香港特别行政区',
    MO: '澳门特别行政区',
  }
  for (const country of Object.keys(expected)) {
    const response = await worker.fetch(geoRequest(country), env)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.located, true)
    assert.equal(payload.context.countryName, '中国')
    assert.equal(payload.context.provinceName, expected[country])
    assert.equal(payload.context.cityName, null)
    const geo = await preferredGeo(leaderboardRequest('US'), env, payload.assertion)
    assert.equal(geo.countryCode, 'CN')
    assert.equal(geo.provinceCode, country)
    assert.equal(geo.cityName, null)
  }
})

test('Taiwan stays under China and supports city rankings', async () => {
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    GEO_ASSERTION_HMAC_SECRET: SECRET,
  }
  const response = await worker.fetch(geoRequest('TW', { city: 'Taipei' }), env)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.located, true)
  assert.equal(payload.context.countryName, '中国')
  assert.equal(payload.context.provinceName, '台湾省')
  assert.equal(payload.context.cityName, 'Taipei')

  const geo = await preferredGeo(leaderboardRequest('US'), env, payload.assertion)
  assert.equal(geo.countryCode, 'CN')
  assert.equal(geo.provinceCode, 'TW')
  assert.equal(geo.cityName, 'Taipei')

  const manualGeo = await preferredGeo(
    leaderboardRequest('US'),
    env,
    '',
    { countryCode: 'CN', regionCode: 'TW', regionName: '台湾省', cityName: '台北' },
  )
  assert.equal(manualGeo.countryCode, 'CN')
  assert.equal(manualGeo.provinceCode, 'TW')
  assert.equal(manualGeo.cityName, '台北市')
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
  assert.deepEqual(await rejected.json(), { located: false, mainland: false, context: null })

  const accepted = await worker.fetch(
    geoRequest('', {}, headers),
    { ...baseEnv, TRUST_GEO_HEADERS: 'true' },
  )
  const payload = await accepted.json()
  assert.equal(payload.located, true)
  assert.equal(payload.context.cityName, 'Shenzhen')
})
