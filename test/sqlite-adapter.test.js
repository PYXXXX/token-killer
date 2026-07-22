import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import worker from '../worker/index.js'
import { SQLiteD1Database } from '../server/sqlite.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('SQLite adapter migrates and serves the leaderboard API across restarts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-killer-sqlite-'))
  const filename = path.join(directory, 'token-killer.sqlite')
  const secret = 'test-secret-that-is-longer-than-thirty-two-characters'

  let database = new SQLiteD1Database(filename, { migrationsDirectory: path.join(root, 'migrations') })
  let env = {
    TOKEN_KILLER_DB: database,
    LEADERBOARD_HMAC_SECRET: secret,
    ALLOWED_ORIGINS: 'https://burn.bilirec.com',
    STORAGE_KIND: 'sqlite',
  }

  const request = (pathname, body) => worker.fetch(new Request(`https://burn.bilirec.com${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { origin: 'https://burn.bilirec.com', 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }), env)

  const health = await request('/api/health')
  assert.equal(health.status, 200)
  assert.equal((await health.json()).storage, 'sqlite')

  const profileRequest = {
    installationId: '00000000-0000-4000-8000-000000000001',
    locale: 'zh-CN',
  }
  const firstProfileResponse = await request('/api/leaderboard/profile', profileRequest)
  assert.equal(firstProfileResponse.status, 200)
  const firstProfile = await firstProfileResponse.json()
  assert.match(firstProfile.participantLabel, /^燃烧者 #[1-9]\d{5}$/)

  database.close()
  database = new SQLiteD1Database(filename, { migrationsDirectory: path.join(root, 'migrations') })
  env = { ...env, TOKEN_KILLER_DB: database }

  const secondProfileResponse = await request('/api/leaderboard/profile', profileRequest)
  assert.equal(secondProfileResponse.status, 200)
  assert.equal((await secondProfileResponse.json()).participantLabel, firstProfile.participantLabel)

  database.close()
  fs.rmSync(directory, { recursive: true, force: true })
})
