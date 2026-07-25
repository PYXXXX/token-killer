const DAY_MS = 86_400_000

function startOfDay(value) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function dateKey(value) {
  const date = startOfDay(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function runDateKey(run) {
  const saved = String(run?.date || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved
  const timestamp = Number(run?.startedAt)
  return Number.isFinite(timestamp) && timestamp > 0 ? dateKey(timestamp) : ''
}

function addDays(date, amount) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function aggregateRuns(runs) {
  const totals = new Map()
  for (const run of Array.isArray(runs) ? runs : []) {
    const key = runDateKey(run)
    if (!key) continue
    const current = totals.get(key) || { tokens: 0, rounds: 0, runs: 0 }
    current.tokens += Math.max(0, Number(run.tokens) || 0)
    current.rounds += Math.max(0, Number(run.rounds) || 0)
    current.runs += 1
    totals.set(key, current)
  }
  return totals
}

function longestStreak(cells) {
  let current = 0
  let longest = 0
  for (const cell of cells) {
    if (cell.isFuture) continue
    current = cell.tokens > 0 ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}

function currentStreak(totals, today) {
  let streak = 0
  let cursor = today
  while ((totals.get(dateKey(cursor))?.tokens || 0) > 0) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

export function activityLevel(tokens, maximum) {
  const value = Math.max(0, Number(tokens) || 0)
  const peak = Math.max(0, Number(maximum) || 0)
  if (!value || !peak) return 0
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / peak) * 4)))
}

export function buildTokenActivity(runs, { anchor = new Date(), weeks = 53, locale = 'zh-CN' } = {}) {
  const safeWeeks = Math.min(104, Math.max(8, Math.floor(Number(weeks) || 53)))
  const today = startOfDay(anchor)
  const gridEnd = addDays(today, 6 - today.getDay())
  const gridStart = addDays(gridEnd, -(safeWeeks * 7 - 1))
  const totals = aggregateRuns(runs)
  const cells = Array.from({ length: safeWeeks * 7 }, (_, index) => {
    const date = addDays(gridStart, index)
    const key = dateKey(date)
    const total = totals.get(key) || { tokens: 0, rounds: 0, runs: 0 }
    return {
      ...total,
      key,
      date,
      isFuture: date > today,
      label: date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    }
  })
  const weekColumns = Array.from({ length: safeWeeks }, (_, index) => {
    const days = cells.slice(index * 7, index * 7 + 7)
    return {
      key: days[0].key,
      days,
      tokens: days.reduce((sum, day) => sum + day.tokens, 0),
      rounds: days.reduce((sum, day) => sum + day.rounds, 0),
      runs: days.reduce((sum, day) => sum + day.runs, 0),
      label: `${days[0].label} - ${days[6].label}`,
    }
  })
  const monthLabels = []
  let lastMonth = ''
  weekColumns.forEach((week, index) => {
    const visibleDays = week.days.filter((day) => !day.isFuture)
    const marker = visibleDays.find((day) => day.date.getDate() <= 7) || visibleDays[0]
    if (!marker) return
    const monthKey = `${marker.date.getFullYear()}-${marker.date.getMonth()}`
    if (monthKey === lastMonth) return
    lastMonth = monthKey
    if (index === 0) return
    monthLabels.push({
      index,
      label: marker.date.toLocaleDateString(locale, { month: 'short' }),
    })
  })

  const monthStart = new Date(today.getFullYear(), today.getMonth() - 11, 1)
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth() + index, 1)
    const next = new Date(date.getFullYear(), date.getMonth() + 1, 1)
    const monthCells = cells.filter((cell) => cell.date >= date && cell.date < next && !cell.isFuture)
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleDateString(locale, { month: 'short' }),
      tokens: monthCells.reduce((sum, cell) => sum + cell.tokens, 0),
      rounds: monthCells.reduce((sum, cell) => sum + cell.rounds, 0),
      runs: monthCells.reduce((sum, cell) => sum + cell.runs, 0),
    }
  })
  const visibleCells = cells.filter((cell) => !cell.isFuture)
  const allTimeTokens = Array.from(totals.values()).reduce((sum, item) => sum + item.tokens, 0)
  const todayTotal = totals.get(dateKey(today)) || { tokens: 0, rounds: 0, runs: 0 }
  const currentWeek = weekColumns.find((week) => week.days.some((day) => day.key === dateKey(today))) || weekColumns.at(-1)

  return {
    cells,
    weeks: weekColumns,
    months,
    monthLabels,
    today: todayTotal,
    currentWeek,
    allTimeTokens,
    activeDays: visibleCells.filter((cell) => cell.tokens > 0).length,
    currentStreak: currentStreak(totals, today),
    longestStreak: longestStreak(visibleCells),
    dailyPeak: Math.max(0, ...visibleCells.map((cell) => cell.tokens)),
    weeklyPeak: Math.max(0, ...weekColumns.map((week) => week.tokens)),
    monthlyPeak: Math.max(0, ...months.map((month) => month.tokens)),
  }
}
