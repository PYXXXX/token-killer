import {
  Check,
  Gauge,
  Info,
  Pause,
  Play,
  ShieldCheck,
  Stop,
} from '@phosphor-icons/react'
import { Localized } from '../../Localized.jsx'
import { useLocale } from '../../locale-context.js'
import { Field, Segmented } from '../../components/ui.jsx'
import { guardedPromptEstimate } from '../../lib/api.js'
import {
  API_FORMATS,
  PROMPT_PRESETS,
  PROVIDERS,
  SUBSCRIPTION_PROVIDER_IDS,
} from '../../lib/catalog.js'
import { formatMoney, formatTokens, percent } from '../../lib/format.js'
import { t, translateText } from '../../lib/i18n.js'

const isSubscriptionProvider = (provider) => SUBSCRIPTION_PROVIDER_IDS.includes(provider)

export function BurnPanel({
  settings,
  updateSettings,
  catalogState,
  session,
  onStart,
  onPause,
  onResume,
  onStop,
  price,
  accounts,
}) {
  const locale = useLocale()
  const preset = PROMPT_PRESETS.find((item) => item.id === settings.promptId) || PROMPT_PRESETS[0]
  const target = settings.targetMode === 'tokens' ? Number(settings.targetTokens) : Number(settings.targetAmount)
  const consumed = settings.targetMode === 'tokens' ? session.tokens : session.cost
  const progress = percent(consumed, target)
  const presetPrompt = locale === 'en' ? preset.promptEn : preset.prompt
  const prompt = settings.promptId === 'custom' ? settings.customPrompt : presetPrompt
  const isSubscription = isSubscriptionProvider(settings.provider)
  const priceSummary = t(
    locale,
    `${price.source}。费用按当前模型的 OpenRouter 参考价与实际 usage 估算${isSubscription ? '，订阅账号同样计入费用统计与排行榜' : ''}。${catalogState === 'loading' ? ' 正在刷新模型目录。' : ''}`,
    `${translateText(locale, price.source)}. Cost is estimated from actual usage using the current model's OpenRouter reference price${isSubscription ? '; subscription accounts are included in cost statistics and leaderboards too' : ''}.${catalogState === 'loading' ? ' Refreshing the model catalog.' : ''}`,
  )
  const promptReserve = guardedPromptEstimate(settings.systemPrompt, prompt)
  const active = ['running', 'pausing', 'paused', 'stopping'].includes(session.status)
  const selectedAccount = accounts.find((account) => account.id === settings.selectedAccountId)
  const canStart = Boolean(
    settings.model &&
      target > 0 &&
      prompt &&
      (isSubscription
        ? selectedAccount
        : settings.endpoint && (settings.apiKey || settings.authMode === 'none')),
  )

  return (
    <Localized>
      <div className="panel-page burn-page">
        <header className="page-header">
          <div>
            <span className="page-kicker">消耗控制台</span>
            <h1>消耗你的 Token</h1>
            <p>设定目标，选择任务，然后开始消耗。</p>
          </div>
          <div className="provider-chip">
            <ShieldCheck size={19} />
            <span>{isSubscription ? PROVIDERS[settings.provider]?.label : API_FORMATS[settings.apiFormat]?.label || '兼容 API'}</span>
            <small>{isSubscription ? selectedAccount?.displayName || '等待连接账号' : settings.authMode === 'none' ? '无需密钥' : settings.apiKey ? '已配置密钥' : '等待密钥'}</small>
          </div>
        </header>

        <div className="burn-layout">
          <section className="control-column">
            <div className="section-block target-block">
              <div className="section-heading">
                <div>
                  <h2>消耗目标</h2>
                  <p>接近目标时自动缩小单轮输出预算。</p>
                </div>
                <Segmented
                  label="消耗目标类型"
                  value={settings.targetMode}
                  options={isSubscription
                    ? [{ value: 'tokens', label: '定 Token' }]
                    : [
                        { value: 'tokens', label: '定 Token' },
                        { value: 'money', label: '定金额' },
                      ]}
                  onChange={(targetMode) => updateSettings({ targetMode })}
                />
              </div>

              <div className="target-input-row">
                <div className="target-input-wrap">
                  <span>{settings.targetMode === 'tokens' ? 'TOKENS' : 'USD'}</span>
                  <input
                    aria-label={settings.targetMode === 'tokens' ? '目标 Token 数' : '目标金额'}
                    type="number"
                    min="1"
                    step={settings.targetMode === 'tokens' ? '1000' : '0.1'}
                    value={settings.targetMode === 'tokens' ? settings.targetTokens : settings.targetAmount}
                    onChange={(event) =>
                      updateSettings(
                        settings.targetMode === 'tokens'
                          ? { targetTokens: event.target.value }
                          : { targetAmount: event.target.value },
                      )
                    }
                  />
                </div>
                <div className="target-meta">
                  <div>
                    <span>当前价格</span>
                    <strong>{price.output ? `${formatMoney(price.output * 1_000_000, 2)} / M 输出` : '未匹配'}</strong>
                  </div>
                  <div>
                    <span>输入预留</span>
                    <strong>约 {formatTokens(promptReserve)} / 轮</strong>
                  </div>
                </div>
              </div>
              <div className="price-source">
                <Info size={16} />
                <span>{priceSummary}</span>
              </div>
            </div>

            <div className="section-block prompt-block">
              <div className="section-heading">
                <div>
                  <h2>请求内容</h2>
                  <p>选择持续输出型任务，或完全自定义。</p>
                </div>
              </div>
              <div className="prompt-options">
                {PROMPT_PRESETS.map((item) => (
                  <button
                    type="button"
                    className={`prompt-option ${settings.promptId === item.id ? 'active' : ''}`}
                    key={item.id}
                    onClick={() => updateSettings({ promptId: item.id })}
                  >
                    <span className="prompt-check">{settings.promptId === item.id ? <Check size={15} weight="bold" /> : null}</span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.description}</small>
                    </span>
                    <em>{item.tag}</em>
                  </button>
                ))}
              </div>
              {settings.promptId === 'custom' ? (
                <Field label="自定义 Prompt" className="custom-prompt-field">
                  <textarea
                    rows="6"
                    value={settings.customPrompt}
                    onChange={(event) => updateSettings({ customPrompt: event.target.value })}
                    placeholder="输入希望模型持续执行的任务..."
                  />
                </Field>
              ) : (
                <div className="prompt-preview">
                  <span>将发送</span>
                  <p>{presetPrompt}</p>
                </div>
              )}
            </div>
          </section>

          <aside className="run-column">
            <div className={`run-console status-${session.status}`}>
              <div className="run-topline">
                <span className="run-status">
                  {active ? <span className="live-mark" /> : null}
                  {session.message}
                </span>
                <span>{session.rounds} 轮</span>
              </div>

              <div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` }}>
                <div>
                  <strong>{progress.toFixed(progress < 10 ? 1 : 0)}%</strong>
                  <span>{settings.targetMode === 'tokens' ? formatTokens(session.tokens) : formatMoney(session.cost)}</span>
                </div>
              </div>

              <div className="run-stats">
                <div><span>输入</span><strong>{formatTokens(session.input)}</strong></div>
                <div><span>输出</span><strong>{formatTokens(session.output)}</strong></div>
                <div><span>成本</span><strong>{formatMoney(session.cost)}</strong></div>
                <div><span>核验</span><strong>{session.rounds ? `${session.verifiedRounds}/${session.rounds}` : '0/0'}</strong></div>
              </div>

              {session.logs.length ? (
                <div className="run-log" aria-live="polite">
                  {session.logs.slice(-4).map((log) => (
                    <div key={log.id}>
                      <span>{log.label}</span>
                      <strong>{log.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="run-empty">
                  <Gauge size={26} />
                  <p>启动后，这里显示每轮的真实 usage 与预算变化。</p>
                </div>
              )}

              {active ? (
                <div className="run-actions">
                  {session.status === 'paused' ? (
                    <button className="start-button" type="button" onClick={onResume}>
                      <Play size={19} weight="fill" />
                      继续
                    </button>
                  ) : (
                    <button className="pause-button" type="button" disabled={session.status !== 'running'} onClick={onPause}>
                      <Pause size={19} weight="fill" />
                      {session.status === 'pausing' ? '等待本轮结束' : '安全暂停'}
                    </button>
                  )}
                  <button className="stop-button" type="button" onClick={onStop}>
                    <Stop size={19} weight="fill" />
                    立即停止
                  </button>
                </div>
              ) : (
                <button className="start-button" type="button" disabled={!canStart} onClick={onStart}>
                  <Play size={19} weight="fill" />
                  开始消耗
                </button>
              )}
              {!canStart && !active ? <small className="button-hint">{isSubscription ? '请先在配置中连接并选择对应的订阅账号' : '请补齐 API、模型、密钥和请求内容'}</small> : null}
            </div>

            <div className="guard-note">
              <ShieldCheck size={22} />
              <div>
                <strong>软上限保护</strong>
                <p>按回执记账，逐轮收缩。供应商分词与计费发生在远端，无法保证最后 1 token 的绝对命中。</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Localized>
  )
}
