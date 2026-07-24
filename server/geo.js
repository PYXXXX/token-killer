import fs from 'node:fs'
import { isIP } from 'node:net'
import { Reader } from '@maxmind/geoip2-node'
import { API_ROUTES } from '../src/lib/apiRoutes.js'

const INTERNAL_GEO_HEADERS = {
  country: 'x-token-killer-geo-country',
  region: 'x-token-killer-geo-region',
  regionCode: 'x-token-killer-geo-region-code',
  city: 'x-token-killer-geo-city',
}

function cleanGeoText(value, maxLength) {
  return String(value || '')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function normalizedRegionCode(value, country) {
  const code = cleanGeoText(value, 16).toUpperCase()
  if (!/^[A-Z0-9-]{1,12}$/.test(code)) return ''
  return code.replace(new RegExp(`^${country}-`), '')
}

function comparableRegionName(value) {
  return cleanGeoText(value, 80)
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\s_-]+/g, '')
}

export function isGeoAssertionPath(pathname) {
  return String(pathname || '') === API_ROUTES.geoAssertion
}

export function normalizeClientIp(value) {
  let ip = String(value || '').split(',')[0].trim()
  if (!ip) return ''
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']') > 0 ? ip.indexOf(']') : undefined)
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, '')
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7)
  return isIP(ip) ? ip : ''
}

export function requestClientIp(request, headers, trustProxyHeaders = false) {
  if (trustProxyHeaders) {
    const forwarded = headers.get('x-real-ip')
      || headers.get('cf-connecting-ip')
      || headers.get('true-client-ip')
      || headers.get('x-forwarded-for')
    const trusted = normalizeClientIp(forwarded)
    if (trusted) return trusted
  }
  return normalizeClientIp(request.socket?.remoteAddress)
}

export function geoContextFromCity(response) {
  const country = String(response?.country?.isoCode || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return null
  const subdivision = response?.subdivisions?.[0] || response?.mostSpecificSubdivision || null
  return {
    country,
    regionCode: normalizedRegionCode(subdivision?.isoCode, country),
    region: cleanGeoText(subdivision?.names?.['zh-CN'] || subdivision?.names?.en, 80),
    city: cleanGeoText(response?.city?.names?.['zh-CN'] || response?.city?.names?.en, 80),
  }
}

export function trustedCloudflareGeoContext(headers, trusted = false) {
  if (!trusted || !headers || typeof headers.get !== 'function') return null
  const country = cleanGeoText(headers.get(INTERNAL_GEO_HEADERS.country), 2)
  if (!/^[A-Z]{2}$/.test(country) || country === 'XX') return null

  return {
    country,
    regionCode: normalizedRegionCode(headers.get(INTERNAL_GEO_HEADERS.regionCode), country),
    region: cleanGeoText(headers.get(INTERNAL_GEO_HEADERS.region), 80),
    city: cleanGeoText(headers.get(INTERNAL_GEO_HEADERS.city), 80),
  }
}

export function mergeGeoContexts(cloudflare, maxMind) {
  if (!cloudflare?.country) return maxMind?.country ? { ...maxMind } : null
  if (!maxMind?.country || cloudflare.country !== maxMind.country) return { ...cloudflare }

  const cloudflareRegionCode = normalizedRegionCode(cloudflare.regionCode, cloudflare.country)
  const maxMindRegionCode = normalizedRegionCode(maxMind.regionCode, maxMind.country)
  const cloudflareRegionName = comparableRegionName(cloudflare.region)
  const maxMindRegionName = comparableRegionName(maxMind.region)
  const regionCodeConflict = cloudflareRegionCode
    && maxMindRegionCode
    && cloudflareRegionCode !== maxMindRegionCode
  const regionNameConflict = !regionCodeConflict
    && !(cloudflareRegionCode && maxMindRegionCode)
    && cloudflareRegionName
    && maxMindRegionName
    && cloudflareRegionName !== maxMindRegionName
  const regionConflict = Boolean(regionCodeConflict || regionNameConflict)

  return {
    country: cloudflare.country,
    regionCode: cloudflareRegionCode || (regionConflict ? '' : maxMindRegionCode),
    region: cleanGeoText(cloudflare.region, 80) || (regionConflict ? '' : cleanGeoText(maxMind.region, 80)),
    city: cleanGeoText(cloudflare.city, 80) || (regionConflict ? '' : cleanGeoText(maxMind.city, 80)),
  }
}

export function openGeoIpDatabase(filename) {
  const path = String(filename || '').trim()
  if (!path || !fs.existsSync(path)) return null
  return Reader.openBuffer(fs.readFileSync(path))
}

export function lookupGeoContext(reader, ip) {
  if (!reader || !ip) return null
  for (const method of ['city', 'country']) {
    if (typeof reader[method] !== 'function') continue
    try {
      return geoContextFromCity(reader[method](ip))
    } catch {
      // A country database rejects city lookups, so fall back to country().
    }
  }
  return null
}
