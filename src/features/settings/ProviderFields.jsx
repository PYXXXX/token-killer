import { useState } from 'react'
import { ArrowClockwise, Eye, EyeSlash } from '@phosphor-icons/react'
import { Localized } from '../../Localized.jsx'
import { Field } from '../../components/ui.jsx'
import { subscriptionPlanLabel } from '../../lib/accountLabels.js'
import {
  API_FORMATS,
  SUBSCRIPTION_MODELS,
  SUBSCRIPTION_PROVIDER_IDS,
} from '../../lib/catalog.js'

const isSubscriptionProvider = (provider) => SUBSCRIPTION_PROVIDER_IDS.includes(provider)
const accountProviderForSettings = (provider) => ({
  chatgpt: 'openai',
  claude_subscription: 'claude',
  gemini_subscription: 'gemini',
  grok_subscription: 'grok',
}[provider] || '')

export function ProviderFields({
  settings,
  updateSettings,
  models,
  availableModels = [],
  modelListState = { status: 'idle', count: 0, error: '' },
  refreshAvailableModels,
  accounts = [],
  compact = false,
}) {
  const [showKey, setShowKey] = useState(false)
  const subscription = isSubscriptionProvider(settings.provider)
  const switchFormat = (apiFormat) => {
    const preset = API_FORMATS[apiFormat]
    if (!preset) return
    updateSettings({
      provider: 'custom',
      endpoint: preset.endpoint,
      model: preset.model,
      apiFormat,
      authMode: preset.authMode,
      tokenParam: 'auto',
    })
  }
  const selectableModels = availableModels.length ? availableModels : models
  const listId = compact ? 'onboarding-model-catalog' : 'model-catalog'
  const modelHint = modelListState.status === 'ready'
    ? `已获取 ${modelListState.count} 个可用模型；未列出的模型 ID 仍可直接填写。价格按 OpenRouter 目录匹配。`
    : modelListState.status === 'error'
      ? modelListState.error
      : '点击刷新获取可用模型，也可以直接填写模型 ID；价格按 OpenRouter 目录匹配。'

  return (
    <Localized>
      <div className={`form-grid ${compact ? 'compact' : ''}`}>
        <Field label="请求格式" className="span-2">
          <select value={subscription ? 'subscription' : settings.apiFormat} onChange={(event) => switchFormat(event.target.value)}>
            {subscription ? <option value="subscription" disabled>当前使用消费版订阅账号</option> : null}
            {Object.entries(API_FORMATS).map(([id, format]) => (
              <option value={id} key={id}>{format.label}</option>
            ))}
          </select>
        </Field>
        {subscription ? (
          <>
            <Field label="已连接账号">
              <select value={settings.selectedAccountId} onChange={(event) => updateSettings({ selectedAccountId: event.target.value })}>
                <option value="">请选择订阅账号</option>
                {accounts.filter((account) => account.provider === accountProviderForSettings(settings.provider)).map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.displayName} {account.planType ? `· ${subscriptionPlanLabel(account.provider, account.planType)}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="订阅模型">
              <input type="text" list="subscription-model-catalog" value={settings.model} spellCheck="false" onChange={(event) => updateSettings({ model: event.target.value })} />
              <datalist id="subscription-model-catalog">
                {(SUBSCRIPTION_MODELS[settings.provider] || []).map((model) => <option value={model} key={model} />)}
              </datalist>
            </Field>
          </>
        ) : (
          <>
            <Field label="请求地址" className="span-2">
              <input
                type="url"
                value={settings.endpoint}
                spellCheck="false"
                onChange={(event) => updateSettings({ endpoint: event.target.value })}
                placeholder="https://api.example.com/v1/chat/completions"
              />
            </Field>
            <Field label="模型 ID">
              <div className="model-picker">
                <input
                  type="text"
                  list={listId}
                  value={settings.model}
                  spellCheck="false"
                  onChange={(event) => updateSettings({ model: event.target.value })}
                  placeholder="provider/model-name"
                />
                <button type="button" disabled={modelListState.status === 'loading'} onClick={refreshAvailableModels}>
                  <ArrowClockwise className={modelListState.status === 'loading' ? 'spin' : ''} size={16} />
                  <span>{modelListState.status === 'loading' ? '获取中' : '刷新'}</span>
                </button>
              </div>
              <small className={modelListState.status === 'error' ? 'field-error' : ''}>{modelHint}</small>
              <datalist id={listId}>
                {selectableModels.slice(0, 1000).map((model) => (
                  <option value={model.id} key={model.id}>{model.name}</option>
                ))}
              </datalist>
            </Field>
            <Field label="API Key" hint="加密保存，下次访问自动填充。">
              <div className="input-with-action">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  autoComplete="off"
                  spellCheck="false"
                  onChange={(event) => updateSettings({ apiKey: event.target.value })}
                  placeholder="sk-..."
                />
                <button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(!showKey)}>
                  {showKey ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
          </>
        )}
      </div>
    </Localized>
  )
}
