import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'

const source = process.env.DATABASE_PATH || '/data/token-killer.sqlite'
const destinationDirectory = process.env.BACKUP_DIRECTORY || '/backups'
const retentionDays = Math.max(1, Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10) || 14)

fs.mkdirSync(destinationDirectory, { recursive: true })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const destination = path.join(destinationDirectory, `token-killer_${timestamp}.sqlite`)
const database = new Database(source, { readonly: true, fileMustExist: true })

try {
  await database.backup(destination)
} finally {
  database.close()
}

const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000)
for (const entry of fs.readdirSync(destinationDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !/^token-killer_.*\.sqlite$/.test(entry.name)) continue
  const filename = path.join(destinationDirectory, entry.name)
  if (fs.statSync(filename).mtimeMs < cutoff) fs.rmSync(filename)
}

process.stdout.write(`Created SQLite backup: ${destination}\n`)
