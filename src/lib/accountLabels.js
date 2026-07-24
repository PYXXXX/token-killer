const PLAN_LABELS = {
  business: 'Business',
  enterprise: 'Enterprise',
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  team: 'Team',
}

const PROVIDER_LABELS = {
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  openai: 'ChatGPT',
}

export function subscriptionPlanLabel(provider, planType) {
  const value = String(planType || '').trim()
  if (!value) return PROVIDER_LABELS[provider] || provider || ''

  const compact = value.toLowerCase().replace(/[\s_-]+/g, '')
  if (PLAN_LABELS[compact]) return PLAN_LABELS[compact]

  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
