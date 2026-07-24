import { handleSubscriptionApi, subscriptionStatus } from './subscription.js'
import { rankForTokens } from '../src/lib/ranks.js'
import { API_NAMESPACES, API_ROUTES, isApiPath } from '../src/lib/apiRoutes.js'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

const SESSION_TTL_SECONDS = 24 * 60 * 60
const SESSION_LIMIT_PER_HOUR = 20
const MAX_TOKENS_PER_RUN = 10_000_000_000
const MAX_COST_MICROS_PER_RUN = 1_000_000_000_000
const LEADERBOARD_PAGE_SIZE = 10
const LEADERBOARD_VISIBLE_LIMIT = 100
const LEADERBOARD_MAX_PAGE = LEADERBOARD_VISIBLE_LIMIT / LEADERBOARD_PAGE_SIZE
const PARTICIPANT_NUMBER_MIN = 100000
const PARTICIPANT_NUMBER_MAX = 999999
const PARTICIPANT_NUMBER_CAPACITY = PARTICIPANT_NUMBER_MAX - PARTICIPANT_NUMBER_MIN + 1
const PARTICIPANT_ALLOCATION_ATTEMPTS = 64
const PARTICIPANT_ALLOCATION_STEP = 7919
const GEO_ASSERTION_TTL_SECONDS = 10 * 60
const GEO_ASSERTION_MAX_CLOCK_SKEW_SECONDS = 60

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

const CHINA_PROVINCES_EN = {
  AH: 'Anhui', BJ: 'Beijing', CQ: 'Chongqing', FJ: 'Fujian', GD: 'Guangdong', GS: 'Gansu',
  GX: 'Guangxi', GZ: 'Guizhou', HA: 'Henan', HB: 'Hubei', HE: 'Hebei', HI: 'Hainan',
  HL: 'Heilongjiang', HN: 'Hunan', JL: 'Jilin', JS: 'Jiangsu', JX: 'Jiangxi', LN: 'Liaoning',
  NM: 'Inner Mongolia', NX: 'Ningxia', QH: 'Qinghai', SC: 'Sichuan', SD: 'Shandong',
  SH: 'Shanghai', SN: 'Shaanxi', SX: 'Shanxi', TJ: 'Tianjin', XJ: 'Xinjiang',
  XZ: 'Tibet', YN: 'Yunnan', ZJ: 'Zhejiang', HK: 'Hong Kong SAR', MO: 'Macao SAR', TW: 'Taiwan Province',
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

    if (isApiPath(url.pathname)) {
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
    if (request.method === 'GET' && url.pathname === API_ROUTES.health) {
      return json(
        {
          ok: Boolean(env.TOKEN_KILLER_DB && String(env.LEADERBOARD_HMAC_SECRET || '').length >= 32),
          service: 'token-killer-community',
          storage: env.STORAGE_KIND || 'cloudflare-d1',
          verification: 'supplier-usage-client-receipt',
          geoAssertion: geoAssertionSecret(env).length >= 32,
          mainlandGeoAssertion: geoAssertionSecret(env).length >= 32,
          geoIpDatabase: String(env.GEOIP_DATABASE_AVAILABLE || '').toLowerCase() === 'true',
          subscriptionOAuth: subscriptionStatus(env),
        },
        200,
        cors,
      )
    }

    if (request.method === 'POST' && url.pathname === API_ROUTES.geoAssertion) {
      return await createGeoAssertion(request, env, cors)
    }

    if (
      url.pathname.startsWith(API_NAMESPACES.oauth) ||
      url.pathname.startsWith(API_NAMESPACES.subscription)
    ) {
      return await handleSubscriptionApi(request, env, url, cors)
    }

    requireConfiguration(env)

    if (['GET', 'POST'].includes(request.method) && url.pathname === API_ROUTES.leaderboard) {
      return await getLeaderboard(request, env, url, cors)
    }
    if (request.method === 'POST' && url.pathname === API_ROUTES.leaderboardProfile) {
      return await getLeaderboardProfile(request, env, cors)
    }
    if (request.method === 'POST' && url.pathname === API_ROUTES.leaderboardSessions) {
      return await createSession(request, env, cors)
    }
    if (request.method === 'POST' && url.pathname === API_ROUTES.leaderboardRuns) {
      return await submitRun(request, env, cors)
    }

    return json({ error: 'Not found.' }, 404, cors)
  } catch (error) {
    const status = Number(error.status) || 500
    if (error.providerBlock) {
      return json({
        error: {
          code: String(error.code || ''),
          type: 'provider_blocked',
          message: String(error.message || 'Provider rejected this request.'),
        },
      }, status, cors)
    }
    const message = status >= 500 ? 'Community service is temporarily unavailable.' : error.message
    return json({ error: message }, status, cors)
  }
}

