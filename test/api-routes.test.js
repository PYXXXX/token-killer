import assert from 'node:assert/strict'
import test from 'node:test'
import { API_NAMESPACES, API_PREFIX, API_ROUTES, apiServiceUrl, isApiPath } from '../src/lib/apiRoutes.js'

test('every public application route stays inside the /api namespace', () => {
  const routes = [
    API_ROUTES.health,
    API_ROUTES.geoAssertion,
    API_ROUTES.leaderboard,
    API_ROUTES.leaderboardProfile,
    API_ROUTES.leaderboardSessions,
    API_ROUTES.leaderboardRuns,
    ...Object.values(API_ROUTES.oauth),
    ...Object.values(API_ROUTES.subscription),
  ]
  assert.equal(API_PREFIX, '/api')
  assert.ok(routes.every((route) => route.startsWith(`${API_PREFIX}/`)))
  assert.equal(new Set(routes).size, routes.length)
  assert.ok(Object.values(API_NAMESPACES).every((path) => path.startsWith(`${API_PREFIX}/`)))
})

test('service URLs accept either an origin or an explicit /api base', () => {
  assert.equal(apiServiceUrl('', API_ROUTES.health), '/api/health')
  assert.equal(apiServiceUrl('https://worker.example', API_ROUTES.health), 'https://worker.example/api/health')
  assert.equal(apiServiceUrl('https://worker.example/', API_ROUTES.health), 'https://worker.example/api/health')
  assert.equal(apiServiceUrl('https://worker.example/api', API_ROUTES.health), 'https://worker.example/api/health')
  assert.equal(apiServiceUrl('https://worker.example/api/?source=old', API_ROUTES.health), 'https://worker.example/api/health')
})

test('only /api paths are classified as application API traffic', () => {
  assert.equal(isApiPath('/api'), true)
  assert.equal(isApiPath('/api/geo/assertion'), true)
  assert.equal(isApiPath('/geo'), false)
  assert.equal(isApiPath('/token-killer'), false)
})
