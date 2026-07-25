import assert from 'node:assert/strict'
import test from 'node:test'
import { activityLevel, buildTokenActivity } from '../src/lib/activity.js'

test('token activity builds a Sunday-to-Saturday 53-week matrix', () => {
  const activity = buildTokenActivity([
    { date: '2026-07-24', tokens: 4200, rounds: 2 },
    { date: '2026-07-24', tokens: 800, rounds: 1 },
    { date: '2026-07-20', tokens: 1200, rounds: 1 },
  ], { anchor: new Date(2026, 6, 24), locale: 'en-US' })

  assert.equal(activity.weeks.length, 53)
  assert.equal(activity.cells.length, 371)
  assert.equal(activity.weeks[0].days[0].date.getDay(), 0)
  assert.equal(activity.weeks.at(-1).days.at(-1).date.getDay(), 6)
  assert.equal(activity.today.tokens, 5000)
  assert.equal(activity.today.runs, 2)
  assert.equal(activity.currentWeek.tokens, 6200)
  assert.equal(activity.allTimeTokens, 6200)
  assert.equal(activity.activeDays, 2)
})

test('activity intensity is zero for empty days and logarithmically distributed', () => {
  assert.equal(activityLevel(0, 100), 0)
  assert.equal(activityLevel(1, 100), 1)
  assert.equal(activityLevel(25, 100), 2)
  assert.equal(activityLevel(100, 100), 4)
})

test('activity computes current and longest daily streaks', () => {
  const activity = buildTokenActivity([
    { date: '2026-07-20', tokens: 10 },
    { date: '2026-07-21', tokens: 10 },
    { date: '2026-07-22', tokens: 10 },
    { date: '2026-07-24', tokens: 10 },
  ], { anchor: new Date(2026, 6, 24) })

  assert.equal(activity.currentStreak, 1)
  assert.equal(activity.longestStreak, 3)
  assert.equal(activity.months.length, 12)
})
