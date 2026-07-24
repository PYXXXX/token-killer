import assert from 'node:assert/strict'
import test from 'node:test'
import { subscriptionPlanLabel } from '../src/lib/accountLabels.js'

test('OpenAI internal prolite plan is presented as Pro Lite', () => {
  assert.equal(subscriptionPlanLabel('openai', 'prolite'), 'Pro Lite')
})

test('unknown plan values remain readable without changing their meaning', () => {
  assert.equal(subscriptionPlanLabel('openai', 'education_plus'), 'Education Plus')
})

test('provider name is used when an account has no plan claim', () => {
  assert.equal(subscriptionPlanLabel('openai', ''), 'ChatGPT')
  assert.equal(subscriptionPlanLabel('claude', ''), 'Claude')
})
