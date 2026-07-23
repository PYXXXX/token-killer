import assert from 'node:assert/strict'
import test from 'node:test'
import {
  geoContextFromCity,
  lookupGeoContext,
  normalizeClientIp,
  requestClientIp,
} from '../server/geo.js'

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
