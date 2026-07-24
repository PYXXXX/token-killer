import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const caddyfile = fs.readFileSync(new URL('../deploy/vps/Caddyfile.snippet', import.meta.url), 'utf8')

test('Caddy applies trusted Cloudflare handling only to the namespaced geo route', () => {
  assert.match(caddyfile, /@geoCloudflare\s*\{[\s\S]*?path \/api\/geo\/assertion/)
  assert.match(caddyfile, /@geoDirect path \/api\/geo\/assertion/)
  assert.doesNotMatch(caddyfile, /path \/geo(?:\s|$)/)
  assert.doesNotMatch(caddyfile, /CF-Ray/i)
})

test('Caddy overwrites trusted Cloudflare geo headers and strips them on direct requests', () => {
  const names = ['Country', 'Region', 'Region-Code', 'City']
  for (const name of names) {
    assert.match(caddyfile, new RegExp(`header_up X-Token-Killer-Geo-${name} \\{http\\.request\\.header\\.CF-`))
    assert.match(caddyfile, new RegExp(`header_up -X-Token-Killer-Geo-${name}`))
  }
  assert.match(caddyfile, /header_up X-Real-IP \{http\.request\.header\.CF-Connecting-IP\}/)
  assert.match(caddyfile, /header_up X-Real-IP \{remote_host\}/)
})
