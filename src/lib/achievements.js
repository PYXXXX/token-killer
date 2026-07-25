const DAY_MS = 86_400_000
const SUBSCRIPTION_PROVIDERS = new Set([
  'chatgpt',
  'claude_subscription',
  'gemini_subscription',
  'grok_subscription',
])

export const ACHIEVEMENT_DEFINITIONS = [
  {
    id: 'first-spark',
    icon: 'fire',
    title: '第一把火',
    titleEn: 'First spark',
    description: '完成第一次 Token 消耗。',
    descriptionEn: 'Complete your first token burn.',
    metric: 'runCount',
    target: 1,
    valueType: 'runs',
  },
  {
    id: 'hundred-thousand',
    icon: 'tokens',
    title: '杯水车薪',
    titleEn: 'A drop in the furnace',
    description: '累计消耗 100K Token。',
    descriptionEn: 'Burn 100K tokens in total.',
    metric: 'totalTokens',
    target: 100_000,
    valueType: 'tokens',
  },
  {
    id: 'million',
    icon: 'lightning',
    title: '毫无意义',
    titleEn: 'Pointless by design',
    description: '累计消耗 1M Token。',
    descriptionEn: 'Burn 1M tokens in total.',
    metric: 'totalTokens',
    target: 1_000_000,
    valueType: 'tokens',
  },
  {
    id: 'hundred-rounds',
    icon: 'rounds',
    title: '这也能算生产力？',
    titleEn: 'Does this count as productivity?',
    description: '累计完成 100 轮请求。',
    descriptionEn: 'Complete 100 request rounds.',
    metric: 'totalRounds',
    target: 100,
    valueType: 'rounds',
  },
  {
    id: 'model-sampler',
    icon: 'models',
    title: '雨露均沾',
    titleEn: 'Model sampler',
    description: '使用 4 个不同模型完成消耗。',
    descriptionEn: 'Complete burns with 4 different models.',
    metric: 'modelCount',
    target: 4,
    valueType: 'models',
  },
  {
    id: 'cross-platform',
    icon: 'platforms',
    title: '跨平台燃烧',
    titleEn: 'Cross-platform burner',
    description: '同时使用直连 API 和消费版订阅。',
    descriptionEn: 'Use both direct APIs and consumer subscriptions.',
    metric: 'providerModeCount',
    target: 2,
    valueType: 'modes',
  },
  {
    id: 'ten-dollar-run',
    icon: 'cost',
    title: '财务自由体验卡',
    titleEn: 'Financial freedom trial',
    description: '单次运行估算消费达到 $10。',
    descriptionEn: 'Reach an estimated $10 in a single run.',
    metric: 'maxRunCost',
    target: 10,
    valueType: 'money',
  },
  {
    id: 'seven-day-streak',
    icon: 'streak',
    title: '余火未熄',
    titleEn: 'Still burning',
    description: '连续 7 天留下 Token 记录。',
    descriptionEn: 'Record token activity for 7 days in a row.',
    metric: 'longestStreak',
    target: 7,
    valueType: 'days',
  },
  {
    id: 'black-hole',
    icon: 'black-hole',
    title: '黑洞引力',
    titleEn: 'Black hole gravity',
    description: '累计消耗 1B Token。',
    descriptionEn: 'Burn 1B tokens in total.',
    metric: 'totalTokens',
    target: 1_000_000_000,
    valueType: 'tokens',
  },
]

function runTimestamp(run) {
  const startedAt = Number(run?.startedAt)
  if (Number.isFinite(startedAt) && startedAt > 0) return startedAt
  const savedDate = String(run?.date || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(savedDate)) {
    const timestamp = new Date(`${savedDate}T12:00:00`).getTime()
    return Number.isFinite(timestamp) ? timestamp : 0
  }
  return 0
}

function runDateTimestamp(run) {
  const savedDate = String(run?.date || '')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(savedDate)
    ? new Date(`${savedDate}T12:00:00`)
    : new Date(runTimestamp(run))
  if (Number.isNaN(date.getTime())) return 0
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function updateReachedAt(reachedAt, metrics, timestamp) {
  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    if (definition.metric === 'longestStreak' || reachedAt[definition.id]) continue
    if (metrics[definition.metric] >= definition.target) reachedAt[definition.id] = timestamp
  }
}

