import fs from 'node:fs'
import { isIP } from 'node:net'
import { Reader } from '@maxmind/geoip2-node'

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
    regionCode: String(subdivision?.isoCode || ''),
    region: String(subdivision?.names?.['zh-CN'] || subdivision?.names?.en || ''),
    city: String(response?.city?.names?.['zh-CN'] || response?.city?.names?.en || ''),
  }
}

export function openGeoIpDatabase(filename) {
  const path = String(filename || '').trim()
  if (!path || !fs.existsSync(path)) return null
  return Reader.openBuffer(fs.readFileSync(path))
}

export function lookupGeoContext(reader, ip) {
  if (!reader || !ip) return null
  try {
    return geoContextFromCity(reader.city(ip))
  } catch {
    return null
  }
}
