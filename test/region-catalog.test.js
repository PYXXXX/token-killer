import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCityOptions, loadRegionOptions } from '../src/lib/regionCatalog.js'

test('China region catalog keeps special regions under China', async () => {
  const values = (await loadRegionOptions('CN')).map((option) => option.value)
  assert.equal(values.includes('HK'), true)
  assert.equal(values.includes('MO'), true)
  assert.equal(values.includes('TW'), true)
})

test('mainland city catalog exposes real prefecture-level city names', async () => {
  const values = (await loadCityOptions('CN', 'ZJ')).map((option) => option.value)
  assert.equal(values.includes('杭州市'), true)
  assert.equal(values.includes('随便填写的城市'), false)
})

test('Hong Kong and Macao remain province-only while Taiwan exposes real cities', async () => {
  assert.deepEqual(await loadCityOptions('CN', 'HK'), [])
  assert.deepEqual(await loadCityOptions('CN', 'MO'), [])
  const taiwan = (await loadCityOptions('CN', 'TW')).map((option) => option.value)
  assert.equal(taiwan.includes('台北市'), true)
  assert.equal(taiwan.includes('高雄市'), true)
})
