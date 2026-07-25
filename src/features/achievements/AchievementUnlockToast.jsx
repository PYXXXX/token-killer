import { ShareNetwork, X } from '@phosphor-icons/react'
import { AchievementMark } from './AchievementGallery.jsx'
import { achievementDescription, achievementTitle } from './achievementCopy.js'
import { t } from '../../lib/i18n.js'

export function AchievementUnlockToast({ achievement, locale, onClose, onOpen, onShare }) {
  if (!achievement) return null
  return (
    <aside className="achievement-unlock" role="status" aria-live="polite">
      <div className="achievement-unlock-mark">
        <AchievementMark achievement={{ ...achievement, unlocked: true }} size={28} />
      </div>
      <div className="achievement-unlock-copy">
        <span>{t(locale, '成就解锁', 'Achievement unlocked')}</span>
        <strong>{achievementTitle(achievement, locale)}</strong>
        <p>{achievementDescription(achievement, locale)}</p>
      </div>
      <button className="achievement-unlock-close" type="button" aria-label={t(locale, '关闭成就提示', 'Close achievement notice')} onClick={onClose}>
        <X size={16} />
      </button>
      <div className="achievement-unlock-actions">
        <button type="button" onClick={onOpen}>{t(locale, '查看成就', 'View')}</button>
        <button className="primary" type="button" onClick={onShare}>
          <ShareNetwork size={16} />
          {t(locale, '分享', 'Share')}
        </button>
      </div>
    </aside>
  )
}
