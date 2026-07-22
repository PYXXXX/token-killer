import test from 'node:test'
import assert from 'node:assert/strict'
import { createPricingSnapshot, estimateUsageCost, resolvePrice } from '../src/lib/catalog.js'

test('OpenRouter pricing matches models selected through every OAuth provider', () => {
  const models = [
    { id: 'openai/gpt-5.6-sol', input: 0.000002, output: 0.000008 },
    { id: 'anthropic/claude-sonnet-4-6', input: 0.000003, output: 0.000015 },
    { id: 'google/gemini-2.5-pro', input: 0.00000125, output: 0.00001 },
    { id: 'x-ai/grok-4.3', input: 0.000003, output: 0.000015 },
  ]

  for (const [selectedModel, matchedModel] of [
    ['gpt-5.6-sol', 'openai/gpt-5.6-sol'],
    ['claude-sonnet-4-6', 'anthropic/claude-sonnet-4-6'],
    ['gemini-2.5-pro', 'google/gemini-2.5-pro'],
    ['grok-4.3', 'x-ai/grok-4.3'],
  ]) {
    const price = resolvePrice(selectedModel, models)
    assert.equal(price.matchedModel, matchedModel)
    assert.ok(price.input > 0)
    assert.ok(price.output > 0)
  }
})

test('cost statistics always use matched reference prices instead of upstream usage cost', () => {
  const usage = { input: 1_000, output: 2_000, cost: 999 }
  const price = { input: 0.000003, output: 0.000015 }

  assert.equal(estimateUsageCost(usage, price), 0.033)
})

test('missing or invalid prices produce a safe zero estimate', () => {
  assert.equal(estimateUsageCost({ input: 10, output: 20, cost: 8 }, null), 0)
  assert.equal(estimateUsageCost({ input: -10, output: 20 }, { input: -1, output: 0.5 }), 10)
})

test('pricing snapshots preserve the exact model match and rates used by a run', () => {
  const snapshot = createPricingSnapshot('gpt-5.6-sol', {
    matchedModel: 'openai/gpt-5.6-sol',
    input: 0.000002,
    output: 0.000008,
    source: 'OpenRouter 实时目录',
  }, 1_725_000_000_000, 1_725_000_001_000)

  assert.deepEqual(snapshot, {
    currency: 'USD',
    source: 'OpenRouter 实时目录',
    matchedModel: 'openai/gpt-5.6-sol',
    inputPerMillion: 2,
    outputPerMillion: 8,
    catalogUpdatedAt: 1_725_000_000_000,
    estimatedAt: 1_725_000_001_000,
  })
})
