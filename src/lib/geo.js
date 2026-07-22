const GEO_REQUEST_TIMEOUT = 2500
const POSITIVE_CACHE_SKEW_SECONDS = 15
const NEGATIVE_CACHE_MS = 60_000

const assertionCache = new Map()
const assertionRequests = new Map()

export function deriveMainlandGeoEndpoint(base) {
  const value = String(base || '').trim()
  if (!value) return ''
  let url
  try {
    url = new URL(value, globalThis.location?.origin || 'http://localhost')
  } catch {
    throw new Error('大陆地区探测地址无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('大陆地区探测仅支持 HTTP 或 HTTPS')
  url.search = ''
  url.hash = ''
  if (!/\/api\/geo\/assertion\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/api/geo/assertion`.replace(/\/+/g, '/')
  }
  return url.toString()
}

async function requestMainlandGeoAssertion(endpoint) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), GEO_REQUEST_TIMEOUT)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: crypto.randomUUID() }),
      signal: controller.signal,
    })
    if (!response.ok) return { assertion: '', expiresAt: 0 }
    const payload = await response.json()
    const expiresAt = Number(payload.expiresAt) || 0
    if (
      payload.mainland !== true ||
      typeof payload.assertion !== 'string' ||
      !payload.assertion ||
      expiresAt <= Math.floor(Date.now() / 1000) + POSITIVE_CACHE_SKEW_SECONDS
    ) {
      return { assertion: '', expiresAt: 0 }
    }
    return { assertion: payload.assertion, expiresAt }
  } catch {
    return { assertion: '', expiresAt: 0 }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function resolveMainlandGeoAssertion(base) {
  let endpoint
  try {
    endpoint = deriveMainlandGeoEndpoint(base)
  } catch {
    return ''
  }
  if (!endpoint) return ''
  const now = Date.now()
  const cached = assertionCache.get(endpoint)
  if (cached && cached.validUntil > now) return cached.assertion
  if (assertionRequests.has(endpoint)) return assertionRequests.get(endpoint)

  const request = requestMainlandGeoAssertion(endpoint)
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

export function clearMainlandGeoAssertionCache() {
  assertionCache.clear()
  assertionRequests.clear()
}
