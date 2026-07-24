export const API_PREFIX = '/api'

export const API_NAMESPACES = Object.freeze({
  oauth: `${API_PREFIX}/oauth/`,
  subscription: `${API_PREFIX}/subscription/`,
  leaderboard: `${API_PREFIX}/leaderboard`,
})

export const API_ROUTES = Object.freeze({
  health: `${API_PREFIX}/health`,
  geoAssertion: `${API_PREFIX}/geo/assertion`,
  leaderboard: `${API_PREFIX}/leaderboard`,
  leaderboardProfile: `${API_PREFIX}/leaderboard/profile`,
  leaderboardSessions: `${API_PREFIX}/leaderboard/sessions`,
  leaderboardRuns: `${API_PREFIX}/leaderboard/runs`,
  oauth: Object.freeze({
    openaiDeviceStart: `${API_PREFIX}/oauth/openai/device/start`,
    openaiDevicePoll: `${API_PREFIX}/oauth/openai/device/poll`,
    openaiRefresh: `${API_PREFIX}/oauth/openai/refresh`,
    claudeExchange: `${API_PREFIX}/oauth/claude/exchange`,
    claudeRefresh: `${API_PREFIX}/oauth/claude/refresh`,
    geminiConfig: `${API_PREFIX}/oauth/gemini/config`,
    geminiExchange: `${API_PREFIX}/oauth/gemini/exchange`,
    geminiRefresh: `${API_PREFIX}/oauth/gemini/refresh`,
    grokExchange: `${API_PREFIX}/oauth/grok/exchange`,
    grokRefresh: `${API_PREFIX}/oauth/grok/refresh`,
  }),
  subscription: Object.freeze({
    openaiResponses: `${API_PREFIX}/subscription/openai/responses`,
    claudeMessages: `${API_PREFIX}/subscription/claude/messages`,
    geminiGenerate: `${API_PREFIX}/subscription/gemini/generate`,
    grokResponses: `${API_PREFIX}/subscription/grok/responses`,
  }),
})

export function isApiPath(pathname) {
  const value = String(pathname || '')
  return value === API_PREFIX || value.startsWith(`${API_PREFIX}/`)
}

export function apiServiceUrl(base, route) {
  const service = String(base || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  if (!service) return route
  const normalizedBase = service.endsWith(API_PREFIX)
    ? service.slice(0, -API_PREFIX.length)
    : service
  return `${normalizedBase}${route}`
}
