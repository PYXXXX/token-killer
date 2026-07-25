import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  ChartBar,
  Check,
  Copy,
  Crown,
  Database,
  DownloadSimple,
  Fire,
  Gauge,
  Info,
  Key,
  Lightning,
  ListChecks,
  Moon,
  MapPin,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  Trash,
  Translate,
  XLogo,
} from '@phosphor-icons/react'
import { I18nProvider, Localized } from './Localized.jsx'
import { useLocale } from './locale-context.js'
import { Field, Metric, NavButton, RankIcon, Segmented } from './components/ui.jsx'
import { BurnPanel } from './features/burn/BurnPanel.jsx'
import { useBurnSession } from './features/burn/useBurnSession.js'
import { ProviderFields } from './features/settings/ProviderFields.jsx'
import {
  ActivityMatrix,
  CompactActivityMatrix,
} from './features/stats/ActivityMatrix.jsx'
import {
  AchievementGallery,
  AchievementMark,
} from './features/achievements/AchievementGallery.jsx'
import { achievementDescription, achievementTitle } from './features/achievements/achievementCopy.js'
import { AchievementUnlockToast } from './features/achievements/AchievementUnlockToast.jsx'
import { subscriptionPlanLabel } from './lib/accountLabels.js'
import { loadProviderModels } from './lib/api.js'
import {
  checkSubscriptionService,
  deleteSubscriptionAccount,
  finishClaudeLogin,
  finishGeminiLogin,
  finishGrokLogin,
  listSubscriptionAccounts,
  pollChatGPTDeviceLogin,
  startChatGPTDeviceLogin,
  startClaudeLogin,
  startGeminiLogin,
  startGrokLogin,
} from './lib/accounts.js'
import {
  ACCOUNT_PROVIDER_TO_SETTINGS,
  API_FORMATS,
  loadOpenRouterModels,
  PROMPT_PRESETS,
  PROVIDERS,
  resolvePrice,
  SUBSCRIPTION_MODELS,
  SUBSCRIPTION_PROVIDER_IDS,
} from './lib/catalog.js'
import { formatDuration, formatMoney, formatTokens, todayKey } from './lib/format.js'
import { checkGeoService, defaultGeoEndpoint, deriveGeoEndpoint } from './lib/geo.js'
import { getLeaderboard, getLeaderboardProfile } from './lib/leaderboard.js'
import { RANK_TIERS, rankForTokens } from './lib/ranks.js'
import { EMPTY_MANUAL_REGION, countryOptions, sanitizeManualRegion } from './lib/regions.js'
import { loadCityOptions, loadRegionOptions } from './lib/regionCatalog.js'
import {
  clearLocalData,
  clearProviderBlocklist,
  exportLocalData,
  getParticipantLabel,
  hasOnboarded,
  markOnboarded,
  readProviderBlocklist,
  recoverInterruptedRun,
  readSettings,
  unblockProvider,
  writeRuns,
  writeSettings,
} from './lib/storage.js'
import { exportShareCard } from './lib/share.js'
import { clearLocalVault, deleteEncryptedSecret, getEncryptedSecret, saveEncryptedSecret } from './lib/localVault.js'
import { localeTag, resolveLocale, t, translateText } from './lib/i18n.js'
import { buildTokenActivity } from './lib/activity.js'
import { evaluateAchievements, mergeCloudAchievements } from './lib/achievements.js'

const isSubscriptionProvider = (provider) => SUBSCRIPTION_PROVIDER_IDS.includes(provider)
const apiKeySecretId = (provider) => `api-key:${provider}`
const EMPTY_SUBSCRIPTION_PROVIDERS = { openai: false, claude: false, gemini: false, grok: false }
const CONFIGURED_GEO_URL = String(
  import.meta.env.VITE_GEO_API_URL || import.meta.env.VITE_MAINLAND_GEO_API_URL || '',
).trim()
const DEFAULT_GEO_URL = (() => {
  if (!CONFIGURED_GEO_URL) return defaultGeoEndpoint()
  try {
    return deriveGeoEndpoint(CONFIGURED_GEO_URL)
  } catch {
    return defaultGeoEndpoint()
  }
})()
const DEFAULT_SYSTEM_PROMPTS = {
  'zh-CN': '你是一台只执行当前任务的语言模型。不要调用工具，不要提前结束。',
  en: 'You are a language model that only performs the current task. Do not use tools or stop early.',
}