function geoAssertionSecret(env) {
  return String(env.GEO_ASSERTION_HMAC_SECRET || env.LEADERBOARD_HMAC_SECRET || '')
}

function trustedCountryCode(request, env) {
  const cfCountry = safeGeoText(request.cf?.country, 2).toUpperCase()
  if (/^[A-Z]{2}$/.test(cfCountry)) return cfCountry
  if (String(env.TRUST_GEO_HEADERS || '').toLowerCase() !== 'true') return ''
  return safeGeoText(
    request.headers.get('x-geo-country') || request.headers.get('cf-ipcountry'),
    2,
  ).toUpperCase()
}

async function createGeoAssertion(request, env, cors) {
  const secret = geoAssertionSecret(env)
  if (secret.length < 32) throw httpError(503, 'Geo assertions are not configured.')
  const body = await readJson(request)
  const nonce = requiredText(body.nonce, 'nonce', 16, 128)
  const trustedCountry = trustedCountryCode(request, env)
  if (!trustedCountry) return json({ located: false, mainland: false, context: null }, 200, cors)
  const geo = normalizedGeo(request, env)
  if (!geo.countryCode) return json({ located: false, mainland: false, context: null }, 200, cors)
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + GEO_ASSERTION_TTL_SECONDS
  const payload = {
    version: 1,
    issuedAt,
    expiresAt,
    nonce,
    countryCode: geo.countryCode,
    provinceCode: geo.provinceCode,
    provinceName: geo.provinceName,
    cityName: geo.cityName,
  }
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const assertion = `${encoded}.${await sign(secret, encoded)}`
  return json({
    located: true,
    mainland: trustedCountry === 'CN' && geo.countryCode === 'CN',
    assertion,
    expiresAt,
    context: publicGeoContext({ ...geo, source: 'geo-service' }, body.locale),
  }, 200, cors)
}

async function preferredGeo(request, env, assertion, manualRegion = null) {
  const fallback = { ...normalizedGeo(request, env), source: 'edge' }
  const manual = normalizedManualGeo(manualRegion)
  if (manual) return manual
  const token = String(assertion || '')
  if (!token || token.length > 2048) return fallback
  const secret = geoAssertionSecret(env)
  if (secret.length < 32) return fallback
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return fallback
  if (!await verify(secret, encoded, signature)) return fallback

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)))
  } catch {
    return fallback
  }
  const now = Math.floor(Date.now() / 1000)
  if (
    payload.version !== 1 ||
    !/^[A-Z]{2}$/.test(payload.countryCode) ||
    ['XX', 'T1'].includes(payload.countryCode) ||
    !Number.isInteger(payload.issuedAt) ||
    !Number.isInteger(payload.expiresAt) ||
    payload.issuedAt > now + GEO_ASSERTION_MAX_CLOCK_SKEW_SECONDS ||
    payload.expiresAt <= now ||
    payload.expiresAt > payload.issuedAt + GEO_ASSERTION_TTL_SECONDS ||
    typeof payload.nonce !== 'string' ||
    payload.nonce.length < 16 ||
    payload.nonce.length > 128
  ) return fallback

  if (payload.countryCode !== 'CN') {
    const provinceCode = safeGeoText(payload.provinceCode, 12).toUpperCase() || null
    const provinceName = safeGeoText(payload.provinceName, 80) || null
    return {
      countryCode: payload.countryCode,
      provinceCode,
      provinceName,
      cityName: safeGeoText(payload.cityName, 80) || null,
      source: 'geo-service',
    }
  }
  const provinceCode = safeGeoText(payload.provinceCode, 12).toUpperCase() || null
  const provinceName = safeGeoText(payload.provinceName, 80) || null
  const specialProvinceCode = SPECIAL_CHINA_REGION_CODES[provinceName]
  const normalizedProvinceCode = specialProvinceCode || provinceCode
  return {
    countryCode: 'CN',
    provinceCode: normalizedProvinceCode,
    provinceName,
    cityName: ['HK', 'MO'].includes(normalizedProvinceCode)
      ? null
      : normalizeChinaCity(payload.cityName),
    source: 'geo-service',
  }
}

