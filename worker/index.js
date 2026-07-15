import { handleSubscriptionApi, subscriptionConfigured } from './subscription.js'
import { rankForTokens } from '../src/lib/ranks.js'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

const SESSION_TTL_SECONDS = 24 * 60 * 60
const SESSION_LIMIT_PER_HOUR = 20
const MAX_TOKENS_PER_RUN = 10_000_000_000
const MAX_COST_MICROS_PER_RUN = 1_000_000_000_000

const SPECIAL_CHINA_REGIONS = {
  HK: '香港特别行政区',
  MO: '澳门特别行政区',
  TW: '台湾省',
}

const SPECIAL_CHINA_REGION_CODES = Object.fromEntries(
  Object.entries(SPECIAL_CHINA_REGIONS).map(([code, name]) => [name, code]),
)

const CHINA_PROVINCES = {
  AH: '安徽省', BJ: '北京市', CQ: '重庆市', FJ: '福建省', GD: '广东省', GS: '甘肃省',
  GX: '广西壮族自治区', GZ: '贵州省', HA: '河南省', HB: '湖北省', HE: '河北省',
  HI: '海南省', HL: '黑龙江省', HN: '湖南省', JL: '吉林省', JS: '江苏省', JX: '江西省',
  LN: '辽宁省', NM: '内蒙古自治区', NX: '宁夏回族自治区', QH: '青海省', SC: '四川省',
  SD: '山东省', SH: '上海市', SN: '陕西省', SX: '山西省', TJ: '天津市',
  XJ: '新疆维吾尔自治区', XZ: '西藏自治区', YN: '云南省', ZJ: '浙江省',
  ...SPECIAL_CHINA_REGIONS,
}

const CHINA_NUMERIC_PROVINCES = {
  11: '北京市', 12: '天津市', 13: '河北省', 14: '山西省', 15: '内蒙古自治区',
  21: '辽宁省', 22: '吉林省', 23: '黑龙江省', 31: '上海市', 32: '江苏省',
  33: '浙江省', 34: '安徽省', 35: '福建省', 36: '江西省', 37: '山东省',
  41: '河南省', 42: '湖北省', 43: '湖南省', 44: '广东省', 45: '广西壮族自治区',
  46: '海南省', 50: '重庆市', 51: '四川省', 52: '贵州省', 53: '云南省',
  54: '西藏自治区', 61: '陕西省', 62: '甘肃省', 63: '青海省', 64: '宁夏回族自治区',
  65: '新疆维吾尔自治区', 71: '台湾省', 81: '香港特别行政区', 82: '澳门特别行政区',
}

const CHINA_REGION_NAMES = {
  anhui: '安徽省', beijing: '北京市', chongqing: '重庆市', fujian: '福建省',
  gansu: '甘肃省', guangdong: '广东省', guangxi: '广西壮族自治区', guizhou: '贵州省',
  hainan: '海南省', hebei: '河北省', heilongjiang: '黑龙江省', henan: '河南省',
  hubei: '湖北省', hunan: '湖南省', inner_mongolia: '内蒙古自治区', jiangsu: '江苏省',
  jiangxi: '江西省', jilin: '吉林省', liaoning: '辽宁省', ningxia: '宁夏回族自治区',
  qinghai: '青海省', shaanxi: '陕西省', shandong: '山东省', shanghai: '上海市',
  shanxi: '山西省', sichuan: '四川省', tianjin: '天津市', tibet: '西藏自治区',
  xinjiang: '新疆维吾尔自治区', yunnan: '云南省', zhejiang: '浙江省',
  hong_kong: '香港特别行政区', macao: '澳门特别行政区', macau: '澳门特别行政区',
  taiwan: '台湾省',
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url)
    }

    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Token Killer assets binding is not configured.', { status: 503 })
  },
}

