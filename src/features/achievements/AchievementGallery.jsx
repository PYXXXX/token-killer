import { useEffect, useMemo, useState } from 'react'
import {
  ChartBar,
  Crown,
  Database,
  Fire,
  Gauge,
  Lightning,
  ListChecks,
  LockSimple,
  SlidersHorizontal,
  Star,
  Trophy,
} from '@phosphor-icons/react'
import { formatMoney, formatTokens } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import { achievementDescription, achievementTitle } from './achievementCopy.js'

const ACHIEVEMENT_ICONS = {
  fire: Fire,
  tokens: Database,
  lightning: Lightning,
  rounds: ListChecks,
  models: ChartBar,
  platforms: SlidersHorizontal,
  cost: Gauge,
  streak: Star,
  'black-hole': Crown,
  rocket: Lightning,
  repeat: ListChecks,
  stack: Database,
  orbit: Crown,
  globe: SlidersHorizontal,
  coins: Gauge,
  calendar: Star,
}

const CATEGORY_LABELS = {
  all: ['全部', 'All'],
  burn: ['Token', 'Tokens'],
  runs: ['运行', 'Runs'],
  explore: ['探索', 'Explore'],
  cost: ['成本', 'Spend'],
  streak: ['活跃', 'Activity'],
}

const RARITY_LABELS = {
  common: ['普通', 'Common'],
  rare: ['稀有', 'Rare'],
  epic: ['史诗', 'Epic'],
  legendary: ['传奇', 'Legendary'],
}

export function AchievementMark({ achievement, size = 22 }) {
  const Icon = ACHIEVEMENT_ICONS[achievement.icon] || Trophy
  return <Icon size={size} weight={achievement.unlocked ? 'fill' : 'regular'} />
}

function categoryLabel(category, locale) {
  const pair = CATEGORY_LABELS[category] || CATEGORY_LABELS.all
  return locale === 'en' ? pair[1] : pair[0]
}

function rarityLabel(rarity, locale) {
  const pair = RARITY_LABELS[rarity] || RARITY_LABELS.common
  return locale === 'en' ? pair[1] : pair[0]
}

function achievementProgressLabel(achievement, locale) {
  const current = Math.min(achievement.current, achievement.target)
  if (achievement.valueType === 'tokens') {
    return `${formatTokens(current)} / ${formatTokens(achievement.target)} Token`
  }
  if (achievement.valueType === 'money') {
    return `${formatMoney(current)} / ${formatMoney(achievement.target)}`
  }
  const suffix = {
    runs: locale === 'en' ? 'runs' : '次运行',
    rounds: locale === 'en' ? 'rounds' : '轮',
    models: locale === 'en' ? 'models' : '个模型',
    modes: locale === 'en' ? 'modes' : '种模式',
    providers: locale === 'en' ? 'providers' : '个 Provider',
    days: locale === 'en' ? 'days' : '天',
  }[achievement.valueType] || ''
  return `${formatTokens(current)} / ${formatTokens(achievement.target)} ${suffix}`
}

function achievementRemainingLabel(achievement, locale) {
  const remaining = Math.max(0, achievement.target - achievement.current)
  if (achievement.valueType === 'tokens') return `${formatTokens(remaining)} Token`
  if (achievement.valueType === 'money') return formatMoney(remaining)
  const suffix = {
    runs: locale === 'en' ? 'runs' : '次运行',
    rounds: locale === 'en' ? 'rounds' : '轮',
    models: locale === 'en' ? 'models' : '个模型',
    modes: locale === 'en' ? 'modes' : '种模式',
    providers: locale === 'en' ? 'providers' : '个 Provider',
    days: locale === 'en' ? 'days' : '天',
  }[achievement.valueType] || ''
  return `${formatTokens(remaining)} ${suffix}`
}

function closestLockedAchievement(items) {
  return [...items]
    .filter((item) => !item.unlocked)
    .sort((left, right) => right.progress - left.progress || left.target - right.target)[0] || null
}

