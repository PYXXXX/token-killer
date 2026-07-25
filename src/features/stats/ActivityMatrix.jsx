import { activityLevel } from '../../lib/activity.js'
import { formatTokens } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'

export function ActivityMatrix({ activity, mode, locale }) {
  const tokensLabel = (tokens) => `${formatTokens(tokens)} Token`

  if (mode === 'week') {
    return (
      <div className="activity-scroll">
        <div
          className="activity-week-view"
          role="img"
          aria-label={t(locale, '过去 53 周 Token 活动', 'Token activity over the past 53 weeks')}
        >
          <div className="activity-week-cells">
            {activity.weeks.map((week) => (
              <i
                className={`activity-cell level-${activityLevel(week.tokens, activity.weeklyPeak)}`}
                key={week.key}
                title={`${week.label}: ${tokensLabel(week.tokens)}`}
                aria-hidden="true"
              />
            ))}
          </div>
          <div className="activity-month-labels" style={{ '--activity-columns': activity.weeks.length }}>
            {activity.monthLabels.map((month) => (
              <span key={`${month.index}-${month.label}`} style={{ gridColumn: month.index + 1 }}>
                {month.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'total') {
    return (
      <div
        className="activity-month-view"
        role="img"
        aria-label={t(locale, '过去 12 个月累计 Token 活动', 'Monthly token activity over the past 12 months')}
      >
        {activity.months.map((month) => (
          <div className="activity-month" key={month.key} title={`${month.label}: ${tokensLabel(month.tokens)}`}>
            <i
              className={`activity-cell level-${activityLevel(month.tokens, activity.monthlyPeak)}`}
              aria-hidden="true"
            />
            <span>{month.label}</span>
            <strong>{formatTokens(month.tokens)}</strong>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="activity-scroll">
      <div
        className="activity-year-view"
        role="img"
        aria-label={t(locale, '过去一年每日 Token 活动', 'Daily token activity over the past year')}
      >
        <div className="activity-day-grid">
          {activity.weeks.map((week) => (
            <div className="activity-week-column" key={week.key}>
              {week.days.map((day) => (
                <i
                  className={`activity-cell level-${day.isFuture ? 0 : activityLevel(day.tokens, activity.dailyPeak)} ${day.isFuture ? 'is-future' : ''}`}
                  key={day.key}
                  title={day.isFuture ? '' : `${day.label}: ${tokensLabel(day.tokens)}`}
                  aria-hidden="true"
                />
              ))}
            </div>
          ))}
        </div>
        <div className="activity-month-labels" style={{ '--activity-columns': activity.weeks.length }}>
          {activity.monthLabels.map((month) => (
            <span key={`${month.index}-${month.label}`} style={{ gridColumn: month.index + 1 }}>
              {month.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CompactActivityMatrix({ activity }) {
  const weeks = activity.weeks.slice(-14)
  return (
    <div className="share-activity-grid" aria-hidden="true">
      {weeks.map((week) => (
        <div key={week.key}>
          {week.days.map((day) => (
            <i
              className={`activity-cell level-${day.isFuture ? 0 : activityLevel(day.tokens, activity.dailyPeak)} ${day.isFuture ? 'is-future' : ''}`}
              key={day.key}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