async function getLeaderboard(request, env, url, cors) {
  const input = request.method === 'POST' ? await readJson(request) : Object.fromEntries(url.searchParams)
  const period = input.period === 'all' ? 'all' : 'day'
  const page = integer(input.page ?? 1, 'page', 1, LEADERBOARD_MAX_PAGE)
  const installationId = input.installationId
    ? requiredText(input.installationId, 'installationId', 16, 128)
    : ''
  const today = new Date().toISOString().slice(0, 10)
  const geo = await preferredGeo(request, env, input.geoAssertion, input.manualRegion)
  const requestedScope = ['country', 'province', 'city'].includes(input.scope)
    ? input.scope
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
  const rankedQuery = `WITH ranked AS (
     SELECT
       profile_hash,
       SUM(tokens) AS tokens,
       SUM(cost_micros) AS cost_micros,
       SUM(rounds) AS rounds,
       COUNT(*) AS runs,
       MAX(created_at) AS last_activity,
       ROW_NUMBER() OVER (
         ORDER BY SUM(tokens) DESC, MAX(created_at) ASC, profile_hash ASC
       ) AS rank
     FROM leaderboard_runs
     ${where}
     GROUP BY profile_hash
   ), labeled AS (
     SELECT ranked.*, leaderboard_profiles.participant_number
     FROM ranked
     LEFT JOIN leaderboard_profiles USING (profile_hash)
   )`
  const startRank = ((page - 1) * LEADERBOARD_PAGE_SIZE) + 1
  const endRank = Math.min(page * LEADERBOARD_PAGE_SIZE, LEADERBOARD_VISIBLE_LIMIT)
  const profileHash = installationId
    ? await digestIdentity(env.LEADERBOARD_HMAC_SECRET, `profile:${installationId}`)
    : ''
  const requesterProfile = profileHash
    ? await getOrCreateLeaderboardProfile(env, profileHash)
    : null
  const [pageResult, countResult, currentResult] = await env.TOKEN_KILLER_DB.batch([
    env.TOKEN_KILLER_DB.prepare(
      `${rankedQuery}
       SELECT * FROM labeled
       WHERE rank BETWEEN ? AND ?
       ORDER BY rank ASC`,
    ).bind(...bindings, startRank, endRank),
    env.TOKEN_KILLER_DB.prepare(
      `${rankedQuery}
       SELECT COUNT(*) AS count FROM labeled
       WHERE rank <= ?`,
    ).bind(...bindings, LEADERBOARD_VISIBLE_LIMIT),
    env.TOKEN_KILLER_DB.prepare(
      `${rankedQuery}
       SELECT * FROM labeled
       WHERE profile_hash = ?
       LIMIT 1`,
    ).bind(...bindings, profileHash),
  ])
  const rows = pageResult.results || []
  const visibleTotal = Math.min(
    LEADERBOARD_VISIBLE_LIMIT,
    Number(countResult.results?.[0]?.count || 0),
  )
  const pageCount = Math.max(1, Math.ceil(visibleTotal / LEADERBOARD_PAGE_SIZE))
  const currentRow = currentResult.results?.[0] || null
  await fillMissingParticipantNumbers(env, [...rows, currentRow].filter(Boolean))
  const entries = rows.map((entry) => leaderboardEntry(entry, entry.profile_hash === profileHash))
  const currentEntry = currentRow ? leaderboardEntry(currentRow, true) : null

  return json({
    period,
    scope: filter.scope,
    date: period === 'day' ? today : null,
    context: publicGeoContext(geo, input.locale),
    page,
    pageSize: LEADERBOARD_PAGE_SIZE,
    pageCount,
    visibleTotal,
    visibleLimit: LEADERBOARD_VISIBLE_LIMIT,
    participantLabel: requesterProfile?.participantLabel || null,
    entries,
    currentEntry,
  }, 200, cors)
}