async function handleApi(request, env, url) {
  const cors = corsHeaders(request, env)
  if (!cors) return json({ error: 'Origin is not allowed.' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(
        {
          ok: Boolean(env.TOKEN_KILLER_DB && String(env.LEADERBOARD_HMAC_SECRET || '').length >= 32),
          service: 'token-killer-community',
          storage: 'cloudflare-d1',
          verification: 'supplier-usage-client-receipt',
          subscriptionOAuth: subscriptionConfigured(env),
        },
        200,
        cors,
      )
    }

    if (
      url.pathname.startsWith('/api/oauth/') ||
      url.pathname.startsWith('/api/subscription/')
    ) {
      return await handleSubscriptionApi(request, env, url, cors)
    }

    requireConfiguration(env)

    if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
      return await getLeaderboard(request, env, url, cors)
    }
    if (request.method === 'POST' && url.pathname === '/api/leaderboard/profile') {
      return await getLeaderboardProfile(request, env, cors)
    }
    if (request.method === 'POST' && url.pathname === '/api/leaderboard/sessions') {
      return await createSession(request, env, cors)
    }
    if (request.method === 'POST' && url.pathname === '/api/leaderboard/runs') {
      return await submitRun(request, env, cors)
    }

    return json({ error: 'Not found.' }, 404, cors)
  } catch (error) {
    const status = Number(error.status) || 500
    const message = status >= 500 ? 'Community service is temporarily unavailable.' : error.message
    return json({ error: message }, status, cors)
  }
}

