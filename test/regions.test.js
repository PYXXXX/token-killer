import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chinaRegionOptions,
  countryOptions,
  sanitizeManualRegion,
} from '../src/lib/regions.js'

test('manual country options include China without listing Hong Kong, Macao, or Taiwan separately', () => {
  const values = countryOptions('zh-CN').map((option) => option.value)
  assert.equal(values.includes('CN'), true)
  assert.equal(values.includes('HK'), false)
  assert.equal(values.includes('MO'), false)
  assert.equal(values.includes('TW'), false)
})

test('Hong Kong, Macao, and Taiwan remain available as China province-level regions', () => {
  const values = chinaRegionOptions('zh-CN').map((option) => option.value)
  assert.equal(values.includes('HK'), true)
  assert.equal(values.includes('MO'), true)
  assert.equal(values.includes('TW'), true)
})

test('manual region values are normalized before leaving the browser', () => {
  assert.deepEqual(sanitizeManualRegion({
    countryCode: ' us ',
    regionCode: 'ca<script>',
    regionName: '  Cali<fornia  ',
    cityName: ' San/Francisco ',
  }), {
    countryCode: 'US',
    regionCode: 'CASCRIPT',
    regionName: 'Cali fornia',
    cityName: 'San Francisco',
  })
})
