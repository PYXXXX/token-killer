import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.js'
import { normalizeLeaderboardParticipantLabel } from '../src/lib/leaderboard.js'
import { getParticipantLabel, readSettings } from '../src/lib/storage.js'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

class IdentityDatabase {
  constructor() {
    this.byHash = new Map()
    this.byNumber = new Map()
  }

  prepare(sql) {
    const database = this
    return {
      values: [],
      bind(...values) {
        this.values = values
        return this
      },
      async first() {
        if (sql.includes('FROM leaderboard_profiles')) {
          const participantNumber = database.byHash.get(this.values[0])
          return participantNumber ? { participant_number: participantNumber } : null
        }
        if (sql.includes('FROM leaderboard_runs')) return null
        throw new Error(`Unexpected first query: ${sql}`)
      },
      async run() {
        if (!sql.includes('INSERT OR IGNORE INTO leaderboard_profiles')) {
          throw new Error(`Unexpected run query: ${sql}`)
        }
        const [profileHash, participantNumber] = this.values
        if (!database.byHash.has(profileHash) && !database.byNumber.has(participantNumber)) {
          database.byHash.set(profileHash, participantNumber)
          database.byNumber.set(participantNumber, profileHash)
        }
        return { success: true }
      },
    }
  }
}

async function requestProfile(database, installationId, nickname = undefined) {
  const response = await worker.fetch(new Request('https://worker.example/api/leaderboard/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installationId, nickname }),
  }), {
    TOKEN_KILLER_DB: database,
    LEADERBOARD_HMAC_SECRET: 'leaderboard-test-secret-at-least-32-characters',
  })
  assert.equal(response.status, 200)
  return response.json()
}

test.beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
})

test('local identity is generated without a leaderboard and remains stable in one browser', () => {
  const first = getParticipantLabel()
  const second = getParticipantLabel()
  assert.match(first, /^燃烧者 #[1-9]\d{5}$/)
  assert.equal(second, first)
})

test('leaderboard validates server-issued labels and rejects arbitrary names', () => {
  assert.equal(normalizeLeaderboardParticipantLabel('燃烧者 #145473'), '燃烧者 #145473')
  assert.equal(normalizeLeaderboardParticipantLabel('Alice'), '')
  assert.equal(normalizeLeaderboardParticipantLabel('燃烧者 #000001'), '')
  assert.equal(normalizeLeaderboardParticipantLabel('<script>alert(1)</script>'), '')
})

test('legacy mainland probe settings migrate to the generic geo service', () => {
  localStorage.setItem('token-killer:settings:v1', JSON.stringify({
    preferMainlandRegion: true,
    mainlandGeoApiUrl: 'https://geo.example.cn',
  }))
  const settings = readSettings({ autoSelectRegion: true, geoApiUrl: '/geo', manualRegion: {} })
  assert.equal(settings.autoSelectRegion, true)
  assert.equal(settings.geoApiUrl, 'https://geo.example.cn')
  assert.equal('preferMainlandRegion' in settings, false)
  assert.equal('mainlandGeoApiUrl' in settings, false)
})

test('fresh settings preserve a build-configured geo service default', () => {
  const settings = readSettings({ autoSelectRegion: true, geoApiUrl: 'https://geo.example.com', manualRegion: {} })
  assert.equal(settings.autoSelectRegion, true)
  assert.equal(settings.geoApiUrl, 'https://geo.example.com')
})

test('saved root geo endpoints migrate into the /api namespace', () => {
  localStorage.setItem('token-killer:settings:v1', JSON.stringify({
    geoApiUrl: 'https://geo.example.com/geo',
  }))
  const settings = readSettings({ autoSelectRegion: true, geoApiUrl: '/api/geo/assertion', manualRegion: {} })
  assert.equal(settings.geoApiUrl, 'https://geo.example.com/api/geo/assertion')
})

test('leaderboard issues stable unique numbers and ignores a submitted nickname', async () => {
  const database = new IdentityDatabase()
  const first = await requestProfile(database, 'installation-0000000000001', '自定义昵称')
  const repeated = await requestProfile(database, 'installation-0000000000001', '另一个昵称')
  const second = await requestProfile(database, 'installation-0000000000002', '自定义昵称')

  assert.match(first.participantLabel, /^燃烧者 #[1-9]\d{5}$/)
  assert.equal(repeated.participantLabel, first.participantLabel)
  assert.notEqual(second.participantLabel, first.participantLabel)
  assert.equal(first.participantLabel.includes('自定义昵称'), false)
  assert.equal(database.byHash.size, 2)
  assert.equal(database.byNumber.size, 2)
})