async function getLeaderboard(request, env, url, cors) {
  const period = url.searchParams.get('period') === 'all' ? 'all' : 'day'
  const limit = clampInteger(url.searchParams.get('limit'), 1, 100, 25)
  const today = new Date().toISOString().slice(0, 10)
  const geo = normalizedGeo(request)
  const requestedScope = ['country', 'province', 'city'].includes(url.searchParams.get('scope'))
    ? url.searchParams.get('scope')
    : 'global'
  const filter = scopeFilter(requestedScope, geo)
  const clauses = []
  const bindings = []

  if (period === 'day') {
    clauses.push('date_utc = ?')
    bindings.push(today)
  }
  if (filter.clause) {
    clauses.push(filter.clause)
    bindings.push(...filter.bindings)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const statement = env.TOKEN_KILLER_DB.prepare(
    `SELECT
       profile_hash,
       MAX(CASE
         WHEN nickname GLOB '燃烧者 #[0-9][0-9][0-9][0-9][0-9][0-9]' THEN nickname
         ELSE NULL
       END) AS nickname,
       SUM(tokens) AS tokens,
       SUM(cost_micros) AS cost_micros,
       SUM(rounds) AS rounds,
       COUNT(*) AS runs,
       MAX(created_at) AS last_activity
     FROM leaderboard_runs
     ${where}
     GROUP BY profile_hash
     ORDER BY tokens DESC, last_activity ASC
     LIMIT ?`,
  )
  const { results = [] } = await statement.bind(...bindings, limit).all()
  const entries = results.map((entry, index) => ({
    rank: index + 1,
    participantLabel: /^燃烧者 #[1-9]\d{5}$/.test(entry.nickname || '')
      ? entry.nickname
      : participantLabel(entry.profile_hash),
    tokens: Number(entry.tokens || 0),
    cost: Number(entry.cost_micros || 0) / 1_000_000,
    rounds: Number(entry.rounds || 0),
    runs: Number(entry.runs || 0),
    lastActivity: Number(entry.last_activity || 0),
    tier: rankForTokens(Number(entry.tokens || 0)),
    verification: 'supplier-usage-client-receipt',
  }))

  return json({
    period,
    scope: filter.scope,
    date: period === 'day' ? today : null,
    context: publicGeoContext(geo),
    entries,
  }, 200, cors)
}

async function getLeaderboardProfile(request, env, cors) {
  const body = await readJson(request)
  const installationId = requiredText(body.installationId, 'installationId', 16, 128)
  const profileHash = await digestIdentity(env.LEADERBOARD_HMAC_SECRET, `profile:${installationId}`)
  const geo = normalizedGeo(request)
  const context = publicGeoContext(geo)
  const ranks = []

  for (const scope of context.scopes) {
    const result = await profileRankForScope(env, profileHash, scope.id, geo)
    ranks.push({ scope: scope.id, label: scope.label, ...result })
  }

  const globalResult = ranks.find((item) => item.scope === 'global') || { tokens: 0, rank: null }
  return json({
    participantLabel: participantLabel(installationId),
    totalTokens: globalResult.tokens,
    tier: rankForTokens(globalResult.tokens),
    context,
    ranks,
  }, 200, cors)
}

async function createSession(request, env, cors) {
  const body = await readJson(request)
  const installationId = requiredText(body.installationId, 'installationId', 16, 128)
  const nickname = participantLabel(installationId)
  const provider = requiredText(body.provider, 'provider', 1, 48)
  const model = requiredText(body.model, 'model', 1, 160)
  const targetMode = body.targetMode === 'money' ? 'money' : 'tokens'
  const targetValue = finiteNumber(body.targetValue, 'targetValue', 0, Number.MAX_SAFE_INTEGER)
  if (targetValue <= 0) throw httpError(400, 'targetValue must be greater than zero.')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_TTL_SECONDS
  const profileHash = await digestIdentity(env.LEADERBOARD_HMAC_SECRET, `profile:${installationId}`)
  const ip = request.headers.get('cf-connecting-ip') || 'local'
  const ipHash = await digestIdentity(env.LEADERBOARD_HMAC_SECRET, `ip:${ip}`)
  const geo = normalizedGeo(request)

  const rate = await env.TOKEN_KILLER_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM run_sessions
     WHERE (profile_hash = ? OR ip_hash = ?) AND issued_at >= ?`,
  )
    .bind(profileHash, ipHash, now - 3600)
    .first()
  if (Number(rate?.count || 0) >= SESSION_LIMIT_PER_HOUR) {
    throw httpError(429, 'Too many leaderboard sessions. Try again later.')
  }

  const id = crypto.randomUUID()
  const ticketPayload = `${id}.${profileHash}.${expiresAt}`
  const ticket = `${id}.${await sign(env.LEADERBOARD_HMAC_SECRET, ticketPayload)}`

  await env.TOKEN_KILLER_DB.prepare(
    `INSERT INTO run_sessions
      (id, profile_hash, nickname, provider, model, target_mode, target_value, issued_at, expires_at,
       ip_hash, country_code, province_code, province_name, city_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, profileHash, nickname, provider, model, targetMode, targetValue, now, expiresAt,
      ipHash, geo.countryCode, geo.provinceCode, geo.provinceName, geo.cityName,
    )
    .run()

  return json({ sessionId: id, ticket, expiresAt }, 201, cors)
}

async function submitRun(request, env, cors) {
  const body = await readJson(request)
  const sessionId = requiredText(body.sessionId, 'sessionId', 16, 80)
  const ticket = requiredText(body.ticket, 'ticket', 20, 256)
  const tokens = integer(body.tokens, 'tokens', 1, MAX_TOKENS_PER_RUN)
  const costMicros = Math.round(finiteNumber(body.cost, 'cost', 0, MAX_COST_MICROS_PER_RUN / 1_000_000) * 1_000_000)
  const rounds = integer(body.rounds, 'rounds', 1, 10000)
  const verifiedRounds = integer(body.verifiedRounds, 'verifiedRounds', 0, rounds)
  const durationMs = integer(body.duration, 'duration', 250, SESSION_TTL_SECONDS * 1000)
  const status = ['completed', 'guarded', 'exceeded', 'stopped'].includes(body.status) ? body.status : 'completed'
  const now = Math.floor(Date.now() / 1000)

  if (verifiedRounds !== rounds) {
    throw httpError(422, 'Only runs with supplier usage for every round can enter the global leaderboard.')
  }

  const session = await env.TOKEN_KILLER_DB.prepare('SELECT * FROM run_sessions WHERE id = ?').bind(sessionId).first()
  if (!session) throw httpError(404, 'Leaderboard session was not found.')
  if (session.submitted_at) throw httpError(409, 'This leaderboard session was already submitted.')
  if (Number(session.expires_at) < now) throw httpError(410, 'Leaderboard session expired.')
  if (ticket !== `${sessionId}.${ticket.split('.').at(-1)}`) throw httpError(401, 'Invalid leaderboard ticket.')

  const validTicket = await verify(
    env.LEADERBOARD_HMAC_SECRET,
    `${sessionId}.${session.profile_hash}.${session.expires_at}`,
    ticket.split('.').at(-1),
  )
  if (!validTicket) throw httpError(401, 'Invalid leaderboard ticket.')

  const runId = crypto.randomUUID()
  const dateUtc = new Date().toISOString().slice(0, 10)
  await env.TOKEN_KILLER_DB.batch([
    env.TOKEN_KILLER_DB.prepare(
      `INSERT INTO leaderboard_runs
        (id, session_id, profile_hash, nickname, date_utc, tokens, cost_micros, rounds,
         verified_rounds, duration_ms, provider, model, status, verification_level, created_at,
         country_code, province_code, province_name, city_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      runId,
      sessionId,
      session.profile_hash,
      session.nickname,
      dateUtc,
      tokens,
      costMicros,
      rounds,
      verifiedRounds,
      durationMs,
      session.provider,
      session.model,
      status,
      'supplier-usage-client-receipt',
      now,
      session.country_code,
      session.province_code,
      session.province_name,
      session.city_name,
    ),
    env.TOKEN_KILLER_DB.prepare('UPDATE run_sessions SET submitted_at = ? WHERE id = ? AND submitted_at IS NULL').bind(now, sessionId),
  ])

  return json({ ok: true, runId, verification: 'supplier-usage-client-receipt' }, 201, cors)
}

async function profileRankForScope(env, profileHash, requestedScope, geo) {
  const filter = scopeFilter(requestedScope, geo)
  const profileClauses = ['profile_hash = ?']
  const profileBindings = [profileHash]
  if (filter.clause) {
    profileClauses.push(filter.clause)
    profileBindings.push(...filter.bindings)
  }

  const own = await env.TOKEN_KILLER_DB.prepare(
    `SELECT COALESCE(SUM(tokens), 0) AS tokens
     FROM leaderboard_runs
     WHERE ${profileClauses.join(' AND ')}`,
  ).bind(...profileBindings).first()
  const tokens = Number(own?.tokens || 0)
  if (!tokens) return { rank: null, tokens: 0 }

  const where = filter.clause ? `WHERE ${filter.clause}` : ''
  const ahead = await env.TOKEN_KILLER_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT profile_hash
       FROM leaderboard_runs
       ${where}
       GROUP BY profile_hash
       HAVING SUM(tokens) > ?
     )`,
  ).bind(...filter.bindings, tokens).first()

  return { rank: Number(ahead?.count || 0) + 1, tokens }
}

function scopeFilter(requestedScope, geo) {
  if (requestedScope === 'country' && geo.countryCode) {
    return { scope: 'country', clause: 'country_code = ?', bindings: [geo.countryCode] }
  }

  if (requestedScope === 'province' && geo.countryCode === 'CN' && geo.provinceName) {
    if (geo.provinceCode) {
      return {
        scope: 'province',
        clause: 'country_code = ? AND province_code = ?',
        bindings: ['CN', geo.provinceCode],
      }
    }
    return {
      scope: 'province',
      clause: 'country_code = ? AND province_name = ?',
      bindings: ['CN', geo.provinceName],
    }
  }

  if (requestedScope === 'city' && geo.countryCode === 'CN' && geo.cityName) {
    const provinceClause = geo.provinceCode ? 'province_code = ?' : 'province_name = ?'
    const provinceValue = geo.provinceCode || geo.provinceName
    return {
      scope: 'city',
      clause: `country_code = ? AND ${provinceClause} AND city_name = ?`,
      bindings: ['CN', provinceValue, geo.cityName],
    }
  }

  return { scope: 'global', clause: '', bindings: [] }
}

function normalizedGeo(request) {
  const cf = request.cf || {}
  const rawCountry = safeGeoText(cf.country || request.headers.get('cf-ipcountry'), 2).toUpperCase()
  if (!/^[A-Z]{2}$/.test(rawCountry) || ['XX', 'T1'].includes(rawCountry)) {
    return { countryCode: null, provinceCode: null, provinceName: null, cityName: null }
  }

  if (SPECIAL_CHINA_REGIONS[rawCountry]) {
    return {
      countryCode: 'CN',
      provinceCode: rawCountry,
      provinceName: SPECIAL_CHINA_REGIONS[rawCountry],
      cityName: null,
    }
  }

  if (rawCountry !== 'CN') {
    return { countryCode: rawCountry, provinceCode: null, provinceName: null, cityName: null }
  }

  const provinceCode = safeGeoText(cf.regionCode, 12).toUpperCase().replace(/^CN-/, '') || null
  const rawProvinceName = safeGeoText(cf.region, 80)
  const provinceKey = rawProvinceName.toLowerCase().replace(/[\s-]+/g, '_')
  const provinceName = CHINA_PROVINCES[provinceCode]
    || CHINA_NUMERIC_PROVINCES[provinceCode]
    || CHINA_REGION_NAMES[provinceKey]
    || rawProvinceName
    || null
  const specialProvinceCode = SPECIAL_CHINA_REGION_CODES[provinceName]
  if (specialProvinceCode) {
    return {
      countryCode: 'CN',
      provinceCode: specialProvinceCode,
      provinceName,
      cityName: null,
    }
  }

  return {
    countryCode: 'CN',
    provinceCode,
    provinceName,
    cityName: normalizeChinaCity(cf.city),
  }
}

function normalizeChinaCity(value) {
  const city = safeGeoText(value, 80)
  if (!city) return null
  if (/[\u3400-\u9fff]/u.test(city) && !/(市|自治州|地区|盟)$/u.test(city)) return `${city}市`
  return city
}

function publicGeoContext(geo) {
  const scopes = [{ id: 'global', label: '全球' }]
  const countryName = geo.countryCode ? countryDisplayName(geo.countryCode) : null
  if (countryName) scopes.push({ id: 'country', label: countryName })
  if (geo.countryCode === 'CN' && geo.provinceName) {
    scopes.push({ id: 'province', label: geo.provinceName })
  }
  if (geo.countryCode === 'CN' && geo.cityName) {
    scopes.push({ id: 'city', label: geo.cityName })
  }

  return {
    countryCode: geo.countryCode,
    countryName,
    provinceCode: geo.provinceCode,
    provinceName: geo.provinceName,
    cityName: geo.cityName,
    directory: [countryName, geo.provinceName, geo.cityName].filter(Boolean),
    scopes,
  }
}

function countryDisplayName(countryCode) {
  if (countryCode === 'CN') return '中国'
  try {
    return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(countryCode) || countryCode
  } catch {
    return countryCode
  }
}

function safeGeoText(value, maxLength) {
  return String(value || '')
    .replace(/[\p{Cc}<>\\/{}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export { normalizedGeo, publicGeoContext }

function requireConfiguration(env) {
  if (!env.TOKEN_KILLER_DB || String(env.LEADERBOARD_HMAC_SECRET || '').length < 32) {
    throw httpError(503, 'Leaderboard storage is not configured.')
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin')
  if (!origin) return { vary: 'Origin' }
  const requestOrigin = new URL(request.url).origin
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (origin !== requestOrigin && !allowed.includes(origin)) return null
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  })
}

async function readJson(request) {
  const type = request.headers.get('content-type') || ''
  if (!type.includes('application/json')) throw httpError(415, 'Expected application/json.')
  try {
    return await request.json()
  } catch {
    throw httpError(400, 'Invalid JSON body.')
  }
}

function participantLabel(seed) {
  let hash = 2166136261
  for (const character of String(seed || '')) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `燃烧者 #${100000 + ((hash >>> 0) % 900000)}`
}

function requiredText(value, name, min, max) {
  const text = String(value || '').trim()
  if (text.length < min || text.length > max) throw httpError(400, `${name} is invalid.`)
  return text
}

function finiteNumber(value, name, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) throw httpError(400, `${name} is invalid.`)
  return number
}

function integer(value, name, min, max) {
  const number = finiteNumber(value, name, min, max)
  if (!Number.isInteger(number)) throw httpError(400, `${name} must be an integer.`)
  return number
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function sign(secret, value) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(value))
  return base64Url(new Uint8Array(signature))
}

async function verify(secret, value, signature) {
  try {
    return crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature),
      new TextEncoder().encode(value),
    )
  } catch {
    return false
  }
}

async function digestIdentity(secret, value) {
  return sign(secret, value)
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
