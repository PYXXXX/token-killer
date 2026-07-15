const SETTINGS_KEY = 'token-killer:settings:v1'
const RUNS_KEY = 'token-killer:runs:v1'
const ONBOARDED_KEY = 'token-killer:onboarded:v1'
const INSTALLATION_KEY = 'token-killer:installation:v1'

export function readSettings(fallback) {
  try {
    const { nickname: _nickname, apiKey: _apiKey, ...saved } = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return { ...fallback, ...saved, apiKey: '' }
  } catch {
    return fallback
  }
}

export function writeSettings(settings) {
  const { apiKey: _apiKey, nickname: _nickname, ...safe } = settings
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe))
}

export function readRuns() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RUNS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeRuns(runs) {
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, 500)))
}

export function hasOnboarded() {
  return localStorage.getItem(ONBOARDED_KEY) === 'yes'
}

export function markOnboarded() {
  localStorage.setItem(ONBOARDED_KEY, 'yes')
}

export function getInstallationId() {
  let id = localStorage.getItem(INSTALLATION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(INSTALLATION_KEY, id)
  }
  return id
}

export function participantNumberFromId(id) {
  let hash = 2166136261
  for (const character of String(id || '')) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return 100000 + ((hash >>> 0) % 900000)
}

export function getParticipantLabel() {
  return `燃烧者 #${participantNumberFromId(getInstallationId())}`
}

export function exportLocalData(settings, runs) {
  const { apiKey: _apiKey, nickname: _nickname, ...safeSettings } = settings
  const blob = new Blob(
    [JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), settings: safeSettings, runs }, null, 2)],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `token-killer-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function clearLocalData() {
  localStorage.removeItem(SETTINGS_KEY)
  localStorage.removeItem(RUNS_KEY)
  localStorage.removeItem(ONBOARDED_KEY)
  localStorage.removeItem(INSTALLATION_KEY)
}
