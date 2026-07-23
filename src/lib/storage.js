import { getProviderIdentity } from './providerGuard.js'

const SETTINGS_KEY = 'token-killer:settings:v1'
const RUNS_KEY = 'token-killer:runs:v1'
const ONBOARDED_KEY = 'token-killer:onboarded:v1'
const INSTALLATION_KEY = 'token-killer:installation:v1'
const PROVIDER_BLOCKLIST_KEY = 'token-killer:provider-blocklist:v1'
const RUN_CHECKPOINT_KEY = 'token-killer:run-checkpoint:v1'

function sanitizeProviderBlock(record) {
  if (!record || typeof record !== 'object' || !record.key) return null
  return {
    key: String(record.key),
    provider: String(record.provider || 'custom'),
    endpoint: String(record.endpoint || ''),
    reasonCode: String(record.reasonCode || ''),
    status: Number(record.status) || 0,
    blockedAt: Number(record.blockedAt) || Date.now(),
  }
}

export function readProviderBlocklist() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROVIDER_BLOCKLIST_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeProviderBlock).filter(Boolean)
  } catch {
    return []
  }
}

export function isProviderBlocked(settings) {
  const { key } = getProviderIdentity(settings)
  return readProviderBlocklist().find((record) => record.key === key) || null
}

export function blockProvider(settings, errorInfo = {}) {
  const identity = getProviderIdentity(settings)
  const record = {
    key: identity.key,
    provider: identity.provider,
    endpoint: identity.endpoint,
    reasonCode: String(errorInfo.code || errorInfo.reasonCode || ''),
    status: Number(errorInfo.status) || 0,
    blockedAt: Date.now(),
  }
  const remaining = readProviderBlocklist().filter((item) => item.key !== identity.key)
  localStorage.setItem(PROVIDER_BLOCKLIST_KEY, JSON.stringify([record, ...remaining]))
  return record
}

export function unblockProvider(key) {
  const normalizedKey = String(key || '')
  const records = readProviderBlocklist()
  const remaining = records.filter((record) => record.key !== normalizedKey)
  if (remaining.length === records.length) return false
  localStorage.setItem(PROVIDER_BLOCKLIST_KEY, JSON.stringify(remaining))
  return true
}

export function clearProviderBlocklist() {
  localStorage.removeItem(PROVIDER_BLOCKLIST_KEY)
}

export function readSettings(fallback) {
  try {
    const { nickname: _nickname, apiKey: _apiKey, ...saved } = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    const preferMainlandRegion = Object.hasOwn(saved, 'preferMainlandRegion')
      ? Boolean(saved.preferMainlandRegion)
      : Boolean(saved.mainlandGeoApiUrl)
    return { ...fallback, ...saved, preferMainlandRegion, apiKey: '' }
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

export function writeRunCheckpoint(checkpoint) {
  if (!checkpoint?.id || !Number(checkpoint.rounds)) return
  const safe = {
    id: String(checkpoint.id),
    date: String(checkpoint.date || ''),
    startedAt: Number(checkpoint.startedAt) || Date.now(),
    updatedAt: Date.now(),
    provider: String(checkpoint.provider || 'custom'),
    model: String(checkpoint.model || ''),
    promptId: String(checkpoint.promptId || ''),
    tokens: Math.max(0, Number(checkpoint.tokens) || 0),
    input: Math.max(0, Number(checkpoint.input) || 0),
    output: Math.max(0, Number(checkpoint.output) || 0),
    cost: Math.max(0, Number(checkpoint.cost) || 0),
    rounds: Math.max(0, Number(checkpoint.rounds) || 0),
    verifiedRounds: Math.max(0, Number(checkpoint.verifiedRounds) || 0),
    pricing: checkpoint.pricing && typeof checkpoint.pricing === 'object' ? checkpoint.pricing : null,
  }
  localStorage.setItem(RUN_CHECKPOINT_KEY, JSON.stringify(safe))
}

export function readRunCheckpoint() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RUN_CHECKPOINT_KEY) || 'null')
    return parsed?.id && Number(parsed.rounds) > 0 ? parsed : null
  } catch {
    return null
  }
}

export function clearRunCheckpoint() {
  localStorage.removeItem(RUN_CHECKPOINT_KEY)
}

export function recoverInterruptedRun() {
  const runs = readRuns()
  const checkpoint = readRunCheckpoint()
  if (!checkpoint) {
    clearRunCheckpoint()
    return runs
  }
  const recovered = {
    id: checkpoint.id,
    date: checkpoint.date,
    startedAt: checkpoint.startedAt,
    duration: Math.max(0, Number(checkpoint.updatedAt) - Number(checkpoint.startedAt)),
    provider: checkpoint.provider,
    model: checkpoint.model,
    promptId: checkpoint.promptId,
    tokens: checkpoint.tokens,
    input: checkpoint.input,
    output: checkpoint.output,
    cost: checkpoint.cost,
    rounds: checkpoint.rounds,
    verified: checkpoint.rounds === checkpoint.verifiedRounds,
    status: 'interrupted',
    pricing: checkpoint.pricing || undefined,
  }
  const nextRuns = [recovered, ...runs.filter((run) => run.id !== recovered.id)].slice(0, 500)
  writeRuns(nextRuns)
  clearRunCheckpoint()
  return nextRuns
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
  clearRunCheckpoint()
  clearProviderBlocklist()
}
