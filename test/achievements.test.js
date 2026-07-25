import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateAchievements } from '../src/lib/achievements.js'

test('achievements unlock from aggregate run data without storing extra state', () => {
  const achievements = evaluateAchievements([
    {
      id: 'first',
      date: '2026-07-01',
      startedAt: new Date('2026-07-01T10:00:00Z').getTime(),
      provider: 'openai',
      model: 'gpt-5',
      tokens: 60_000,
      rounds: 60,
      cost: 2,
    },
    {
      id: 'second',
      date: '2026-07-02',
      startedAt: new Date('2026-07-02T10:00:00Z').getTime(),
      provider: 'chatgpt',
      model: 'gpt-5.1',
      tokens: 50_000,
      rounds: 40,
      cost: 10,
    },
  ])

  assert.equal(achievements.metrics.totalTokens, 110_000)
  assert.equal(achievements.metrics.totalRounds, 100)
  assert.equal(achievements.metrics.providerModeCount, 2)
  assert.equal(achievements.items.find((item) => item.id === 'first-spark').unlocked, true)
  assert.equal(achievements.items.find((item) => item.id === 'hundred-thousand').unlocked, true)
  assert.equal(achievements.items.find((item) => item.id === 'hundred-rounds').unlocked, true)
  assert.equal(achievements.items.find((item) => item.id === 'cross-platform').unlocked, true)
  assert.equal(achievements.items.find((item) => item.id === 'ten-dollar-run').unlocked, true)
  assert.equal(achievements.items.find((item) => item.id === 'million').unlocked, false)
})

test('streak achievement requires seven distinct consecutive active days', () => {
  const runs = Array.from({ length: 7 }, (_, index) => ({
    id: `run-${index}`,
    date: `2026-07-${String(index + 10).padStart(2, '0')}`,
    provider: 'openai',
    model: 'gpt-5',
    tokens: 1000,
    rounds: 1,
  }))
  runs.push({ ...runs[0], id: 'duplicate-day' })

  const achievements = evaluateAchievements(runs)
  const streak = achievements.items.find((item) => item.id === 'seven-day-streak')

  assert.equal(achievements.metrics.longestStreak, 7)
  assert.equal(streak.unlocked, true)
  assert.equal(streak.unlockedAt, new Date('2026-07-16T00:00:00').getTime())
})

test('model and black-hole achievements keep exact thresholds', () => {
  const achievements = evaluateAchievements([
    { date: '2026-07-01', provider: 'openai', model: 'a', tokens: 250_000_000 },
    { date: '2026-07-02', provider: 'openai', model: 'b', tokens: 250_000_000 },
    { date: '2026-07-03', provider: 'openai', model: 'c', tokens: 250_000_000 },
    { date: '2026-07-04', provider: 'openai', model: 'd', tokens: 250_000_000 },
  ])

  assert.equal(achievements.items.find((item) => item.id === 'model-sampler').unlocked, true)
  assert.equal(achievements.items.find((item) => item.id === 'black-hole').unlocked, true)
  assert.equal(achievements.unlockedCount, 5)
})
