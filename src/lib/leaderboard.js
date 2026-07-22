import { getInstallationId } from './storage.js'
import { resolveMainlandGeoAssertion } from './geo.js'

const REQUEST_TIMEOUT = 5000
const PARTICIPANT_LABEL_PATTERN = /^燃烧者 #[1-9]\d{5}$/

export function normalizeLeaderboardParticipantLabel(value) {
  const label = String(value || '').trim()
  return PARTICIPANT_LABEL_PATTERN.test(label) ? label : ''
}

function apiUrl(base, path) {
  const value = String(base || '').trim()
  if (!value) return path
  let parsed
  try {
    parsed = new URL(value, window.location.origin)
  } catch {
    throw new Error('排行榜服务地址无效')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('排行榜服务地址仅支持 HTTP 或 HTTPS')
  return `${parsed.href.replace(/\/$/, '')}${path}`
}

async function request(base, path, options = {}) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetch(apiUrl(base, path), {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new Error('排行榜服务返回了无法识别的响应')
    }
    if (!response.ok) throw new Error(payload.error || `排行榜服务返回 ${response.status}`)
    return payload
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function getLeaderboard(base, period = 'day', scope = 'global', page = 1, locale = 'zh-CN', mainlandGeoApiUrl = '') {
  const safeScope = ['country', 'province', 'city'].includes(scope) ? scope : 'global'
  const geoAssertion = await resolveMainlandGeoAssertion(mainlandGeoApiUrl)
  return request(base, '/api/leaderboard', {
    method: 'POST',
    body: JSON.stringify({
      installationId: getInstallationId(),
      period: period === 'all' ? 'all' : 'day',
      scope: safeScope,
      page: Math.min(10, Math.max(1, Number.parseInt(page, 10) || 1)),
      locale,
      geoAssertion: geoAssertion || undefined,
    }),
  })
}

export async function getLeaderboardProfile(base, locale = 'zh-CN', mainlandGeoApiUrl = '') {
  const geoAssertion = await resolveMainlandGeoAssertion(mainlandGeoApiUrl)
  return request(base, '/api/leaderboard/profile', {
    method: 'POST',
    body: JSON.stringify({ installationId: getInstallationId(), locale, geoAssertion: geoAssertion || undefined }),
  })
}

export async function createLeaderboardSession(base, settings) {
  if (!settings.publishToLeaderboard) return null
  const geoAssertion = await resolveMainlandGeoAssertion(settings.mainlandGeoApiUrl)
  return request(base, '/api/leaderboard/sessions', {
    method: 'POST',
    body: JSON.stringify({
      installationId: getInstallationId(),
      provider: settings.provider,
      model: settings.model,
      targetMode: settings.targetMode,
      targetValue: settings.targetMode === 'money' ? Number(settings.targetAmount) : Number(settings.targetTokens),
      geoAssertion: geoAssertion || undefined,
    }),
  })
}

export async function submitLeaderboardRun(base, leaderboardSession, run) {
  if (!leaderboardSession || !run.verified || !['completed', 'guarded', 'exceeded'].includes(run.status)) return null
  return request(base, '/api/leaderboard/runs', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: leaderboardSession.sessionId,
      ticket: leaderboardSession.ticket,
      tokens: run.tokens,
      cost: run.cost,
      rounds: run.rounds,
      verifiedRounds: run.rounds,
      duration: run.duration,
      status: run.status,
    }),
  })
}