export function AchievementGallery({ achievements, locale, selectedId, onSelect }) {
  const [category, setCategory] = useState('all')
  const [focusedId, setFocusedId] = useState('')
  const closestLocked = useMemo(
    () => closestLockedAchievement(achievements.items),
    [achievements.items],
  )
  const focused = achievements.items.find((item) => item.id === focusedId)
    || achievements.items.find((item) => item.id === selectedId)
    || closestLocked
    || achievements.latest
    || achievements.items[0]
  const visibleItems = useMemo(
    () => category === 'all'
      ? achievements.items
      : achievements.items.filter((item) => item.category === category),
    [achievements.items, category],
  )

  useEffect(() => {
    if (selectedId) setFocusedId(selectedId)
  }, [selectedId])

  const focusAchievement = (achievement) => {
    setFocusedId(achievement.id)
    if (achievement.unlocked) onSelect(achievement.id)
  }

  return (
    <section className="achievement-section section-block">
      <div className="achievement-heading">
        <div>
          <h2>{t(locale, '成就馆', 'Achievement vault')}</h2>
          <p>{t(
            locale,
            achievements.cloudSynced
              ? '进度已与排行榜同步，本机记录会在离线时继续计算。'
              : '由本机运行记录解锁；连接排行榜后会自动保存。',
            achievements.cloudSynced
              ? 'Progress is synced with the leaderboard, with browser history available offline.'
              : 'Unlocked from browser history and saved after connecting to the leaderboard.',
          )}</p>
        </div>
        <div className="achievement-total" aria-label={t(
          locale,
          `已解锁 ${achievements.unlockedCount} / ${achievements.totalCount}`,
          `${achievements.unlockedCount} of ${achievements.totalCount} unlocked`,
        )}>
          <strong>{achievements.unlockedCount}</strong>
          <span>/ {achievements.totalCount}</span>
          <small>{t(locale, '已解锁', 'Unlocked')}</small>
        </div>
      </div>

      {focused ? (
        <div className={`achievement-showcase rarity-${focused.rarity} ${focused.unlocked ? 'unlocked' : 'locked'}`}>
          <div
            className="achievement-showcase-medal"
            style={{ '--achievement-progress': `${Math.max(2, focused.progress)}%` }}
          >
            <span>
              {focused.unlocked
                ? <AchievementMark achievement={focused} size={32} />
                : <LockSimple size={27} weight="bold" />}
            </span>
          </div>
          <div className="achievement-showcase-copy">
            <span className="achievement-overline">
              {categoryLabel(focused.category, locale)}
              <i aria-hidden="true" />
              {rarityLabel(focused.rarity, locale)}
            </span>
            <h3>{achievementTitle(focused, locale)}</h3>
            <p>{achievementDescription(focused, locale)}</p>
            <div className="achievement-showcase-progress">
              <span><i style={{ width: `${focused.progress}%` }} /></span>
              <div>
                <small>{achievementProgressLabel(focused, locale)}</small>
                <strong>{Math.round(focused.progress)}%</strong>
              </div>
            </div>
          </div>
          <div className="achievement-showcase-status">
            <span>{focused.unlocked
              ? t(locale, focused.cloud ? '已保存至云端' : '已在本机解锁', focused.cloud ? 'Saved to cloud' : 'Unlocked locally')
              : t(locale, '下一个目标', 'Next objective')}</span>
            <strong>{focused.unlocked
              ? t(locale, '成就已点亮', 'Achievement lit')
              : t(
                locale,
                `还差 ${achievementRemainingLabel(focused, locale)}`,
                `${achievementRemainingLabel(focused, locale)} to go`,
              )}</strong>
            {focused.unlocked ? (
              <button type="button" onClick={() => onSelect(focused.id)}>
                {t(locale, '生成分享战报', 'Create share story')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="achievement-toolbar">
        <div className="achievement-filters" role="group" aria-label={t(locale, '成就分类', 'Achievement categories')}>
          {Object.entries(CATEGORY_LABELS).map(([value]) => {
            const count = value === 'all'
              ? achievements.items.length
              : achievements.items.filter((item) => item.category === value).length
            return (
              <button
                className={category === value ? 'active' : ''}
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
              >
                <span>{categoryLabel(value, locale)}</span>
                <small>{count}</small>
              </button>
            )
          })}
        </div>
        <span>{t(locale, '点击徽章查看进度', 'Select a badge to inspect progress')}</span>
      </div>

      <div className="achievement-grid">
        {visibleItems.map((achievement) => {
          const selected = achievement.id === focused.id
          return (
            <button
              className={`achievement-card rarity-${achievement.rarity} ${achievement.unlocked ? 'unlocked' : 'locked'} ${selected ? 'selected' : ''}`}
              key={achievement.id}
              type="button"
              aria-pressed={selected}
              onClick={() => focusAchievement(achievement)}
            >
              <span
                className="achievement-mark"
                style={{ '--achievement-progress': `${Math.max(2, achievement.progress)}%` }}
              >
                {achievement.unlocked
                  ? <AchievementMark achievement={achievement} />
                  : <LockSimple size={18} weight="bold" />}
              </span>
              <span className="achievement-copy">
                <small>{rarityLabel(achievement.rarity, locale)}</small>
                <strong>{achievementTitle(achievement, locale)}</strong>
              </span>
              <span className="achievement-progress">
                <i><b style={{ width: `${achievement.progress}%` }} /></i>
                <small>
                  {achievement.unlocked
                    ? t(locale, achievement.cloud ? '云端保存' : '已解锁', achievement.cloud ? 'Cloud saved' : 'Unlocked')
                    : achievementProgressLabel(achievement, locale)}
                </small>
              </span>
            </button>
          )
        })}
      </div>

      <p className="achievement-note">
        {achievements.unlockedCount
          ? t(locale, '已解锁成就可以直接生成分享战报。', 'Unlocked achievements can be turned into share stories.')
          : t(locale, '完成第一次消耗后，这里会点亮第一枚徽章。', 'Complete your first burn to light up the first badge.')}
      </p>
    </section>
  )
}
