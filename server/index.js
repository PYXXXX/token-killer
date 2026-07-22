import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import worker from '../worker/index.js'
import { SQLiteD1Database } from './sqlite.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = integerEnvironment('PORT', 8787, 1, 65535)
const host = process.env.HOST || '0.0.0.0'
const maxBodyBytes = integerEnvironment('MAX_BODY_BYTES', 1_048_576, 1024, 10_485_760)
const database = new SQLiteD1Database(
  process.env.DATABASE_PATH || path.join(root, 'data', 'token-killer.sqlite'),
  { migrationsDirectory: path.join(root, 'migrations') },
)

const env = {
  TOKEN_KILLER_DB: database,
  LEADERBOARD_HMAC_SECRET: secretEnvironment('LEADERBOARD_HMAC_SECRET'),
  GEO_ASSERTION_HMAC_SECRET: secretEnvironment('GEO_ASSERTION_HMAC_SECRET'),
  GEMINI_OAUTH_CLIENT_ID: secretEnvironment('GEMINI_OAUTH_CLIENT_ID'),
  GEMINI_OAUTH_CLIENT_SECRET: secretEnvironment('GEMINI_OAUTH_CLIENT_SECRET'),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
  TRUST_GEO_HEADERS: process.env.TRUST_GEO_HEADERS || '',
  STORAGE_KIND: 'sqlite',
}

const requestWindows = new Map()

function secretEnvironment(name) {
  const filename = process.env[`${name}_FILE`]
  if (!filename) return process.env[name] || ''
  return fs.readFileSync(filename, 'utf8').trim()
}

function integerEnvironment(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`)
  }
  return value
}

function clientIp(headers) {
  return headers.get('cf-connecting-ip')
    || headers.get('x-real-ip')
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'local'
}

function rateLimit(pathname, headers) {
  const group = pathname.startsWith('/api/subscription/')
    ? ['subscription', 30]
    : pathname.startsWith('/api/oauth/')
      ? ['oauth', 120]
      : pathname.startsWith('/api/leaderboard')
        ? ['leaderboard', 180]
        : null
  if (!group) return null

  const now = Date.now()
  const key = `${group[0]}:${clientIp(headers)}`
  let window = requestWindows.get(key)
  if (!window || now - window.startedAt >= 60_000) {
    window = { startedAt: now, count: 0 }
    requestWindows.set(key, window)
  }
  window.count += 1
  if (window.count <= group[1]) return null
  return Math.max(1, Math.ceil((60_000 - (now - window.startedAt)) / 1000))
}

async function readBody(request) {
  const declared = Number(request.headers['content-length'] || 0)
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    const error = new Error('Request body is too large.')
    error.status = 413
    throw error
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) {
      const error = new Error('Request body is too large.')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function publicUrl(request, headers) {
  const protocol = (headers.get('x-forwarded-proto') || 'http').split(',')[0].trim()
  const hostHeader = (headers.get('x-forwarded-host') || headers.get('host') || `localhost:${port}`).split(',')[0].trim()
  return new URL(request.url || '/', `${protocol}://${hostHeader}`)
}

function jsonError(response, status, message, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  response.end(JSON.stringify({ error: message }))
}

async function handle(request, response) {
  const headers = new Headers()
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers.append(request.rawHeaders[index], request.rawHeaders[index + 1])
  }
  const url = publicUrl(request, headers)
  const retryAfter = rateLimit(url.pathname, headers)
  if (retryAfter) {
    jsonError(response, 429, 'Too many requests. Try again later.', { 'retry-after': String(retryAfter) })
    return
  }

  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })

  const body = ['GET', 'HEAD'].includes(request.method || 'GET') ? undefined : await readBody(request)
  const webRequest = new Request(url, {
    method: request.method,
    headers,
    body,
    signal: controller.signal,
  })
  const webResponse = await worker.fetch(webRequest, env)

  response.statusCode = webResponse.status
  response.statusMessage = webResponse.statusText
  webResponse.headers.forEach((value, name) => response.setHeader(name, value))
  if (!webResponse.body) {
    response.end()
    return
  }
  Readable.fromWeb(webResponse.body).pipe(response)
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (response.headersSent) {
      response.destroy(error)
      return
    }
    const status = Number(error.status) || 500
    jsonError(response, status, status >= 500 ? 'Community service is temporarily unavailable.' : error.message)
  })
})

server.headersTimeout = 15_000
server.requestTimeout = 30_000
server.keepAliveTimeout = 5_000

server.listen(port, host, () => {
  process.stdout.write(`Token Killer API listening on http://${host}:${port}\n`)
})

function shutdown(signal) {
  process.stdout.write(`Received ${signal}, shutting down.\n`)
  server.close(() => {
    database.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