function streakMetrics(runs) {
  const dates = Array.from(new Set(
    runs
      .filter((run) => Math.max(0, Number(run?.tokens) || 0) > 0)
      .map(runDateTimestamp)
      .filter(Boolean),
  )).sort((left, right) => left - right)
  let longest = 0
  let current = 0
  let previous = 0
  let sevenDayReachedAt = 0

  for (const timestamp of dates) {
    current = previous && Math.round((timestamp - previous) / DAY_MS) === 1 ? current + 1 : 1
    longest = Math.max(longest, current)
    if (!sevenDayReachedAt && current >= 7) sevenDayReachedAt = timestamp
    previous = timestamp
  }
  return { longest, sevenDayReachedAt }
}

export function evaluateAchievements(runs) {
  const orderedRuns = [...(Array.isArray(runs) ? runs : [])]
    .filter((run) => run && typeof run === 'object')
    .sort((left, right) => runTimestamp(left) - runTimestamp(right))
  const models = new Set()
  const providerModes = new Set()
  const reachedAt = {}
  const metrics = {
    runCount: 0,
    totalTokens: 0,
    totalRounds: 0,
    modelCount: 0,
    providerModeCount: 0,
    maxRunCost: 0,
    longestStreak: 0,
  }

  for (const run of orderedRuns) {
    metrics.runCount += 1
    metrics.totalTokens += Math.max(0, Number(run.tokens) || 0)
    metrics.totalRounds += Math.max(0, Number(run.rounds) || 0)
    metrics.maxRunCost = Math.max(metrics.maxRunCost, Math.max(0, Number(run.cost) || 0))
    const model = String(run.model || '').trim().toLowerCase()
    if (model) models.add(model)
    const provider = String(run.provider || '').trim()
    if (provider) providerModes.add(SUBSCRIPTION_PROVIDERS.has(provider) ? 'subscription' : 'direct')
    metrics.modelCount = models.size
    metrics.providerModeCount = providerModes.size
    updateReachedAt(reachedAt, metrics, runTimestamp(run) || Date.now())
  }

  const streak = streakMetrics(orderedRuns)
  metrics.longestStreak = streak.longest
  if (streak.sevenDayReachedAt) reachedAt['seven-day-streak'] = streak.sevenDayReachedAt

  const items = ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const current = metrics[definition.metric]
    const unlocked = current >= definition.target
    return {
      ...definition,
      current,
      unlocked,
      unlockedAt: unlocked ? reachedAt[definition.id] || 0 : 0,
      progress: Math.min(100, Math.max(0, (current / definition.target) * 100)),
    }
  })
  const unlockedItems = items
    .filter((item) => item.unlocked)
    .sort((left, right) => right.unlockedAt - left.unlockedAt)

  return {
    items,
    unlockedItems,
    latest: unlockedItems[0] || null,
    unlockedCount: unlockedItems.length,
    totalCount: items.length,
    metrics,
  }
}

export function mergeCloudAchievements(localResult, cloudState) {
  if (!cloudState || typeof cloudState !== 'object') return localResult
  const cloudUnlocked = new Map(
    (Array.isArray(cloudState.unlocked) ? cloudState.unlocked : [])
      .filter((item) => item && typeof item.id === 'string')
      .map((item) => [item.id, Math.max(0, Number(item.unlockedAt) || 0)]),
  )
  const cloudMetrics = cloudState.metrics && typeof cloudState.metrics === 'object'
    ? cloudState.metrics
    : {}
  const metrics = Object.fromEntries(
    Object.entries(localResult.metrics).map(([key, value]) => [
      key,
      Math.max(Number(value) || 0, Number(cloudMetrics[key]) || 0),
    ]),
  )
  const items = ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const local = localResult.items.find((item) => item.id === definition.id)
    const cloudUnlockedAt = cloudUnlocked.get(definition.id) || 0
    const current = metrics[definition.metric] || 0
    const unlocked = Boolean(local?.unlocked || cloudUnlockedAt || current >= definition.target)
    const timestamps = [local?.unlockedAt, cloudUnlockedAt].filter((value) => Number(value) > 0)
    return {
      ...definition,
      current,
      unlocked,
      cloud: Boolean(cloudUnlockedAt),
      unlockedAt: timestamps.length ? Math.min(...timestamps) : 0,
      progress: Math.min(100, Math.max(0, (current / definition.target) * 100)),
    }
  })
  const unlockedItems = items
    .filter((item) => item.unlocked)
    .sort((left, right) => right.unlockedAt - left.unlockedAt)

  return {
    items,
    unlockedItems,
    latest: unlockedItems[0] || null,
    unlockedCount: unlockedItems.length,
    totalCount: items.length,
    metrics,
    cloudSynced: true,
  }
}
