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
}

export function AchievementMark({ achievement, size = 22 }) {
  const Icon = ACHIEVEMENT_ICONS[achievement.icon] || Trophy
  return <Icon size={size} weight={achievement.unlocked ? 'fill' : 'regular'} />
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
    days: locale === 'en' ? 'days' : '天',
  }[achievement.valueType] || ''
  return `${formatTokens(current)} / ${formatTokens(achievement.target)} ${suffix}`
}

export function AchievementGallery({ achievements, locale, selectedId, onSelect }) {
  return (
    <section className="achievement-section section-block">
      <div className="achievement-heading">
        <div>
          <h2>{t(locale, '燃烧成就', 'Burn achievements')}</h2>
          <p>{t(
            locale,
            achievements.cloudSynced
              ? '排行榜已同步，离线时仍会使用本机运行记录。'
              : '由本机运行记录解锁；连接排行榜后可同步保存。',
            achievements.cloudSynced
              ? 'Synced with the leaderboard, with browser history as an offline fallback.'
              : 'Unlocked from browser history and saved when a leaderboard is connected.',
          )}</p>
        </div>
        <strong>{achievements.unlockedCount} / {achievements.totalCount}</strong>
      </div>
      <div className="achievement-track">
        {achievements.items.map((achievement) => {
          const selected = achievement.id === selectedId
          return (
            <button
              className={`achievement-card ${achievement.unlocked ? 'unlocked' : 'locked'} ${selected ? 'selected' : ''}`}
              key={achievement.id}
              type="button"
              disabled={!achievement.unlocked}
              aria-pressed={achievement.unlocked ? selected : undefined}
              onClick={() => onSelect(achievement.id)}
            >
              <span className="achievement-mark">
                {achievement.unlocked
                  ? <AchievementMark achievement={achievement} />
                  : <LockSimple size={20} weight="bold" />}
              </span>
              <span className="achievement-copy">
                <strong>{achievementTitle(achievement, locale)}</strong>
                <small>{achievementDescription(achievement, locale)}</small>
              </span>
              <span className="achievement-progress">
                {achievement.unlocked
                  ? t(locale, achievement.cloud ? '云端已保存' : '已解锁', achievement.cloud ? 'Saved to cloud' : 'Unlocked')
                  : achievementProgressLabel(achievement, locale)}
              </span>
            </button>
          )
        })}
      </div>
      <p className="achievement-note">
        {achievements.unlockedCount
          ? t(locale, '选择已解锁成就，可生成专属分享战报。', 'Select an unlocked achievement to create its share story.')
          : t(locale, '完成第一次消耗后，这里会亮起第一枚成就。', 'Complete your first burn to light up the first achievement.')}
      </p>
    </section>
  )
}