function leaderboardEntry(entry, isCurrent = false) {
  const tokens = Number(entry.tokens || 0)
  return {
    rank: Number(entry.rank || 0),
    participantLabel: formatParticipantLabel(entry.participant_number),
    tokens,
    cost: Number(entry.cost_micros || 0) / 1_000_000,
    rounds: Number(entry.rounds || 0),
    runs: Number(entry.runs || 0),
    lastActivity: Number(entry.last_activity || 0),
    tier: rankForTokens(tokens),
    verification: 'supplier-usage-client-receipt',
    isCurrent,
  }
}

async function getLeaderboardProfile(request, env, cors) {
  const body = await readJson(request)
  const installationId = requiredText(body.installationId, 'installationId', 16, 128)
  const profileHash = await digestIdentity(env.LEADERBOARD_HMAC_SECRET, `profile:${installationId}`)
  const profile = await getOrCreateLeaderboardProfile(env, profileHash)
  const geo = await preferredGeo(request, env, body.geoAssertion, body.manualRegion)
  const context = publicGeoContext(geo, body.locale)
  const ranks = []

  for (const scope of context.scopes) {
    const result = await profileRankForScope(env, profileHash, scope.id, geo)
    ranks.push({ scope: scope.id, label: scope.label, ...result })
  }

  const globalResult = ranks.find((item) => item.scope === 'global') || { tokens: 0, rank: null }
  return json({
    participantLabel: profile.participantLabel,
    totalTokens: globalResult.tokens,
    tier: rankForTokens(globalResult.tokens),
    context,
    ranks,
  }, 200, cors)
}

async function createSession(request, env, cors) {
  const body = await readJson(request)
  const installationId = requiredText(body.installationId, 'installationId', 16, 128)
  const provider = requiredText(body.provider, 'provider', 1, 48)
  const model = requiredText(body.model, 'model', 1, 160)
  const targetMode = body.targetMode === 'money' ? 'money' : 'tokens'
  const targetValue = finiteNumber(body.targetValue, 'targetValue', 0, Number.MAX_SAFE_INTEGER)
  if (targetValue <= 0) throw httpError(400, 'targetValue must be greater than zero.')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_TTL_SECONDS
  const profileHash = await digestIdentity(env.LEADERBOARD_HMAC_SECRET, `profile:${installationId}`)
  const profile = await getOrCreateLeaderboardProfile(env, profileHash)
  const nickname = profile.participantLabel
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'local'
  const ipHash = await digestIdentity(env.LEADERBOARD_HMAC_SECRET, `ip:${ip}`)
  const geo = await preferredGeo(request, env, body.geoAssertion, body.manualRegion)

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

  return json({ sessionId: id, ticket, expiresAt, participantLabel: profile.participantLabel }, 201, cors)
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
  const where = filter.clause ? `WHERE ${filter.clause}` : ''
  const result = await env.TOKEN_KILLER_DB.prepare(
    `WITH ranked AS (
       SELECT
         profile_hash,
         SUM(tokens) AS tokens,
         ROW_NUMBER() OVER (
           ORDER BY SUM(tokens) DESC, MAX(created_at) ASC, profile_hash ASC
         ) AS rank
       FROM leaderboard_runs
       ${where}
       GROUP BY profile_hash
     )
     SELECT rank, tokens FROM ranked
     WHERE profile_hash = ?
     LIMIT 1`,
  ).bind(...filter.bindings, profileHash).first()

  if (!result) return { rank: null, tokens: 0 }
  return { rank: Number(result.rank), tokens: Number(result.tokens || 0) }
}

function scopeFilter(requestedScope, geo) {
  if (requestedScope === 'country' && geo.countryCode) {
    return { scope: 'country', clause: 'country_code = ?', bindings: [geo.countryCode] }
  }

  if (requestedScope === 'province' && geo.countryCode && geo.provinceName) {
    if (geo.provinceCode) {
      return {
        scope: 'province',
        clause: 'country_code = ? AND province_code = ?',
        bindings: [geo.countryCode, geo.provinceCode],
      }
    }
    return {
      scope: 'province',
      clause: 'country_code = ? AND province_name = ?',
      bindings: [geo.countryCode, geo.provinceName],
    }
  }

  if (requestedScope === 'city' && geo.countryCode && geo.cityName) {
    const provinceClause = geo.provinceCode
      ? ' AND province_code = ?'
      : geo.provinceName
        ? ' AND province_name = ?'
        : ''
    const provinceBindings = geo.provinceCode
      ? [geo.provinceCode]
      : geo.provinceName
        ? [geo.provinceName]
        : []
    return {
      scope: 'city',
      clause: `country_code = ?${provinceClause} AND city_name = ?`,
      bindings: [geo.countryCode, ...provinceBindings, geo.cityName],
    }
  }

  return { scope: 'global', clause: '', bindings: [] }
}

