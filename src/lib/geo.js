import { API_PREFIX, API_ROUTES } from './apiRoutes.js'

const GEO_REQUEST_TIMEOUT = 2500
const POSITIVE_CACHE_SKEW_SECONDS = 15
const NEGATIVE_CACHE_MS = 60_000

const assertionCache = new Map()
const assertionRequests = new Map()

export function defaultGeoEndpoint() {
  return new URL(API_ROUTES.geoAssertion, globalThis.location?.origin || 'http://localhost').toString()
}

export function deriveGeoEndpoint(base) {
  const value = String(base || '').trim()
  if (!value) return ''
  let url
  try {
    url = new URL(value, globalThis.location?.origin || 'http://localhost')
  } catch {
    throw new Error('地区探测地址无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('地区探测仅支持 HTTP 或 HTTPS')
  url.search = ''
  url.hash = ''
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = /\/geo$/i.test(pathname)
    ? `${pathname.slice(0, -'/geo'.length)}${API_ROUTES.geoAssertion}`.replace(/\/+/g, '/')
    : /\/api\/geo\/assertion$/i.test(pathname)
      ? pathname
      : pathname.endsWith(API_PREFIX)
        ? `${pathname}/geo/assertion`.replace(/\/+/g, '/')
        : `${pathname}${API_ROUTES.geoAssertion}`.replace(/\/+/g, '/')
  return url.toString()
}

async function requestGeoAssertion(endpoint, locale = 'zh-CN') {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), GEO_REQUEST_TIMEOUT)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: crypto.randomUUID(), locale: locale === 'en' ? 'en' : 'zh-CN' }),
      signal: controller.signal,
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      return { reachable: false, located: false, assertion: '', expiresAt: 0, context: null, error: '地区探测服务返回了无法识别的响应' }
    }
    if (!response.ok) {
      const message = typeof payload.error === 'string' ? payload.error : `地区探测服务返回 ${response.status}`
      return { reachable: false, located: false, assertion: '', expiresAt: 0, context: null, error: message }
    }
    const expiresAt = Number(payload.expiresAt) || 0
    const located = payload.located === true || payload.mainland === true
    if (
      !located ||
      typeof payload.assertion !== 'string' ||
      !payload.assertion ||
      expiresAt <= Math.floor(Date.now() / 1000) + POSITIVE_CACHE_SKEW_SECONDS
    ) {
      return {
        reachable: true,
        located: false,
        assertion: '',
        expiresAt: 0,
        context: payload.context || null,
        error: '',
      }
    }
    return {
      reachable: true,
      located: true,
      assertion: payload.assertion,
      expiresAt,
      context: payload.context || null,
      error: '',
    }
  } catch (error) {
    const message = error?.name === 'AbortError' ? '地区探测服务连接超时' : '无法连接地区探测服务，请检查地址和跨域设置'
    return { reachable: false, located: false, assertion: '', expiresAt: 0, context: null, error: message }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function resolveGeoAssertion(base, locale = 'zh-CN') {
  let endpoint
  try {
    endpoint = deriveGeoEndpoint(base)
  } catch {
    return ''
  }
  if (!endpoint) return ''
  const now = Date.now()
  const cached = assertionCache.get(endpoint)
  if (cached && cached.validUntil > now) return cached.assertion
  if (assertionRequests.has(endpoint)) return assertionRequests.get(endpoint)

  const request = requestGeoAssertion(endpoint, locale)
    .then((result) => {
      const validUntil = result.assertion
        ? Math.max(now, (result.expiresAt - POSITIVE_CACHE_SKEW_SECONDS) * 1000)
        : now + NEGATIVE_CACHE_MS
      assertionCache.set(endpoint, { assertion: result.assertion, validUntil })
      return result.assertion
    })
    .finally(() => assertionRequests.delete(endpoint))
  assertionRequests.set(endpoint, request)
  return request
}

export async function checkGeoService(base, locale = 'zh-CN') {
  let endpoint
  try {
    endpoint = deriveGeoEndpoint(base)
  } catch (error) {
    return { reachable: false, located: false, assertion: '', expiresAt: 0, context: null, error: error.message }
  }
  if (!endpoint) {
    return { reachable: false, located: false, assertion: '', expiresAt: 0, context: null, error: '请先填写地区探测地址' }
  }
  assertionCache.delete(endpoint)
  assertionRequests.delete(endpoint)
  const result = await requestGeoAssertion(endpoint, locale)
  const now = Date.now()
  const validUntil = result.assertion
    ? Math.max(now, (result.expiresAt - POSITIVE_CACHE_SKEW_SECONDS) * 1000)
    : now + NEGATIVE_CACHE_MS
  assertionCache.set(endpoint, { assertion: result.assertion, validUntil })
  return { ...result, endpoint }
}

export function clearGeoAssertionCache() {
  assertionCache.clear()
  assertionRequests.clear()
}