function leaderboardSourceLabel(value) {
  const source = String(value || '').trim()
  if (!source) return '当前站点 /api'
  if (source.startsWith('/')) return `当前站点${source}`.slice(0, 96)
  try {
    const url = new URL(source)
    if (!['http:', 'https:'].includes(url.protocol)) return '当前站点 /api'
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`.slice(0, 96)
  } catch {
    return '当前站点 /api'
  }
}

function participantLabelFromEntry(value, rank = 0) {
  const label = String(value || '')
  if (/^燃烧者 #[1-9]\d{5}$/.test(label)) return label
  return `燃烧者 #${String(100000 + (Math.max(0, Number(rank) || 0) % 900000)).padStart(6, '0')}`
}

const DEFAULT_SETTINGS = {
  locale: 'system',
  provider: 'openrouter',
  endpoint: PROVIDERS.openrouter.endpoint,
  model: PROVIDERS.openrouter.model,
  apiKey: '',
  apiFormat: 'openai',
  authMode: 'bearer',
  tokenParam: 'auto',
  anthropicVersion: '2023-06-01',
  extraHeaders: '',
  stream: false,
  deepThinking: false,
  reasoningEffort: 'high',
  systemPrompt: DEFAULT_SYSTEM_PROMPTS[resolveLocale()],
  targetMode: 'tokens',
  targetTokens: 100000,
  targetAmount: 1,
  batchSize: 4096,
  promptId: 'entropy',
  customPrompt: '',
  publishToLeaderboard: true,
  leaderboardApiUrl: '',
  autoSelectRegion: true,
  geoApiUrl: DEFAULT_GEO_URL,
  manualRegion: { ...EMPTY_MANUAL_REGION },
  subscriptionApiUrl: '',
  selectedAccountId: '',
  theme: 'system',
  inputPricePerMillion: '',
  outputPricePerMillion: '',
  requestTimeoutSeconds: 300,
  maxRounds: 10000,
  maxDurationMinutes: 0,
  pauseWhenHidden: true,
  keepAwake: false,
}

function ShareStoryCard({
  story,
  activity,
  todayTokens,
  totalTokens,
  totalCost,
  globalRank,
  tier,
  participantLabel,
  achievement,
  achievements,
  locale,
}) {
  if (story === 'rank') {
    return (
      <div className="share-card share-card-rank-story">
        <div className="share-card-head">
          <span>{t(locale, '段位战报', 'Rank report')}</span>
          <small>{translateText(locale, participantLabel)}</small>
        </div>
        <div className="share-rank-emblem"><Crown size={32} weight="fill" /></div>
        <div className="share-rank-name">
          <span>{t(locale, '当前段位', 'Current rank')}</span>
          <strong>{translateText(locale, tier.fullName)}</strong>
        </div>
        <div className="share-rank-position">
          <span>{t(locale, '全球排名', 'Global rank')}</span>
          <b>{globalRank ? `#${globalRank}` : t(locale, '冲击中', 'Climbing')}</b>
        </div>
        <div className="share-card-foot">
          <span>{t(locale, `累计 ${formatTokens(totalTokens)} Token`, `Lifetime ${formatTokens(totalTokens)} Token`)}</span>
          <span>{t(locale, `还差 ${formatTokens(tier.tokensToNext)} Token`, `${formatTokens(tier.tokensToNext)} Token to next rank`)}</span>
        </div>
      </div>
    )
  }

  if (story === 'achievement' && achievement) {
    return (
      <div className="share-card share-card-achievement-story">
        <div className="share-card-head">
          <span>{t(locale, '成就战报', 'Achievement report')}</span>
          <small>{achievements.unlockedCount} / {achievements.totalCount}</small>
        </div>
        <div className="share-achievement-mark"><AchievementMark achievement={achievement} size={40} /></div>
        <div className="share-achievement-copy">
          <span>{t(locale, '新成就已解锁', 'Achievement unlocked')}</span>
          <strong>{achievementTitle(achievement, locale)}</strong>
          <p>{achievementDescription(achievement, locale)}</p>
        </div>
        <div className="share-card-foot">
          <span>{translateText(locale, participantLabel)}</span>
          <span>{formatTokens(totalTokens)} Token</span>
        </div>
      </div>
    )
  }

  return (
    <div className="share-card">
      <div className="share-card-head">
        <span>{t(locale, 'Token 活动', 'Token activity')}</span>
        <small>{t(locale, '过去 14 周', 'Past 14 weeks')}</small>
      </div>
      <CompactActivityMatrix activity={activity} />
      <div className="share-card-total">
        <span>{t(locale, '今日消耗', 'Burned today')}</span>
        <strong>{formatTokens(todayTokens)}</strong>
      </div>
      <div className="share-card-rank">
        <Crown size={16} weight="fill" />
        <span>{globalRank ? t(locale, `全球第 ${globalRank} 名`, `Global #${globalRank}`) : t(locale, '冲击全球榜', 'Climbing the global board')}</span>
        <b>{translateText(locale, tier.fullName)}</b>
      </div>
      <div className="share-card-foot">
        <span>{t(locale, `累计 ${formatTokens(totalTokens)} Token`, `Lifetime ${formatTokens(totalTokens)} Token`)}</span>
        <span>{translateText(locale, participantLabel)}</span>
      </div>
      <span className="share-card-cost">{t(locale, `估算 ${formatMoney(totalCost)}`, `Estimated ${formatMoney(totalCost)}`)}</span>
    </div>
  )
}

function StatsPanel({ runs, settings, leaderboardVersion, participantLabel, focusAchievementId = '' }) {
  const locale = useLocale()
  const formatDayCount = (value) => (
    locale.startsWith('en')
      ? `${value} ${value === 1 ? 'day' : 'days'}`
      : `${value} 天`
  )
  const [activityMode, setActivityMode] = useState('day')
  const [boardPeriod, setBoardPeriod] = useState('day')
  const [boardScope, setBoardScope] = useState('global')
  const [boardPage, setBoardPage] = useState(1)
  const [boardRefresh, setBoardRefresh] = useState(0)
  const [viewedTierId, setViewedTierId] = useState('')
  const [shareStory, setShareStory] = useState('activity')
  const [selectedAchievementId, setSelectedAchievementId] = useState('')
  const [globalBoard, setGlobalBoard] = useState({
    status: 'loading',
    entries: [],
    currentEntry: null,
    context: null,
    scope: 'global',
    page: 1,
    pageCount: 1,
    visibleLimit: 100,
    error: '',
  })
  const [rankProfile, setRankProfile] = useState({ status: 'loading', data: null, error: '' })
  useEffect(() => {
    if (!focusAchievementId) return
    setSelectedAchievementId(focusAchievementId)
    setShareStory('achievement')
  }, [focusAchievementId])
  const today = todayKey()
  const todayRuns = runs.filter((run) => run.date === today)
  const todayTokens = todayRuns.reduce((sum, run) => sum + run.tokens, 0)
  const totalTokens = runs.reduce((sum, run) => sum + run.tokens, 0)
  const totalCost = runs.reduce((sum, run) => sum + run.cost, 0)
  const totalRounds = runs.reduce((sum, run) => sum + run.rounds, 0)
  const activity = useMemo(
    () => buildTokenActivity(runs, { locale: localeTag(locale) }),
    [runs, locale],
  )
  const localAchievements = useMemo(() => evaluateAchievements(runs), [runs])
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - index))
    const key = todayKey(date)
    const dateRuns = runs.filter((run) => run.date === key)
    return {
      key,
      label: date.toLocaleDateString(localeTag(locale), { weekday: 'short' }),
      tokens: dateRuns.reduce((sum, run) => sum + run.tokens, 0),
      runs: dateRuns,
    }
  })
  const recentRuns = days.flatMap((day) => day.runs)
  const recentTokens = days.reduce((sum, day) => sum + day.tokens, 0)
  const modelTotals = recentRuns.reduce((totals, run) => {
    const model = String(run.model || '未标注模型')
    totals[model] = (totals[model] || 0) + Number(run.tokens || 0)
    return totals
  }, {})
  const rankedModels = Object.entries(modelTotals)
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4)
  const localLeaderboard = [...runs].sort((a, b) => b.tokens - a.tokens).slice(0, 5)
  const boardSource = leaderboardSourceLabel(settings.leaderboardApiUrl)
  const geoApiUrl = settings.autoSelectRegion ? settings.geoApiUrl : ''
  const manualRegion = useMemo(
    () => settings.autoSelectRegion ? null : sanitizeManualRegion(settings.manualRegion),
    [settings.autoSelectRegion, settings.manualRegion],
  )

  useEffect(() => {
    let active = true
    setGlobalBoard((current) => ({ ...current, status: 'loading', error: '' }))
    getLeaderboard(settings.leaderboardApiUrl, boardPeriod, boardScope, boardPage, locale, geoApiUrl, manualRegion)
      .then((payload) => {
        if (active) {
          const pageCount = Math.max(1, Number(payload.pageCount) || 1)
          if (boardPage > pageCount) {
            setBoardPage(pageCount)
            return
          }
          setGlobalBoard({
            status: 'ready',
            entries: payload.entries || [],
            currentEntry: payload.currentEntry || null,
            context: payload.context || null,
            scope: payload.scope || 'global',
            page: Number(payload.page) || boardPage,
            pageCount,
            visibleLimit: Number(payload.visibleLimit) || 100,
            error: '',
          })
        }
      })
      .catch((error) => {
        if (active) {
          setGlobalBoard({
            status: 'error',
            entries: [],
            currentEntry: null,
            context: null,
            scope: 'global',
            page: 1,
            pageCount: 1,
            visibleLimit: 100,
            error: error.message,
          })
        }
      })
    return () => {
      active = false
    }
  }, [settings.leaderboardApiUrl, geoApiUrl, manualRegion, boardPeriod, boardScope, boardPage, boardRefresh, leaderboardVersion, locale])

  useEffect(() => {
    let active = true
    setRankProfile((current) => ({ ...current, status: 'loading', error: '' }))
    getLeaderboardProfile(settings.leaderboardApiUrl, locale, geoApiUrl, manualRegion)
      .then((data) => {
        if (active) setRankProfile({ status: 'ready', data, error: '' })
      })
      .catch((error) => {
        if (active) setRankProfile({ status: 'error', data: null, error: error.message })
      })
    return () => {
      active = false
    }
  }, [settings.leaderboardApiUrl, geoApiUrl, manualRegion, boardRefresh, leaderboardVersion, locale])

  const profileData = rankProfile.status === 'ready' ? rankProfile.data : null
  const achievements = useMemo(
    () => mergeCloudAchievements(localAchievements, profileData?.achievements),
    [localAchievements, profileData?.achievements],
  )
  const selectedAchievement = achievements.unlockedItems.find((item) => item.id === selectedAchievementId)
    || achievements.latest
  const currentTier = profileData?.tier || rankForTokens(totalTokens)
  const rankTokenTotal = profileData?.totalTokens ?? totalTokens
  const currentTierIndex = Math.max(0, RANK_TIERS.findIndex((tier) => tier.id === currentTier.id))
  const requestedTierIndex = viewedTierId ? RANK_TIERS.findIndex((tier) => tier.id === viewedTierId) : currentTierIndex
  const viewedTierIndex = requestedTierIndex >= 0 ? requestedTierIndex : currentTierIndex
  const viewedTier = RANK_TIERS[viewedTierIndex]
  const isViewingCurrentTier = viewedTier.id === currentTier.id
  const viewedTierUnlocked = rankTokenTotal >= viewedTier.min
  const viewedTierRemaining = Math.max(0, viewedTier.min - rankTokenTotal)
  const viewedTierProgress = isViewingCurrentTier
    ? currentTier.progress
    : viewedTierUnlocked
      ? 100
      : Math.min(100, Math.max(0, (rankTokenTotal / Math.max(1, viewedTier.min)) * 100))
  const scopeOptions = globalBoard.context?.scopes || profileData?.context?.scopes || [{ id: 'global', label: '全球' }]
  const rankScopes = profileData?.ranks || scopeOptions.map((scope) => ({
    ...scope,
    scope: scope.scope || scope.id,
    rank: null,
    tokens: 0,
  }))
  const globalRank = rankScopes.find((item) => item.scope === 'global')?.rank || null
  const rankDirectory = profileData?.context?.directory || globalBoard.context?.directory || []
  const rankGeoSource = profileData?.context?.source || globalBoard.context?.source || 'edge'
  const deploymentUrl = new URL('.', window.location.href).href.replace(/\/$/, '')
  const rankingPhrase = globalRank
    ? t(locale, `我位列全球第 ${globalRank} 名`, `I rank #${globalRank} worldwide`)
    : t(locale, '我正在冲击全球排行榜', 'I am climbing the global leaderboard')
  const currentEntryOnPage = globalBoard.entries.some((entry) => entry.isCurrent)
  const displayedBoardEntries = globalBoard.currentEntry && !currentEntryOnPage
    ? [{ ...globalBoard.currentEntry, pinned: true }, ...globalBoard.entries]
    : globalBoard.entries
  const shareText = shareStory === 'achievement' && selectedAchievement
    ? t(
      locale,
      `我在 Token Killer 解锁了“${selectedAchievement.title}”，累计消耗 ${formatTokens(totalTokens)} Token。你也快来【${deploymentUrl}】点亮自己的成就吧。`,
      `I unlocked "${selectedAchievement.titleEn}" in Token Killer after burning ${formatTokens(totalTokens)} tokens. Light up yours at ${deploymentUrl}.`,
    )
    : shareStory === 'rank'
      ? t(
        locale,
        `我在 Token Killer 达到 ${currentTier.fullName}，${rankingPhrase}，累计消耗 ${formatTokens(totalTokens)} Token。你也快来【${deploymentUrl}】挑战我的段位吧。`,
        `I reached ${translateText(locale, currentTier.fullName)} in Token Killer. ${rankingPhrase}, with ${formatTokens(totalTokens)} tokens burned. Challenge my rank at ${deploymentUrl}.`,
      )
      : t(
        locale,
        `我今天用 Token Killer 消耗了 ${formatTokens(todayTokens)} 个无意义 Token，累计 ${formatTokens(totalTokens)}。${rankingPhrase}，你也快来【${deploymentUrl}】浪费 Token 吧。`,
        `I burned ${formatTokens(todayTokens)} pointless tokens with Token Killer today, ${formatTokens(totalTokens)} in total. ${rankingPhrase}. Come waste yours at ${deploymentUrl}.`,
      )
  const shareToX = () => {
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer')
  }
  const copyShare = async () => {
    await navigator.clipboard.writeText(shareText)
  }

  return (
    <Localized>
      <div className="panel-page stats-page">
      <header className="page-header">
        <div>
          <span className="page-kicker">统计与排行</span>
          <h1>每一个 token 都有记录。</h1>
          <p>查看消耗趋势、运行记录与全网排行。</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => exportShareCard({
            story: shareStory,
            todayTokens,
            totalTokens,
            totalCost,
            participantLabel,
            globalRank,
            tier: currentTier,
            locale,
            activity,
            achievement: selectedAchievement,
            achievements,
          })}
        >
          <DownloadSimple size={18} />
          导出分享卡
        </button>
      </header>

      <div className="metrics-grid">
        <Metric label="今日消耗" value={formatTokens(todayTokens)} detail={`${todayRuns.length} 次运行`} icon={Fire} />
        <Metric label="累计消耗" value={formatTokens(totalTokens)} detail={`${runs.length} 次运行`} icon={Database} />
        <Metric label="估算成本" value={formatMoney(totalCost)} detail="按运行时价格" icon={ChartBar} />
        <Metric label="请求轮数" value={formatTokens(totalRounds)} detail="顺序执行" icon={ListChecks} />
      </div>

      <section className={`rank-overview section-block rank-${currentTier.id}`}>
        <div className="rank-identity">
          <div className="rank-crest-controls">
            <button
              type="button"
              aria-label="查看上一段位"
              disabled={viewedTierIndex === 0}
              onClick={() => setViewedTierId(RANK_TIERS[viewedTierIndex - 1].id)}
            >
              <CaretLeft size={16} weight="bold" />
            </button>
            <div className="rank-crest">
              <RankIcon tier={viewedTier} eager />
            </div>
            <button
              type="button"
              aria-label="查看下一段位"
              disabled={viewedTierIndex === RANK_TIERS.length - 1}
              onClick={() => setViewedTierId(RANK_TIERS[viewedTierIndex + 1].id)}
            >
              <CaretRight size={16} weight="bold" />
            </button>
          </div>
          <div className="rank-summary">
            <span>{isViewingCurrentTier ? '当前段位' : '查看段位'}</span>
            <h2>{isViewingCurrentTier && !currentTier.infiniteStars ? currentTier.fullName : viewedTier.name}</h2>
            {isViewingCurrentTier ? (
              <div
                className={`rank-stars ${currentTier.infiniteStars ? 'infinite' : ''}`}
                aria-label={currentTier.infiniteStars ? `${currentTier.name} ${currentTier.stars}` : `${currentTier.stars} 星，共 ${currentTier.maxStars} 星`}
              >
                {currentTier.infiniteStars ? (
                  <><Star className="filled" size={17} weight="fill" /><strong>{currentTier.stars}</strong></>
                ) : Array.from({ length: currentTier.maxStars }, (_, index) => (
                  <Star className={index < currentTier.stars ? 'filled' : ''} key={index} size={17} weight={index < currentTier.stars ? 'fill' : 'regular'} />
                ))}
              </div>
            ) : null}
            <div className="rank-requirement">
              <span>{isViewingCurrentTier && currentTier.infiniteStars ? '本星门槛' : '晋级门槛'}</span>
              <b>
                {isViewingCurrentTier && currentTier.infiniteStars
                  ? `${formatTokens(currentTier.threshold)} Token`
                  : viewedTier.min
                    ? `${formatTokens(viewedTier.min)} Token`
                    : '起始段位'}
              </b>
            </div>
            <div className="rank-progress" aria-hidden="true"><i style={{ width: `${viewedTierProgress}%` }} /></div>
            <small>
              {isViewingCurrentTier
                ? currentTier.nextName
                  ? `距离 ${currentTier.nextName} 还差 ${formatTokens(currentTier.tokensToNext)} Token`
                  : '已经抵达最高段位'
                : viewedTierUnlocked
                  ? `已达到 ${viewedTier.name}，当前累计 ${formatTokens(rankTokenTotal)} Token`
                  : `距离 ${viewedTier.name} 还差 ${formatTokens(viewedTierRemaining)} Token`}
            </small>
          </div>
        </div>

        <div className="rank-regions">
          <div className="rank-region-head">
            <div><MapPin size={18} /><span>当前赛区</span></div>
            <strong>
              <span>{rankDirectory.length ? rankDirectory.join(' / ') : '等待地区榜'}</span>
              {rankDirectory.length && rankGeoSource === 'geo-service' ? <small>地区服务识别</small> : null}
              {rankDirectory.length && rankGeoSource === 'manual' ? <small>手动选择</small> : null}
            </strong>
          </div>
          <div className="rank-scope-grid">
            {rankScopes.map((item) => (
              <div key={item.scope}>
                <span>{item.label}</span>
                <strong>{item.rank ? `第 ${item.rank} 名` : '未上榜'}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="rank-ladder">
          <div className="rank-ladder-head">
            <div>
              <span>段位图鉴</span>
              <strong>
                {viewedTier.max
                  ? `${viewedTier.name}：${formatTokens(viewedTier.min)} 至 ${formatTokens(viewedTier.max)} Token`
                  : `${viewedTier.name}：${formatTokens(viewedTier.min)} Token 起，每 ${formatTokens(viewedTier.starStep)} Token 增加 1 星`}
              </strong>
            </div>
            {!isViewingCurrentTier ? (
              <button type="button" onClick={() => setViewedTierId('')}>返回当前段位</button>
            ) : null}
          </div>
          <div className="rank-ladder-track" role="group" aria-label="全部段位">
            {RANK_TIERS.map((tier) => (
              <button
                className={`${tier.id === viewedTier.id ? 'active' : ''} ${tier.id === currentTier.id ? 'current' : ''}`}
                key={tier.id}
                type="button"
                aria-pressed={tier.id === viewedTier.id}
                onClick={() => setViewedTierId(tier.id === currentTier.id ? '' : tier.id)}
              >
                <RankIcon tier={tier} decorative />
                <span>{tier.name}</span>
                <small>
                  {tier.id === currentTier.id
                    ? currentTier.infiniteStars
                      ? `当前 ${currentTier.stars} 星`
                      : `当前，门槛 ${formatTokens(tier.min)}`
                    : tier.max === null
                      ? `${formatTokens(tier.min)} 起 / ${formatTokens(tier.starStep)} 一星`
                    : tier.min
                      ? `需 ${formatTokens(tier.min)}`
                      : '起始段位'}
                </small>
              </button>
            ))}
          </div>
        </div>
      </section>

      <AchievementGallery
        achievements={achievements}
        locale={locale}
        selectedId={selectedAchievement?.id || ''}
        onSelect={(achievementId) => {
          setSelectedAchievementId(achievementId)
          setShareStory('achievement')
        }}
      />

      <div className="stats-layout">
        <section className="chart-section section-block">
          <div className="activity-heading">
            <div>
              <h2>Token 活动</h2>
              <p>过去一年按 usage 回执记录的消耗强度。</p>
            </div>
            <div className="activity-tabs" role="group" aria-label="Token 活动统计周期">
              {[
                ['day', '每日'],
                ['week', '每周'],
                ['total', '累计'],
              ].map(([value, label]) => (
                <button
                  className={activityMode === value ? 'active' : ''}
                  key={value}
                  type="button"
                  aria-pressed={activityMode === value}
                  onClick={() => setActivityMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ActivityMatrix activity={activity} mode={activityMode} locale={locale} />

          <div className="activity-summary">
            <div>
              <span>{activityMode === 'day' ? '今日' : activityMode === 'week' ? '本周' : '累计'}</span>
              <strong>
                {formatTokens(
                  activityMode === 'day'
                    ? activity.today.tokens
                    : activityMode === 'week'
                      ? activity.currentWeek.tokens
                      : activity.allTimeTokens,
                )}
              </strong>
            </div>
            <div><span>活跃天数</span><strong>{activity.activeDays}</strong></div>
            <div><span>当前连续</span><strong>{formatDayCount(activity.currentStreak)}</strong></div>
            <div><span>最长连续</span><strong>{formatDayCount(activity.longestStreak)}</strong></div>
          </div>

          {rankedModels.length ? (
            <div className="activity-models">
              <div className="activity-models-head">
                <strong>近 7 天模型份额</strong>
                <span>{formatTokens(recentTokens)} Token</span>
              </div>
              <ol className="model-ranking-list" aria-label="模型 Token 排行">
              {rankedModels.map((item, index) => (
                <li key={item.model}>
                  <span className="model-rank">{String(index + 1).padStart(2, '0')}</span>
                  <i className={`model-swatch tone-${index}`} />
                  <div>
                    <strong>{item.model}</strong>
                    <small>{recentTokens ? `${((item.tokens / recentTokens) * 100).toFixed(1)}% 份额` : '0% 份额'}</small>
                  </div>
                  <b>{formatTokens(item.tokens)}</b>
                </li>
              ))}
              </ol>
            </div>
          ) : (
            <div className="model-ranking-empty">
              <ChartBar size={24} />
              <span>完成运行后，这里会生成模型趋势与排行。</span>
            </div>
          )}
        </section>

        <section className="share-card-section">
          <div className="share-story-tabs" role="group" aria-label={t(locale, '分享故事', 'Share story')}>
            {[
              ['activity', t(locale, '活动', 'Activity')],
              ['rank', t(locale, '段位', 'Rank')],
              ['achievement', t(locale, '成就', 'Achievement')],
            ].map(([value, label]) => (
              <button
                className={shareStory === value ? 'active' : ''}
                key={value}
                type="button"
                disabled={value === 'achievement' && !selectedAchievement}
                aria-pressed={shareStory === value}
                onClick={() => setShareStory(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <ShareStoryCard
            story={shareStory}
            activity={activity}
            todayTokens={todayTokens}
            totalTokens={totalTokens}
            totalCost={totalCost}
            globalRank={globalRank}
            tier={currentTier}
            participantLabel={participantLabel}
            achievement={selectedAchievement}
            achievements={achievements}
            locale={locale}
          />
          <div className="share-actions">
            <button type="button" onClick={shareToX}>
              <XLogo size={18} />
              分享到 X
            </button>
            <button type="button" onClick={copyShare} aria-label="复制分享文案">
              <Copy size={18} />
            </button>
          </div>
        </section>
      </div>

      <div className="lower-stats-grid">
        <section className="history-section section-block">
          <div className="section-heading">
            <div>
              <h2>运行记录</h2>
              <p>展示最近 500 次运行。</p>
            </div>
          </div>
          {runs.length ? (
            <div className="run-table">
              {runs.slice(0, 8).map((run) => (
                <div className="run-row" key={run.id}>
                  <div>
                    <strong>{run.model}</strong>
                    <span>{new Date(run.startedAt).toLocaleString(localeTag(locale))}{run.pricing?.matchedModel ? ` · ${run.pricing.matchedModel}` : ''}</span>
                  </div>
                  <div>
                    <strong>{formatTokens(run.tokens)}</strong>
                    <span>{run.verified ? '已核验' : '含估算'}</span>
                  </div>
                  <div>
                    <strong>{formatMoney(run.cost)}</strong>
                    <span title={run.pricing?.source || ''}>{formatDuration(run.duration)}{run.pricing?.source ? ` · ${run.pricing.source}` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <ChartBar size={28} />
              <strong>还没有运行记录</strong>
              <p>完成一次消耗后，统计会自动出现在这里。</p>
            </div>
          )}
        </section>

        <section className="leaderboard-section section-block">
          <div className="section-heading">
            <div>
              <h2>{globalBoard.status === 'error' ? '个人排行' : '排行榜'}</h2>
              <p className="leaderboard-source">数据来源 <strong>{boardSource}</strong></p>
            </div>
            <button className="icon-button" type="button" aria-label="刷新排行榜" onClick={() => setBoardRefresh((value) => value + 1)}>
              <ArrowClockwise size={16} />
            </button>
          </div>
          {globalBoard.status !== 'error' ? (
            <div className="leaderboard-filters">
              {scopeOptions.length > 1 ? (
                <div className="leaderboard-scope">
                  <Segmented
                    label="排行榜地区"
                    value={boardScope}
                    options={scopeOptions.map((scope) => ({ value: scope.id, label: scope.label }))}
                    onChange={(value) => {
                      setBoardScope(value)
                      setBoardPage(1)
                    }}
                  />
                </div>
              ) : null}
              <Segmented
                label="排行榜周期"
                value={boardPeriod}
                options={[{ value: 'day', label: '今日' }, { value: 'all', label: '总榜' }]}
                onChange={(value) => {
                  setBoardPeriod(value)
                  setBoardPage(1)
                }}
              />
            </div>
          ) : null}
          {globalBoard.status === 'loading' ? (
            <div className="empty-state small">
              <ArrowClockwise className="spin" size={24} />
              <strong>正在同步排行榜</strong>
            </div>
          ) : null}
          {globalBoard.status === 'ready' && displayedBoardEntries.length ? (
            <ol className="leaderboard">
              {displayedBoardEntries.map((entry) => (
                <li
                  className={`${entry.isCurrent ? 'is-current' : ''}${entry.pinned ? ' is-pinned' : ''}`}
                  key={`${boardPeriod}-${boardScope}-${entry.pinned ? 'pinned' : 'ranked'}-${entry.rank}-${entry.participantLabel || ''}`}
                >
                  <span>{String(entry.rank).padStart(2, '0')}</span>
                  <div className="leaderboard-person">
                    <strong>{participantLabelFromEntry(entry.participantLabel, entry.rank)}</strong>
                    <small>{entry.pinned ? '我的排名 · ' : ''}{entry.tier?.fullName || rankForTokens(entry.tokens).fullName}，{entry.runs} 次运行</small>
                  </div>
                  <div className="leaderboard-entry-stats">
                    <span><small>Token</small><b>{formatTokens(entry.tokens)}</b></span>
                    <span><small>轮数</small><b>{formatTokens(entry.rounds)}</b></span>
                    <span><small>消费</small><b>{formatMoney(entry.cost)}</b></span>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          {globalBoard.status === 'ready' && globalBoard.pageCount > 1 ? (
            <div className="leaderboard-pagination" aria-label="排行榜翻页">
              <button type="button" disabled={boardPage <= 1} onClick={() => setBoardPage((page) => Math.max(1, page - 1))}>
                <CaretLeft size={14} />
                上一页
              </button>
              <span>第 <strong>{globalBoard.page}</strong> / {globalBoard.pageCount} 页</span>
              <button type="button" disabled={boardPage >= globalBoard.pageCount} onClick={() => setBoardPage((page) => Math.min(globalBoard.pageCount, page + 1))}>
                下一页
                <CaretRight size={14} />
              </button>
              <small>仅展示前 {globalBoard.visibleLimit} 位</small>
            </div>
          ) : null}
          {globalBoard.status === 'ready' && !globalBoard.entries.length ? (
            <div className="empty-state small">
              <Fire size={26} />
              <strong>还没人上榜，第一把火留给你</strong>
            </div>
          ) : null}
          {globalBoard.status === 'error' && localLeaderboard.length ? (
            <ol className="leaderboard">
              {localLeaderboard.map((run, index) => (
                <li key={run.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div className="leaderboard-person"><strong>{run.model}</strong><small>{run.date}</small></div>
                  <div className="leaderboard-entry-stats">
                    <span><small>Token</small><b>{formatTokens(run.tokens)}</b></span>
                    <span><small>轮数</small><b>{formatTokens(run.rounds)}</b></span>
                    <span><small>消费</small><b>{formatMoney(run.cost)}</b></span>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          {globalBoard.status === 'error' && !localLeaderboard.length ? (
            <div className="empty-state small"><Fire size={26} /><strong>榜单还空着</strong></div>
          ) : null}
          <div className="constraint-note">
            <Info size={17} />
            <span>
              {globalBoard.status === 'error'
                ? `${globalBoard.error || '排行榜不可用'}。可在配置中填写排行榜服务地址。`
                : '排行榜最多展示前 100 位，只收录每轮都包含 usage 的完整运行。'}
            </span>
          </div>
        </section>
      </div>
      </div>
    </Localized>
  )
}

function SubscriptionAccountManager({ settings, updateSettings, accountsState, reloadAccounts, compact = false }) {
  const locale = useLocale()
  const serviceStatusId = useId()
  const [login, setLogin] = useState({ status: 'idle', provider: '', error: '', callbackValue: '' })
  const [serviceState, setServiceState] = useState({ status: 'idle', providers: EMPTY_SUBSCRIPTION_PROVIDERS, error: '' })
  const [geminiProjectId, setGeminiProjectId] = useState('')
  const [deletingId, setDeletingId] = useState('')

  useEffect(() => {
    setServiceState({ status: 'idle', providers: EMPTY_SUBSCRIPTION_PROVIDERS, error: '' })
    setLogin({ status: 'idle', provider: '', error: '', callbackValue: '' })
  }, [settings.subscriptionApiUrl])

  useEffect(() => {
    if (login.status !== 'waiting_device' || login.provider !== 'openai') return undefined
    let cancelled = false
    let timer

    const poll = async () => {
      try {
        const result = await pollChatGPTDeviceLogin(settings.subscriptionApiUrl, login)
        if (cancelled) return
        if (result.status === 'complete') {
          setLogin((current) => ({ ...current, status: 'complete', account: result.account, error: '' }))
          updateSettings({ provider: 'chatgpt', targetMode: 'tokens', selectedAccountId: result.account.id })
          await reloadAccounts()
          return
        }
        timer = window.setTimeout(poll, Math.max(2, Number(result.intervalSeconds || login.intervalSeconds || 5)) * 1000)
      } catch (error) {
        if (!cancelled) setLogin((current) => ({ ...current, status: 'error', error: error.message }))
      }
    }

    timer = window.setTimeout(poll, Math.max(2, Number(login.intervalSeconds || 5)) * 1000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [login, settings.subscriptionApiUrl, updateSettings, reloadAccounts])

  const checkService = async () => {
    setServiceState({ status: 'checking', providers: EMPTY_SUBSCRIPTION_PROVIDERS, error: '' })
    try {
      const result = await checkSubscriptionService(settings.subscriptionApiUrl)
      setServiceState({ status: 'ready', providers: result.providers, error: '' })
      setLogin({ status: 'idle', provider: '', error: '', callbackValue: '' })
    } catch (error) {
      setServiceState({ status: 'error', providers: EMPTY_SUBSCRIPTION_PROVIDERS, error: error.message })
    }
  }

  const startLogin = async (provider) => {
    if (serviceState.status !== 'ready' || !serviceState.providers[provider]) return
    setLogin({ status: 'starting', provider, error: '', callbackValue: '' })
    try {
      if (provider === 'openai') {
        const result = await startChatGPTDeviceLogin(settings.subscriptionApiUrl)
        setLogin({ ...result, status: 'waiting_device', error: '', callbackValue: '' })
        window.open(result.verificationUrl, '_blank', 'noopener,noreferrer')
        return
      }
      const result = provider === 'claude'
        ? await startClaudeLogin()
        : provider === 'gemini'
          ? await startGeminiLogin(settings.subscriptionApiUrl, geminiProjectId)
          : await startGrokLogin()
      setLogin({ ...result, status: 'waiting_callback', error: '', callbackValue: '' })
      window.open(result.authorizationUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setLogin({ status: 'error', provider, error: error.message, callbackValue: '' })
    }
  }

  const finishLogin = async () => {
    setLogin((current) => ({ ...current, status: 'exchanging', error: '' }))
    try {
      const account = login.provider === 'claude'
        ? await finishClaudeLogin(settings.subscriptionApiUrl, login, login.callbackValue)
        : login.provider === 'gemini'
          ? await finishGeminiLogin(settings.subscriptionApiUrl, login, login.callbackValue)
          : await finishGrokLogin(settings.subscriptionApiUrl, login, login.callbackValue)
      const provider = ACCOUNT_PROVIDER_TO_SETTINGS[account.provider]
      setLogin((current) => ({ ...current, status: 'complete', account, error: '' }))
      updateSettings({ provider, targetMode: 'tokens', selectedAccountId: account.id, model: PROVIDERS[provider].model })
      await reloadAccounts()
    } catch (error) {
      setLogin((current) => ({ ...current, status: 'waiting_callback', error: error.message }))
    }
  }

  const removeAccount = async (account) => {
    if (!window.confirm(t(
      locale,
      `断开 ${account.displayName}？已保存的登录信息会被移除。`,
      `Disconnect ${account.displayName}? Its saved login data will be removed.`,
    ))) return
    setDeletingId(account.id)
    try {
      await deleteSubscriptionAccount(settings.subscriptionApiUrl, account.id)
      if (settings.selectedAccountId === account.id) updateSettings({ selectedAccountId: '' })
      await reloadAccounts()
    } catch (error) {
      setLogin((current) => ({ ...current, status: 'error', error: error.message }))
    } finally {
      setDeletingId('')
    }
  }

  const accounts = accountsState.accounts || []
  const loginBusy = ['starting', 'waiting_device', 'waiting_callback', 'exchanging'].includes(login.status)
  const unavailableTitle = serviceState.status === 'ready' ? '当前授权服务未启用此平台' : '请先检测 OAuth 授权服务'
  const availableProviderLabels = [
    ['openai', 'ChatGPT'],
    ['claude', 'Claude'],
    ['gemini', 'Gemini'],
    ['grok', 'Grok'],
  ].filter(([provider]) => serviceState.providers[provider]).map(([, label]) => label)
  const providerList = availableProviderLabels.join(locale === 'en' ? ', ' : '、')
  const serviceMessage = serviceState.status === 'checking'
    ? '正在检测 OAuth 授权服务'
    : serviceState.status === 'ready'
      ? `授权服务正常，可连接 ${providerList}`
      : serviceState.status === 'error'
        ? `连接失败：${serviceState.error}`
        : '尚未检测，授权入口暂不可用'
  return (
    <Localized>
      <div className={`account-manager ${compact ? 'compact' : ''}`}>
      <div className="form-grid account-worker-field">
        <Field label="OAuth 授权服务" hint="同域部署可留空；分开部署时填写 Worker 地址。" className="span-2">
          <div className="oauth-service-field">
            <input type="url" value={settings.subscriptionApiUrl} spellCheck="false" onChange={(event) => updateSettings({ subscriptionApiUrl: event.target.value })} placeholder="同域 /api" />
            <button className="secondary-button oauth-service-check" type="button" onClick={checkService} disabled={serviceState.status === 'checking'}>
              <ArrowClockwise className={serviceState.status === 'checking' ? 'spin' : ''} size={16} />
              {serviceState.status === 'checking' ? '检测中' : '检测服务'}
            </button>
          </div>
          <div className={`oauth-service-status ${serviceState.status}`} id={serviceStatusId} aria-live="polite">
            {serviceState.status === 'ready' ? <Check size={15} weight="bold" /> : <Info size={15} />}
            <span>{serviceMessage}</span>
          </div>
        </Field>
      </div>

      <div className="oauth-relay-notice">
        <Info size={18} />
        <div>
          <strong>请求会经过转发服务</strong>
          <p>消费版账号的 OAuth 授权、凭据刷新和模型请求会经过你配置的 Worker/VPS 转发。转发服务会在请求期间处理访问凭据、Prompt 与模型响应，但不会将这些内容写入排行榜。</p>
        </div>
      </div>

      <div className="subscription-callout oauth-callout">
        <div>
          <span className="status-pill">SUBSCRIPTION LOGIN</span>
          <strong>连接你自己的消费版订阅</strong>
          <p>选择平台完成登录，连接后可使用订阅模型。</p>
        </div>
        <div className="oauth-provider-actions" aria-describedby={serviceStatusId}>
          <button className="secondary-button" type="button" title={!serviceState.providers.openai ? unavailableTitle : ''} disabled={loginBusy || !serviceState.providers.openai} onClick={() => startLogin('openai')}>ChatGPT</button>
          <button className="secondary-button" type="button" title={!serviceState.providers.claude ? unavailableTitle : ''} disabled={loginBusy || !serviceState.providers.claude} onClick={() => startLogin('claude')}>Claude</button>
          <button className="secondary-button" type="button" title={!serviceState.providers.gemini ? unavailableTitle : ''} disabled={loginBusy || !serviceState.providers.gemini} onClick={() => startLogin('gemini')}>Gemini</button>
          <button className="secondary-button" type="button" title={!serviceState.providers.grok ? unavailableTitle : ''} disabled={loginBusy || !serviceState.providers.grok} onClick={() => startLogin('grok')}>Grok</button>
        </div>
      </div>

      <div className="form-grid oauth-project-field">
        <Field label="Gemini Project ID（可选）" hint="Code Assist 未自动返回 project 时填写后重新授权。" className="span-2">
          <input value={geminiProjectId} spellCheck="false" onChange={(event) => setGeminiProjectId(event.target.value)} placeholder="your-google-cloud-project" />
        </Field>
      </div>

      {login.status === 'waiting_device' ? (
        <div className="device-login-card" aria-live="polite">
          <div>
            <span>在 OpenAI 页面输入设备码</span>
            <strong>{login.userCode}</strong>
            <small>完成授权后本页会自动检测并保存账号。</small>
          </div>
          <div className="device-login-actions">
            <button className="text-button" type="button" onClick={() => navigator.clipboard.writeText(login.userCode)}><Copy size={16} />复制代码</button>
            <a className="secondary-button" href={login.verificationUrl} target="_blank" rel="noreferrer">打开登录页</a>
          </div>
        </div>
      ) : null}
      {login.status === 'waiting_callback' || login.status === 'exchanging' ? (
        <div className="callback-login-card" aria-live="polite">
          <div>
            <span>{login.provider === 'grok' ? '授权结束后复制地址栏中的完整回调地址' : '完成授权后复制页面显示的授权码或地址'}</span>
            <strong>{login.provider === 'claude' ? 'Claude 回调码' : login.provider === 'gemini' ? 'Gemini 授权码' : 'Grok 回调 URL'}</strong>
            <small>请保持此页面打开，完成后粘贴返回内容。</small>
          </div>
          <textarea
            rows="3"
            value={login.callbackValue}
            spellCheck="false"
            onChange={(event) => setLogin((current) => ({ ...current, callbackValue: event.target.value }))}
            placeholder="粘贴授权码或完整回调 URL"
          />
          <div className="device-login-actions">
            <a className="text-button" href={login.authorizationUrl} target="_blank" rel="noreferrer">重新打开授权页</a>
            <button className="secondary-button" type="button" disabled={!login.callbackValue.trim() || login.status === 'exchanging'} onClick={finishLogin}>
              {login.status === 'exchanging' ? '正在换取凭据…' : '完成连接'}
            </button>
          </div>
        </div>
      ) : null}
      {login.status === 'complete' ? <div className="inline-success"><Check size={17} weight="bold" />已连接 {login.account?.displayName}</div> : null}
      {login.error ? <div className="inline-error">{login.error}</div> : null}

      <div className="account-list-head">
        <span>已连接账号</span>
        <button className="text-button" type="button" onClick={reloadAccounts} disabled={accountsState.status === 'loading'}>
          <ArrowClockwise size={15} />刷新
        </button>
      </div>
      {accounts.length ? (
        <div className="account-list">
          {accounts.map((account) => (
            <div className={settings.selectedAccountId === account.id ? 'selected' : ''} key={account.id}>
              <button className="account-select" type="button" onClick={() => {
                const provider = ACCOUNT_PROVIDER_TO_SETTINGS[account.provider]
                updateSettings({ provider, targetMode: 'tokens', selectedAccountId: account.id, model: settings.provider === provider ? settings.model : PROVIDERS[provider].model })
              }}>
                <span className="account-provider-mark">{account.provider.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{account.displayName}</strong>
                  <small>{subscriptionPlanLabel(account.provider, account.planType)} · 自动续期</small>
                </span>
                {settings.selectedAccountId === account.id ? <Check size={18} weight="bold" /> : null}
              </button>
              <button className="account-delete" type="button" aria-label={`断开 ${account.displayName}`} disabled={deletingId === account.id} onClick={() => removeAccount(account)}><Trash size={17} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="account-empty">{accountsState.status === 'loading' ? '正在读取账号…' : accountsState.error || '尚未连接消费版账号'}</div>
      )}
      <div className="constraint-note">
        <Info size={17} />
        <span>凭据不会出现在排行榜或分享内容中。清除站点数据会同时移除已连接账号。</span>
      </div>
      </div>
    </Localized>
  )
}

function SettingsPanel({
  settings,
  updateSettings,
  onLocaleChange,
  models,
  availableModels,
  modelListState,
  refreshAvailableModels,
  catalogState,
  refreshCatalog,
  runs,
  onClear,
  accountsState,
  reloadAccounts,
  participantLabel,
  providerBlocklist,
  onUnblockProvider,
  onClearProviderBlocklist,
}) {
  const locale = useLocale()
  const geoStatusId = useId()
  const [geoServiceState, setGeoServiceState] = useState({ status: 'idle', located: false, context: null, error: '' })
  const [manualRegionCatalog, setManualRegionCatalog] = useState({ status: 'idle', options: [], error: '' })
  const [manualCityCatalog, setManualCityCatalog] = useState({ status: 'idle', options: [], error: '' })
  const manualRegion = sanitizeManualRegion(settings.manualRegion)
  const manualCountryCode = manualRegion.countryCode
  const manualRegionCode = manualRegion.regionCode
  const manualRegionName = manualRegion.regionName
  const manualCityName = manualRegion.cityName
  const manualCountryOptions = useMemo(() => countryOptions(locale), [locale])
  const manualRegionIsProvinceOnly = manualCountryCode === 'CN' && ['HK', 'MO'].includes(manualRegionCode)
  const manualRegionRequired = manualRegionCatalog.options.length > 0

  useEffect(() => {
    setGeoServiceState({ status: 'idle', located: false, context: null, error: '' })
  }, [settings.autoSelectRegion, settings.geoApiUrl])

  useEffect(() => {
    let active = true
    const countryCode = manualCountryCode
    setManualCityCatalog({ status: 'idle', options: [], error: '' })
    if (!countryCode) {
      setManualRegionCatalog({ status: 'ready', options: [], error: '' })
      return () => {
        active = false
      }
    }

    setManualRegionCatalog({ status: 'loading', options: [], error: '' })
    loadRegionOptions(countryCode, locale)
      .then((options) => {
        if (!active) return
        setManualRegionCatalog({ status: 'ready', options, error: '' })
        if (manualRegionCode && !options.some((option) => option.value === manualRegionCode)) {
          updateSettings({
            manualRegion: sanitizeManualRegion({
              countryCode,
              regionCode: '',
              regionName: '',
              cityName: '',
            }),
          })
        }
      })
      .catch(() => {
        if (!active) return
        setManualRegionCatalog({ status: 'error', options: [], error: '一级行政区目录加载失败' })
      })

    return () => {
      active = false
    }
  }, [manualCountryCode, manualRegionCode, updateSettings, locale])

  useEffect(() => {
    let active = true
    const countryCode = manualCountryCode
    const regionCode = manualRegionCode
    if (
      !countryCode ||
      manualRegionIsProvinceOnly ||
      manualRegionCatalog.status !== 'ready' ||
      (manualRegionRequired && !regionCode)
    ) {
      setManualCityCatalog({ status: 'ready', options: [], error: '' })
      return () => {
        active = false
      }
    }

    setManualCityCatalog({ status: 'loading', options: [], error: '' })
    loadCityOptions(countryCode, regionCode)
      .then((options) => {
        if (!active) return
        setManualCityCatalog({ status: 'ready', options, error: '' })
      })
      .catch(() => {
        if (!active) return
        setManualCityCatalog({ status: 'error', options: [], error: '城市目录加载失败' })
      })

    return () => {
      active = false
    }
  }, [
    manualCountryCode,
    manualRegionCode,
    manualRegionCatalog.status,
    manualRegionRequired,
    manualRegionIsProvinceOnly,
  ])

  useEffect(() => {
    if (
      manualCityCatalog.status !== 'ready' ||
      !manualCityName ||
      manualCityCatalog.options.some((option) => option.value === manualCityName)
    ) return

    updateSettings({
      manualRegion: sanitizeManualRegion({
        countryCode: manualCountryCode,
        regionCode: manualRegionCode,
        regionName: manualRegionName,
        cityName: '',
      }),
    })
  }, [
    manualCityCatalog.options,
    manualCityCatalog.status,
    manualCityName,
    manualCountryCode,
    manualRegionCode,
    manualRegionName,
    updateSettings,
  ])

  const handleGeoServiceCheck = async () => {
    if (!settings.autoSelectRegion) return
    setGeoServiceState({ status: 'checking', located: false, context: null, error: '' })
    const result = await checkGeoService(settings.geoApiUrl, locale)
    setGeoServiceState({
      status: result.reachable ? 'ready' : 'error',
      located: result.located,
      context: result.context,
      error: result.error || '',
    })
  }

  const geoDirectory = geoServiceState.context?.directory || []
  const geoServiceMessage = geoServiceState.status === 'checking'
    ? '正在探测当前赛区'
    : geoServiceState.status === 'ready' && geoServiceState.located
      ? `探测成功，当前网络出口识别为 ${geoDirectory.join(' / ') || '未知地区'}`
      : geoServiceState.status === 'ready'
        ? '服务正常，但未识别到网络出口地区；排行榜将使用节点定位'
        : geoServiceState.status === 'error'
          ? `探测失败：${geoServiceState.error}`
          : '开启后可检测服务识别到的网络出口地区'
  const updateManualRegion = (patch) => updateSettings({
    manualRegion: sanitizeManualRegion({ ...manualRegion, ...patch }),
  })

  return (
    <Localized>
      <div className="panel-page settings-page">
      <header className="page-header">
        <div>
          <span className="page-kicker">配置</span>
          <h1>凭证归你掌控。</h1>
          <p>设置请求、账号与消耗策略。</p>
        </div>
      </header>

      <section className="settings-section section-block">
        <div className="settings-section-title">
          <Key size={22} />
          <div>
            <h2>请求格式与鉴权</h2>
            <p>选择请求协议，填写兼容地址和凭据。</p>
          </div>
        </div>
        <ProviderFields
          settings={settings}
          updateSettings={updateSettings}
          models={models}
          availableModels={availableModels}
          modelListState={modelListState}
          refreshAvailableModels={refreshAvailableModels}
          accounts={accountsState.accounts}
        />
        <div className="catalog-line">
          <span className={`catalog-status ${catalogState}`}>{catalogState === 'ready' ? 'OpenRouter 价格目录已更新' : catalogState === 'error' ? 'OpenRouter 价格目录不可用' : '正在更新 OpenRouter 价格目录'}</span>
          <button className="text-button" type="button" onClick={refreshCatalog}>
            <ArrowClockwise size={16} />
            刷新价格
          </button>
        </div>
      </section>

      <section className="settings-section section-block subscription-section">
        <div className="settings-section-title">
          <ShieldCheck size={22} />
          <div>
            <h2>消费版订阅账号</h2>
            <p>支持 ChatGPT、Claude、Gemini 与 Grok 账号登录。</p>
          </div>
        </div>
        <SubscriptionAccountManager settings={settings} updateSettings={updateSettings} accountsState={accountsState} reloadAccounts={reloadAccounts} />
      </section>

      <section className="settings-section section-block">
        <div className="settings-section-title provider-blocklist-title">
          <ShieldCheck size={22} />
          <div>
            <h2>已屏蔽的 Provider</h2>
            <p>明确拒绝 Token Killer 请求的服务会在此停用。</p>
          </div>
          {providerBlocklist.length ? (
            <button className="text-button" type="button" onClick={onClearProviderBlocklist}>
              全部解除
            </button>
          ) : null}
        </div>
        {providerBlocklist.length ? (
          <div className="provider-blocklist">
            {providerBlocklist.map((record) => (
              <div className="provider-block-row" key={record.key}>
                <div>
                  <strong>{PROVIDERS[record.provider]?.label || record.provider}</strong>
                  <code>{record.endpoint}</code>
                  <small>
                    {record.reasonCode || '未提供错误码'}
                    {record.status ? ` · HTTP ${record.status}` : ''}
                    {' · '}
                    {new Date(record.blockedAt).toLocaleString(localeTag(locale))}
                  </small>
                </div>
                <button className="secondary-button" type="button" onClick={() => onUnblockProvider(record.key)}>
                  解除屏蔽
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="provider-blocklist-empty">暂无被停用的 Provider。</div>
        )}
      </section>

      <section className="settings-section section-block">
        <div className="settings-section-title">
          <SlidersHorizontal size={22} />
          <div>
            <h2>请求策略</h2>
            <p>顺序执行，避免多个在途请求同时越过预算。</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="单轮最大输出" hint={isSubscriptionProvider(settings.provider) ? '订阅接口会尽可能使用该上限；ChatGPT Codex 仍属于提示级软限制。' : '越小越接近目标，但输入 token 和请求次数会更多。'}>
            <input type="number" min="1" max="65536" value={settings.batchSize} onChange={(event) => updateSettings({ batchSize: event.target.value })} />
          </Field>
          <Field label="请求超时" hint="超时后不会自动重试；0 表示不限时。">
            <div className="input-with-unit">
              <input type="number" min="0" max="3600" value={settings.requestTimeoutSeconds} onChange={(event) => updateSettings({ requestTimeoutSeconds: event.target.value })} />
              <span>秒</span>
            </div>
          </Field>
          <Field label="最多轮数" hint="达到限制后保留已完成统计；0 表示不限。">
            <input type="number" min="0" max="100000" value={settings.maxRounds} onChange={(event) => updateSettings({ maxRounds: event.target.value })} />
          </Field>
          <Field label="最长运行" hint="仅在两轮之间检查；0 表示不限。">
            <div className="input-with-unit">
              <input type="number" min="0" max="10080" value={settings.maxDurationMinutes} onChange={(event) => updateSettings({ maxDurationMinutes: event.target.value })} />
              <span>分钟</span>
            </div>
          </Field>
          <Field label="离开页面时">
            <label className="toggle-line">
              <input type="checkbox" checked={settings.pauseWhenHidden} onChange={(event) => updateSettings({ pauseWhenHidden: event.target.checked })} />
              <span>本轮结束后安全暂停</span>
            </label>
          </Field>
          <Field label="运行期间">
            <label className="toggle-line">
              <input type="checkbox" checked={settings.keepAwake} onChange={(event) => updateSettings({ keepAwake: event.target.checked })} />
              <span>允许时保持屏幕唤醒</span>
            </label>
          </Field>
          {!isSubscriptionProvider(settings.provider) && ['openai', 'openai-completions'].includes(settings.apiFormat) ? (
            <Field label="Token 参数">
              <select value={settings.tokenParam} onChange={(event) => updateSettings({ tokenParam: event.target.value })}>
                <option value="auto">自动</option>
                <option value="max_tokens">max_tokens</option>
                <option value="max_completion_tokens">max_completion_tokens</option>
              </select>
            </Field>
          ) : null}
          {!isSubscriptionProvider(settings.provider) ? (
            <Field label="鉴权方式">
              <select value={settings.authMode} onChange={(event) => updateSettings({ authMode: event.target.value })}>
                <option value="bearer">Authorization: Bearer</option>
                <option value="x-api-key">x-api-key</option>
                <option value="x-goog-api-key">x-goog-api-key</option>
                <option value="none">无鉴权</option>
              </select>
            </Field>
          ) : null}
          {!isSubscriptionProvider(settings.provider) ? (
            <>
              <Field label="响应方式">
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={settings.apiFormat === 'openai-completions' ? false : settings.stream}
                    disabled={settings.apiFormat === 'openai-completions'}
                    onChange={(event) => updateSettings({ stream: event.target.checked })}
                  />
                  <span>{settings.apiFormat === 'openai-completions' ? '完整响应（保留 usage）' : '启用流式响应'}</span>
                </label>
              </Field>
              <Field label="输入价格 (USD / M)" hint="留空时使用 OpenRouter 目录或内置快照。">
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={settings.inputPricePerMillion}
                  onChange={(event) => updateSettings({ inputPricePerMillion: event.target.value })}
                  placeholder="自动"
                />
              </Field>
              <Field label="输出价格 (USD / M)" hint="自定义 API 的金额模式建议手动填写。">
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={settings.outputPricePerMillion}
                  onChange={(event) => updateSettings({ outputPricePerMillion: event.target.value })}
                  placeholder="自动"
                />
              </Field>
            </>
          ) : null}
          {/\/\/api\.deepseek\.com\//i.test(settings.endpoint) ? (
            <Field label="深度思考">
              <label className="toggle-line">
                <input type="checkbox" checked={settings.deepThinking} onChange={(event) => updateSettings({ deepThinking: event.target.checked })} />
                <span>启用 thinking</span>
              </label>
            </Field>
          ) : null}
          <Field label="系统提示词" className="span-2">
            <textarea rows="3" value={settings.systemPrompt} onChange={(event) => updateSettings({ systemPrompt: event.target.value })} />
          </Field>
          {!isSubscriptionProvider(settings.provider) ? (
            <Field label="附加 Headers (JSON)" hint='示例：{"X-Title":"Token Killer"}' className="span-2">
              <textarea rows="3" value={settings.extraHeaders} spellCheck="false" onChange={(event) => updateSettings({ extraHeaders: event.target.value })} placeholder="{}" />
            </Field>
          ) : null}
        </div>
      </section>

      <section className="settings-section section-block">
        <div className="settings-section-title">
          <Database size={22} />
          <div>
            <h2>数据与排行榜</h2>
            <p>设置排行榜参与方式和服务地址。</p>
          </div>
        </div>
        <div className="form-grid data-grid">
          <Field label="排行榜编号" hint="自动生成，无需注册或填写昵称。">
            <output className="participant-id" aria-label="排行榜编号">{participantLabel}</output>
          </Field>
          <Field label="排行榜服务地址" hint="同域部署可留空；分开部署时填写服务 URL。">
            <input type="url" value={settings.leaderboardApiUrl} spellCheck="false" onChange={(event) => updateSettings({ leaderboardApiUrl: event.target.value })} placeholder="同域 /api" />
          </Field>
          <Field label="赛区选择" hint="自动模式按网络出口选择；关闭后可以手动指定赛区。">
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={settings.autoSelectRegion}
                onChange={(event) => updateSettings({
                  autoSelectRegion: event.target.checked,
                  geoApiUrl: String(settings.geoApiUrl || '').trim() || DEFAULT_GEO_URL,
                })}
              />
              <span>自动选择地区</span>
            </label>
          </Field>
          {settings.autoSelectRegion ? (
            <Field label="地区探测服务" hint="默认使用当前域名 /api/geo/assertion，也可以填写其他服务地址。" className="span-2">
              <div className="oauth-service-field">
                <input type="url" value={settings.geoApiUrl} spellCheck="false" onChange={(event) => updateSettings({ geoApiUrl: event.target.value })} placeholder={DEFAULT_GEO_URL} />
                <button className="secondary-button oauth-service-check" type="button" onClick={handleGeoServiceCheck} disabled={geoServiceState.status === 'checking'}>
                  <ArrowClockwise className={geoServiceState.status === 'checking' ? 'spin' : ''} size={16} />
                  {geoServiceState.status === 'checking' ? '检测中' : '检测服务'}
                </button>
              </div>
              <div className={`oauth-service-status ${geoServiceState.status}`} id={geoStatusId} aria-live="polite">
                {geoServiceState.status === 'ready' && geoServiceState.located ? <Check size={15} weight="bold" /> : <Info size={15} />}
                <span>{geoServiceMessage}</span>
              </div>
            </Field>
          ) : (
            <div className="manual-region-picker">
              <Field label="国家或地区">
                <select
                  value={manualRegion.countryCode}
                  onChange={(event) => updateManualRegion({
                    countryCode: event.target.value,
                    regionCode: '',
                    regionName: '',
                    cityName: '',
                  })}
                >
                  <option value="">请选择国家或地区</option>
                  {manualCountryOptions.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label={manualRegion.countryCode === 'CN' ? '省级赛区' : '州 / 省 / 一级行政区'}>
                <select
                  value={manualRegion.regionCode}
                  disabled={!manualRegion.countryCode || manualRegionCatalog.status === 'loading' || !manualRegionCatalog.options.length}
                  onChange={(event) => {
                    const option = manualRegionCatalog.options.find((item) => item.value === event.target.value)
                    updateManualRegion({
                      regionCode: event.target.value,
                      regionName: option?.label || '',
                      cityName: '',
                    })
                  }}
                >
                  <option value="">
                    {!manualRegion.countryCode
                      ? '请先选择国家或地区'
                      : manualRegionCatalog.status === 'loading'
                        ? '正在加载地区…'
                        : manualRegionCatalog.error || '仅参加国家赛区'}
                  </option>
                  {manualRegionCatalog.options.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="城市"
                hint={manualRegionIsProvinceOnly
                  ? '香港和澳门仅支持省级赛区。'
                  : '城市来自行政区目录，留空时只参加上一级赛区。'}
              >
                <select
                  value={manualRegion.cityName}
                  disabled={
                    !manualRegion.countryCode ||
                    manualRegionIsProvinceOnly ||
                    manualCityCatalog.status === 'loading' ||
                    (manualRegionRequired && !manualRegion.regionCode) ||
                    !manualCityCatalog.options.length
                  }
                  onChange={(event) => updateManualRegion({ cityName: event.target.value })}
                >
                  <option value="">
                    {!manualRegion.countryCode
                      ? '请先选择国家或地区'
                      : manualRegionIsProvinceOnly
                        ? '该赛区不细分城市'
                        : manualRegionRequired && !manualRegion.regionCode
                          ? '请先选择一级行政区'
                          : manualCityCatalog.status === 'loading'
                            ? '正在加载城市…'
                            : manualCityCatalog.error || '仅参加上一级赛区'}
                  </option>
                  {manualCityCatalog.options.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <Field label="公开汇总" hint="公开 token、费用、轮数、模型和时长。">
            <label className="toggle-line">
              <input type="checkbox" checked={settings.publishToLeaderboard} onChange={(event) => updateSettings({ publishToLeaderboard: event.target.checked })} />
              <span>将完整 usage 运行发布到排行榜</span>
            </label>
          </Field>
          <div className="data-actions">
            <button className="secondary-button" type="button" onClick={() => exportLocalData(settings, runs)}>
              <DownloadSimple size={18} />
              导出 JSON
            </button>
            <button className="danger-button" type="button" onClick={onClear}>
              <Trash size={18} />
              清空数据
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section section-block language-section">
        <div className="settings-section-title">
          <Translate size={22} />
          <div>
            <h2>界面与语言</h2>
            <p>选择界面语言；跟随系统会使用浏览器偏好。</p>
          </div>
        </div>
        <div className="form-grid">
          <Field label="界面语言">
            <select value={settings.locale || 'system'} onChange={(event) => onLocaleChange(event.target.value)}>
              <option value="system">跟随系统</option>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>
      </section>
      </div>
    </Localized>
  )
}

function Onboarding({ settings, updateSettings, models, availableModels, modelListState, refreshAvailableModels, accountsState, reloadAccounts, onClose }) {
  const [step, setStep] = useState(0)
  const steps = [
    {
      title: '欢迎使用 Token Killer',
      body: (
        <div className="onboard-points">
          <div><ShieldCheck size={22} /><span><strong>选择接入方式</strong><small>支持 API Key 与消费版订阅账号。</small></span></div>
          <div><Gauge size={22} /><span><strong>按回执统计</strong><small>每轮使用供应商 usage 更新进度。</small></span></div>
          <div><Key size={22} /><span><strong>隐私编号</strong><small>系统自动生成编号，不需要注册或填写昵称。</small></span></div>
        </div>
      ),
    },
    {
      title: '连接你的 API',
      body: (
        <>
          <ProviderFields
            settings={settings}
            updateSettings={updateSettings}
            models={models}
            availableModels={availableModels}
            modelListState={modelListState}
            refreshAvailableModels={refreshAvailableModels}
            accounts={accountsState.accounts}
            compact
          />
          {isSubscriptionProvider(settings.provider) ? <SubscriptionAccountManager settings={settings} updateSettings={updateSettings} accountsState={accountsState} reloadAccounts={reloadAccounts} compact /> : null}
        </>
      ),
    },
    {
      title: '设定第一把火',
      body: (
        <div className="onboard-target">
          <Field label="目标 Token">
            <input type="number" min="1" value={settings.targetTokens} onChange={(event) => updateSettings({ targetTokens: event.target.value, targetMode: 'tokens' })} />
          </Field>
          <div className="onboard-preset">
            <Lightning size={22} weight="fill" />
            <div><strong>推荐：熵增清单</strong><small>输出稳定，便于逐轮逼近目标。</small></div>
          </div>
        </div>
      ),
    },
  ]

  const finish = () => {
    markOnboarded()
    onClose()
  }

  return (
    <Localized>
      <div className="modal-backdrop" role="presentation">
      <div className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-progress">
          {steps.map((_, index) => <i className={index <= step ? 'active' : ''} key={index} />)}
        </div>
        <span className="onboarding-count">{step + 1} / {steps.length}</span>
        <h2 id="onboarding-title">{steps[step].title}</h2>
        <p className="onboarding-intro">三步完成配置，之后可随时修改。</p>
        <div className="onboarding-body">{steps[step].body}</div>
        <div className="onboarding-actions">
          <button className="text-button" type="button" onClick={finish}>跳过引导</button>
          <div>
            {step > 0 ? <button className="secondary-button" type="button" onClick={() => setStep(step - 1)}>上一步</button> : null}
            <button className="start-button" type="button" onClick={() => step === steps.length - 1 ? finish() : setStep(step + 1)}>
              {step === steps.length - 1 ? '进入控制台' : '继续'}
            </button>
          </div>
        </div>
      </div>
      </div>
    </Localized>
  )
}

export default function App() {
  const [activePanel, setActivePanel] = useState('burn')
  const [settings, setSettings] = useState(() => readSettings(DEFAULT_SETTINGS))
  const locale = resolveLocale(settings.locale)
  const [runs, setRuns] = useState(() => recoverInterruptedRun())
  const knownAchievementIdsRef = useRef(new Set(
    evaluateAchievements(runs).unlockedItems.map((item) => item.id),
  ))
  const [achievementNotice, setAchievementNotice] = useState(null)
  const [achievementFocusId, setAchievementFocusId] = useState('')
  const [models, setModels] = useState([])
  const [catalogState, setCatalogState] = useState('loading')
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState(0)
  const [availableModels, setAvailableModels] = useState([])
  const [modelListState, setModelListState] = useState({ status: 'idle', count: 0, endpoint: '', error: '' })
  const [leaderboardVersion, setLeaderboardVersion] = useState(0)
  const [accountsState, setAccountsState] = useState({ status: 'idle', accounts: [], error: '' })
  const [providerBlocklist, setProviderBlocklist] = useState(() => readProviderBlocklist())
  const [showOnboarding, setShowOnboarding] = useState(() => !hasOnboarded())
  const [participantLabel, setParticipantLabel] = useState(() => getParticipantLabel())
  const modelListAbortRef = useRef(null)
  const apiKeyStateRef = useRef({ provider: '', ready: false, request: 0 })
  const apiKeySaveTimerRef = useRef(null)

  const updateSettings = useCallback((patch) => setSettings((current) => ({ ...current, ...patch })), [])
  const changeLocale = useCallback((preference) => {
    setSettings((current) => {
      const nextLocale = resolveLocale(preference)
      const systemPrompt = Object.values(DEFAULT_SYSTEM_PROMPTS).includes(current.systemPrompt)
        ? DEFAULT_SYSTEM_PROMPTS[nextLocale]
        : current.systemPrompt
      return { ...current, locale: preference, systemPrompt }
    })
  }, [])
  const reloadAccounts = useCallback(async () => {
    setAccountsState((current) => ({ ...current, status: 'loading', error: '' }))
    try {
      const accounts = await listSubscriptionAccounts(settings.subscriptionApiUrl)
      setAccountsState({ status: 'ready', accounts, error: '' })
      setSettings((current) => {
        const selectedExists = accounts.some((account) => account.id === current.selectedAccountId)
        if (selectedExists || !accounts.length) return current
        return { ...current, selectedAccountId: accounts[0].id }
      })
      return accounts
    } catch (error) {
      setAccountsState({ status: 'error', accounts: [], error: error.message })
      return []
    }
  }, [settings.subscriptionApiUrl])
  const price = useMemo(() => {
    const automatic = resolvePrice(settings.model, models)
    const hasInputOverride = settings.inputPricePerMillion !== ''
    const hasOutputOverride = settings.outputPricePerMillion !== ''
    if (!hasInputOverride && !hasOutputOverride) return automatic
    return {
      input: hasInputOverride ? Number(settings.inputPricePerMillion) / 1_000_000 : automatic.input,
      output: hasOutputOverride ? Number(settings.outputPricePerMillion) / 1_000_000 : automatic.output,
      source: '手动价格覆盖',
      matchedModel: automatic.matchedModel || settings.model,
    }
  }, [settings.model, settings.inputPricePerMillion, settings.outputPricePerMillion, models])
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const saveRun = useCallback((data) => {
    setRuns((current) => {
      const nextRuns = [data, ...current.filter((run) => run.id !== data.id)].slice(0, 500)
      writeRuns(nextRuns)
      return nextRuns
    })
  }, [])
  const {
    session,
    startRun,
    requestPause,
    resumeRun,
    stopRun,
    resetSession,
    acquireWakeLock,
  } = useBurnSession({
    settings,
    price,
    catalogUpdatedAt,
    locale,
    saveRun,
    onProviderBlocklistChange: setProviderBlocklist,
    onLeaderboardPublished: () => setLeaderboardVersion((value) => value + 1),
  })

  const refreshCatalog = async () => {
    setCatalogState('loading')
    const controller = new AbortController()
    try {
      const catalog = await loadOpenRouterModels(controller.signal)
      setModels(catalog)
      setCatalogUpdatedAt(Date.now())
      setCatalogState('ready')
    } catch {
      setCatalogState('error')
    }
    return () => controller.abort()
  }

  const refreshAvailableModels = async () => {
    modelListAbortRef.current?.abort()
    const controller = new AbortController()
    modelListAbortRef.current = controller
    setModelListState({ status: 'loading', count: 0, endpoint: '', error: '' })
    try {
      const result = await loadProviderModels(settings, controller.signal)
      if (modelListAbortRef.current !== controller) return
      setAvailableModels(result.models)
      setModelListState({ status: 'ready', count: result.models.length, endpoint: result.endpoint, error: '' })
    } catch (error) {
      if (error.name === 'AbortError' || modelListAbortRef.current !== controller) return
      setAvailableModels([])
      setModelListState({ status: 'error', count: 0, endpoint: '', error: error.message })
    }
  }

  useEffect(() => {
    refreshCatalog()
  }, [])

  useEffect(() => {
    modelListAbortRef.current?.abort()
    modelListAbortRef.current = null
    setAvailableModels([])
    setModelListState({ status: 'idle', count: 0, endpoint: '', error: '' })
  }, [settings.endpoint, settings.apiFormat, settings.authMode])

  useEffect(() => {
    reloadAccounts()
  }, [reloadAccounts])

  useEffect(() => {
    if (isSubscriptionProvider(settings.provider) && settings.targetMode !== 'tokens') {
      updateSettings({ targetMode: 'tokens' })
    }
  }, [settings.provider, settings.targetMode, updateSettings])

  useEffect(() => {
    const provider = settings.provider
    const request = apiKeyStateRef.current.request + 1
    apiKeyStateRef.current = { provider, ready: false, request }
    setSettings((current) => current.provider === provider && current.apiKey ? { ...current, apiKey: '' } : current)

    if (isSubscriptionProvider(provider)) return

    getEncryptedSecret(apiKeySecretId(provider))
      .then((apiKey) => {
        if (apiKeyStateRef.current.request !== request) return
        apiKeyStateRef.current = { provider, ready: true, request }
        setSettings((current) => current.provider === provider ? { ...current, apiKey } : current)
      })
      .catch(() => {
        if (apiKeyStateRef.current.request !== request) return
        apiKeyStateRef.current = { provider, ready: true, request }
      })
  }, [settings.provider])

  useEffect(() => {
    const keyState = apiKeyStateRef.current
    if (
      !keyState.ready ||
      keyState.provider !== settings.provider ||
      isSubscriptionProvider(settings.provider)
    ) {
      window.clearTimeout(apiKeySaveTimerRef.current)
      apiKeySaveTimerRef.current = null
      return undefined
    }

    const timer = window.setTimeout(() => {
      apiKeySaveTimerRef.current = null
      const operation = settings.apiKey
        ? saveEncryptedSecret(apiKeySecretId(settings.provider), settings.apiKey)
        : deleteEncryptedSecret(apiKeySecretId(settings.provider))
      operation.catch(() => {})
    }, 300)
    apiKeySaveTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (apiKeySaveTimerRef.current === timer) apiKeySaveTimerRef.current = null
    }
  }, [settings.provider, settings.apiKey])

  useEffect(() => {
    writeSettings(settings)
    const root = document.documentElement
    root.lang = locale
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings, locale])

  useEffect(() => {
    const result = evaluateAchievements(runs)
    const newlyUnlocked = result.unlockedItems.filter(
      (item) => !knownAchievementIdsRef.current.has(item.id),
    )
    knownAchievementIdsRef.current = new Set(result.unlockedItems.map((item) => item.id))
    if (newlyUnlocked.length) setAchievementNotice(newlyUnlocked.at(-1))
  }, [runs])

  const handleUnblockProvider = (key) => {
    unblockProvider(key)
    setProviderBlocklist(readProviderBlocklist())
  }

  const handleClearProviderBlocklist = () => {
    if (!window.confirm(t(locale, '确定解除全部 Provider 屏蔽吗？', 'Remove every provider block?'))) return
    clearProviderBlocklist()
    setProviderBlocklist([])
  }

  const handleClear = async () => {
    if (!window.confirm(t(
      locale,
      '确定清空设置、运行记录和已保存凭据吗？',
      'Clear settings, run history, and saved credentials?',
    ))) return
    window.clearTimeout(apiKeySaveTimerRef.current)
    apiKeySaveTimerRef.current = null
    const resetRequest = apiKeyStateRef.current.request + 1
    apiKeyStateRef.current = { provider: '', ready: false, request: resetRequest }
    clearLocalData()
    setProviderBlocklist([])
    try {
      await clearLocalVault()
    } catch (error) {
      window.alert(error.message)
      return
    }
    setRuns([])
    knownAchievementIdsRef.current = new Set()
    setAchievementNotice(null)
    setAchievementFocusId('')
    apiKeyStateRef.current = { provider: DEFAULT_SETTINGS.provider, ready: true, request: resetRequest }
    setSettings(DEFAULT_SETTINGS)
    setParticipantLabel(getParticipantLabel())
    resetSession()
    setAccountsState({ status: 'idle', accounts: [], error: '' })
    setShowOnboarding(true)
  }

  return (
    <I18nProvider locale={locale}>
      <Localized>
        <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Fire size={20} weight="fill" /></span>
          <span><strong>Token Killer</strong><small>AI Token 消耗实验室</small></span>
        </div>
        <nav>
          <NavButton active={activePanel === 'burn'} icon={Fire} label="消耗" onClick={() => setActivePanel('burn')} />
          <NavButton active={activePanel === 'stats'} icon={ChartBar} label="统计" onClick={() => setActivePanel('stats')} />
          <NavButton active={activePanel === 'settings'} icon={SlidersHorizontal} label="配置" onClick={() => setActivePanel('settings')} />
        </nav>
        <div className="sidebar-foot">
          <div className="local-badge"><ShieldCheck size={18} /><span><strong>{participantLabel}</strong></span></div>
          <button
            className="theme-toggle"
            type="button"
            aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
            onClick={() => updateSettings({ theme: isDark ? 'light' : 'dark' })}
          >
            {isDark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button className="sidebar-help" type="button" aria-label="重新打开使用引导" onClick={() => setShowOnboarding(true)}>
            <Info size={19} />
          </button>
        </div>
      </aside>

      <main>
        {activePanel === 'burn' ? (
          <BurnPanel
            settings={settings}
            updateSettings={updateSettings}
            catalogState={catalogState}
            session={session}
            onStart={startRun}
            onPause={() => requestPause()}
            onResume={() => {
              resumeRun()
              acquireWakeLock()
            }}
            onStop={stopRun}
            price={price}
            accounts={accountsState.accounts}
          />
        ) : null}
        {activePanel === 'stats' ? (
          <StatsPanel
            runs={runs}
            settings={settings}
            leaderboardVersion={leaderboardVersion}
            participantLabel={participantLabel}
            focusAchievementId={achievementFocusId}
          />
        ) : null}
        {activePanel === 'settings' ? (
          <SettingsPanel
            settings={settings}
            updateSettings={updateSettings}
            onLocaleChange={changeLocale}
            models={models}
            availableModels={availableModels}
            modelListState={modelListState}
            refreshAvailableModels={refreshAvailableModels}
            catalogState={catalogState}
            refreshCatalog={refreshCatalog}
            runs={runs}
            onClear={handleClear}
            accountsState={accountsState}
            reloadAccounts={reloadAccounts}
            participantLabel={participantLabel}
            providerBlocklist={providerBlocklist}
            onUnblockProvider={handleUnblockProvider}
            onClearProviderBlocklist={handleClearProviderBlocklist}
          />
        ) : null}
      </main>

      <nav className="mobile-nav">
        <NavButton active={activePanel === 'burn'} icon={Fire} label="消耗" onClick={() => setActivePanel('burn')} />
        <NavButton active={activePanel === 'stats'} icon={ChartBar} label="统计" onClick={() => setActivePanel('stats')} />
        <NavButton active={activePanel === 'settings'} icon={SlidersHorizontal} label="配置" onClick={() => setActivePanel('settings')} />
      </nav>

      {showOnboarding ? (
        <Onboarding
          settings={settings}
          updateSettings={updateSettings}
          models={models}
          availableModels={availableModels}
          modelListState={modelListState}
          refreshAvailableModels={refreshAvailableModels}
          accountsState={accountsState}
          reloadAccounts={reloadAccounts}
          onClose={() => setShowOnboarding(false)}
        />
      ) : null}
      <AchievementUnlockToast
        achievement={achievementNotice}
        locale={locale}
        onClose={() => setAchievementNotice(null)}
        onOpen={() => {
          setAchievementFocusId(achievementNotice?.id || '')
          setActivePanel('stats')
          setAchievementNotice(null)
        }}
        onShare={() => {
          if (!achievementNotice) return
          const title = achievementTitle(achievementNotice, locale)
          const totalTokens = runs.reduce((sum, run) => sum + Number(run.tokens || 0), 0)
          const deploymentUrl = new URL('.', window.location.href).href.replace(/\/$/, '')
          const text = t(
            locale,
            `我在 Token Killer 解锁了“${title}”，累计消耗 ${formatTokens(totalTokens)} Token。你也来点亮自己的成就吧：${deploymentUrl}`,
            `I unlocked "${title}" in Token Killer after burning ${formatTokens(totalTokens)} tokens. Light up yours at ${deploymentUrl}.`,
          )
          window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
        }}
      />
        </div>
      </Localized>
    </I18nProvider>
  )
}