function normalizedManualGeo(value) {
  if (!value || typeof value !== 'object') return null
  const rawCountry = safeGeoText(value.countryCode, 2).toUpperCase()
  if (!/^[A-Z]{2}$/.test(rawCountry) || ['XX', 'T1'].includes(rawCountry)) return null
  if (SPECIAL_CHINA_REGIONS[rawCountry]) {
    return {
      countryCode: 'CN',
      provinceCode: rawCountry,
      provinceName: SPECIAL_CHINA_REGIONS[rawCountry],
      cityName: null,
      source: 'manual',
    }
  }

  const rawRegionCode = safeGeoText(value.regionCode, 12)
    .toUpperCase()
    .replace(new RegExp(`^${rawCountry}-`), '') || null
  const rawRegionName = safeGeoText(value.regionName, 80) || null
  if (rawCountry !== 'CN') {
    return {
      countryCode: rawCountry,
      provinceCode: rawRegionCode,
      provinceName: rawRegionName,
      cityName: safeGeoText(value.cityName, 80) || null,
      source: 'manual',
    }
  }

  const provinceKey = String(rawRegionName || '').toLowerCase().replace(/[\s-]+/g, '_')
  const provinceName = CHINA_PROVINCES[rawRegionCode]
    || CHINA_NUMERIC_PROVINCES[rawRegionCode]
    || CHINA_REGION_NAMES[provinceKey]
    || rawRegionName
    || null
  const specialProvinceCode = SPECIAL_CHINA_REGION_CODES[provinceName]
  const provinceCode = specialProvinceCode || rawRegionCode
  return {
    countryCode: 'CN',
    provinceCode,
    provinceName,
    cityName: ['HK', 'MO'].includes(provinceCode)
      ? null
      : normalizeChinaCity(value.cityName),
    source: 'manual',
  }
}

function normalizedGeo(request, env = {}) {
  const cf = request.cf || {}
  const trustGeoHeaders = String(env.TRUST_GEO_HEADERS || '').toLowerCase() === 'true'
  const trustedHeader = (name) => trustGeoHeaders ? request.headers.get(name) : ''
  const rawCountry = safeGeoText(
    cf.country || trustedHeader('x-geo-country') || trustedHeader('cf-ipcountry'),
    2,
  ).toUpperCase()
  if (!/^[A-Z]{2}$/.test(rawCountry) || ['XX', 'T1'].includes(rawCountry)) {
    return { countryCode: null, provinceCode: null, provinceName: null, cityName: null }
  }

  if (SPECIAL_CHINA_REGIONS[rawCountry]) {
    return {
      countryCode: 'CN',
      provinceCode: rawCountry,
      provinceName: SPECIAL_CHINA_REGIONS[rawCountry],
      cityName: ['HK', 'MO'].includes(rawCountry)
        ? null
        : normalizeChinaCity(cf.city || trustedHeader('x-geo-city')),
    }
  }

  if (rawCountry !== 'CN') {
    return {
      countryCode: rawCountry,
      provinceCode: safeGeoText(cf.regionCode || trustedHeader('x-geo-region-code'), 12)
        .toUpperCase()
        .replace(new RegExp(`^${rawCountry}-`), '') || null,
      provinceName: safeGeoText(cf.region || trustedHeader('x-geo-region'), 80) || null,
      cityName: safeGeoText(cf.city || trustedHeader('x-geo-city'), 80) || null,
    }
  }

  const provinceCode = safeGeoText(cf.regionCode || trustedHeader('x-geo-region-code'), 12)
    .toUpperCase()
    .replace(/^CN-/, '') || null
  const rawProvinceName = safeGeoText(cf.region || trustedHeader('x-geo-region'), 80)
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
    cityName: normalizeChinaCity(cf.city || trustedHeader('x-geo-city')),
  }
}

