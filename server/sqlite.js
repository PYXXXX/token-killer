import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

function normalizeBindings(values) {
  return values.map((value) => value === undefined ? null : value)
}

class SQLiteStatement {
  constructor(database, sql, bindings = []) {
    this.database = database
    this.sql = sql
    this.bindings = bindings
  }

  bind(...bindings) {
    return new SQLiteStatement(this.database, this.sql, normalizeBindings(bindings))
  }

  first(column) {
    const row = this.database.prepare(this.sql).get(...this.bindings)
    if (!row) return null
    return column ? row[column] ?? null : row
  }

  all() {
    return this.execute()
  }

  run() {
    return this.execute()
  }

  execute() {
    const statement = this.database.prepare(this.sql)
    if (statement.reader) {
      return { success: true, results: statement.all(...this.bindings), meta: {} }
    }

    const result = statement.run(...this.bindings)
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    }
  }
}

export class SQLiteD1Database {
  constructor(filename, { migrationsDirectory } = {}) {
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    this.database = new Database(filename)
    this.database.pragma('foreign_keys = ON')
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('busy_timeout = 5000')
    this.database.pragma('synchronous = NORMAL')
    if (migrationsDirectory) this.migrate(migrationsDirectory)
  }

  prepare(sql) {
    return new SQLiteStatement(this.database, sql)
  }

  batch(statements) {
    return this.database.transaction((items) => items.map((statement) => statement.execute()))(statements)
  }

  migrate(directory) {
    this.database.exec(`CREATE TABLE IF NOT EXISTS token_killer_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`)

    const applied = new Set(
      this.database.prepare('SELECT name FROM token_killer_migrations').all().map((row) => row.name),
    )
    const migrations = fs.readdirSync(directory)
      .filter((name) => /^\d+.*\.sql$/i.test(name))
      .sort()

    const apply = this.database.transaction((name, sql) => {
      this.database.exec(sql)
      this.database.prepare(
        'INSERT INTO token_killer_migrations (name, applied_at) VALUES (?, ?)',
      ).run(name, Math.floor(Date.now() / 1000))
    })

    for (const name of migrations) {
      if (applied.has(name)) continue
      apply(name, fs.readFileSync(path.join(directory, name), 'utf8'))
    }
  }

  close() {
    this.database.close()
  }
}
