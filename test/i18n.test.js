import test from 'node:test'
import assert from 'node:assert/strict'
import { localeTag, resolveLocale, translateText } from '../src/lib/i18n.js'
import { publicGeoContext } from '../worker/index.js'

test('locale resolution honors explicit choices and exposes stable locale tags', () => {
  assert.equal(resolveLocale('zh-CN'), 'zh-CN')
  assert.equal(resolveLocale('en'), 'en')
  assert.equal(localeTag('zh-CN'), 'zh-CN')
  assert.equal(localeTag('en'), 'en-US')
})

test('interface copy and generated labels translate without changing unknown user text', () => {
  assert.equal(translateText('en', '消耗目标'), 'Burn target')
  assert.equal(translateText('en', '第 7 轮请求中，输出上限 4.1K'), 'Round 7 in progress · output limit 4.1K')
  assert.equal(translateText('en', '第 3 / 10 页'), 'Page 3 / 10')
  assert.equal(translateText('en', '燃烧者 #145473'), 'Burner #145473')
  assert.equal(translateText('en', '内置快照。金额模式是预算保护估算，最终账单以供应商为准。'), 'Built-in snapshot. Budget mode is a protective estimate; the provider bill is authoritative.')
  assert.equal(translateText('en', 'my untouched custom prompt'), 'my untouched custom prompt')
  assert.equal(translateText('zh-CN', '消耗目标'), '消耗目标')
})

test('leaderboard geography follows the requested interface language', () => {
  const geo = {
    countryCode: 'CN',
    provinceCode: 'ZJ',
    provinceName: '浙江省',
    cityName: 'Hangzhou',
  }
  const Chinese = publicGeoContext(geo, 'zh-CN')
  const English = publicGeoContext(geo, 'en')
  assert.deepEqual(Chinese.directory, ['中国', '浙江省', 'Hangzhou'])
  assert.deepEqual(English.directory, ['China', 'Zhejiang', 'Hangzhou'])
  assert.equal(Chinese.scopes[0].label, '全球')
  assert.equal(English.scopes[0].label, 'Global')
})