function normalizeChinaCity(value) {
  const city = safeGeoText(value, 80)
  if (!city) return null
  if (/[\u3400-\u9fff]/u.test(city) && !/(市|自治州|地区|盟)$/u.test(city)) return `${city}市`
  return city
}

function publicGeoContext(geo, locale = 'zh-CN') {
  const language = locale === 'en' ? 'en' : 'zh-CN'
  const scopes = [{ id: 'global', label: language === 'en' ? 'Global' : '全球' }]
  const countryName = geo.countryCode ? countryDisplayName(geo.countryCode, language) : null
  const provinceName = language === 'en'
    ? CHINA_PROVINCES_EN[geo.provinceCode] || geo.provinceName
    : geo.provinceName
  if (countryName) scopes.push({ id: 'country', label: countryName })
  if (provinceName) {
    scopes.push({ id: 'province', label: provinceName })
  }
  if (geo.cityName) {
    scopes.push({ id: 'city', label: geo.cityName })
  }

  return {
    source: geo.source || 'edge',
    countryCode: geo.countryCode,
    countryName,
    provinceCode: geo.provinceCode,
    provinceName,
    cityName: geo.cityName,
    directory: [countryName, provinceName, geo.cityName].filter(Boolean),
    scopes,
  }
}

function countryDisplayName(countryCode, locale = 'zh-CN') {
  if (countryCode === 'CN') return locale === 'en' ? 'China' : '中国'
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(countryCode) || countryCode
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

export { normalizedGeo, preferredGeo, publicGeoContext }

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

function participantNumberSeed(seed) {
  let hash = 2166136261
  for (const character of String(seed || '')) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function participantNumberCandidate(profileHash, attempt) {
  return PARTICIPANT_NUMBER_MIN + (
    (participantNumberSeed(profileHash) + (attempt * PARTICIPANT_ALLOCATION_STEP))
    % PARTICIPANT_NUMBER_CAPACITY
  )
}

function formatParticipantLabel(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < PARTICIPANT_NUMBER_MIN || number > PARTICIPANT_NUMBER_MAX) {
    throw httpError(500, 'Leaderboard participant number is invalid.')
  }
  return `燃烧者 #${number}`
}

async function readLeaderboardProfile(env, profileHash) {
  return env.TOKEN_KILLER_DB.prepare(
    `SELECT participant_number
     FROM leaderboard_profiles
     WHERE profile_hash = ?
     LIMIT 1`,
  ).bind(profileHash).first()
}

async function getOrCreateLeaderboardProfile(env, profileHash) {
  const existing = await readLeaderboardProfile(env, profileHash)
  if (existing) {
    return {
      profileHash,
      participantNumber: Number(existing.participant_number),
      participantLabel: formatParticipantLabel(existing.participant_number),
    }
  }

  const createdAt = Math.floor(Date.now() / 1000)
  for (let attempt = 0; attempt < PARTICIPANT_ALLOCATION_ATTEMPTS; attempt += 1) {
    const participantNumber = participantNumberCandidate(profileHash, attempt)
    await env.TOKEN_KILLER_DB.prepare(
      `INSERT OR IGNORE INTO leaderboard_profiles
        (profile_hash, participant_number, created_at)
       VALUES (?, ?, ?)`,
    ).bind(profileHash, participantNumber, createdAt).run()

    const assigned = await readLeaderboardProfile(env, profileHash)
    if (assigned) {
      return {
        profileHash,
        participantNumber: Number(assigned.participant_number),
        participantLabel: formatParticipantLabel(assigned.participant_number),
      }
    }
  }

  throw httpError(503, 'Leaderboard participant number could not be allocated.')
}

async function fillMissingParticipantNumbers(env, entries) {
  const missing = [...new Set(
    entries
      .filter((entry) => !entry.participant_number && entry.profile_hash)
      .map((entry) => entry.profile_hash),
  )]
  if (!missing.length) return

  const assigned = new Map()
  for (const profileHash of missing) {
    const profile = await getOrCreateLeaderboardProfile(env, profileHash)
    assigned.set(profileHash, profile.participantNumber)
  }
  for (const entry of entries) {
    if (!entry.participant_number && assigned.has(entry.profile_hash)) {
      entry.participant_number = assigned.get(entry.profile_hash)
    }
  }
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
