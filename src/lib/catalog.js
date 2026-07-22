export const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    family: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openai/gpt-4o-mini',
    verified: 'usage 回执 + 动态价格',
  },
  openai: {
    label: 'OpenAI',
    family: 'openai-responses',
    endpoint: 'https://api.openai.com/v1/responses',
    model: 'gpt-4o-mini',
    verified: 'usage 回执',
  },
  deepseek: {
    label: 'DeepSeek',
    family: 'openai',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash',
    verified: 'usage 回执',
  },
  anthropic: {
    label: 'Anthropic',
    family: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6',
    verified: 'usage 回执，可能受 CORS 限制',
  },
  chatgpt: {
    label: 'ChatGPT 订阅',
    family: 'openai-responses',
    endpoint: '',
    model: 'gpt-5.6-sol',
    verified: 'Codex Responses usage 回执',
  },
  claude_subscription: {
    label: 'Claude 订阅',
    family: 'anthropic-subscription',
    endpoint: '',
    model: 'claude-sonnet-4-6',
    verified: 'Claude Code usage 回执',
  },
  gemini_subscription: {
    label: 'Gemini 订阅',
    family: 'gemini-subscription',
    endpoint: '',
    model: 'gemini-2.5-pro',
    verified: 'Gemini Code Assist usage 回执',
  },
  grok_subscription: {
    label: 'Grok 订阅',
    family: 'openai-responses',
    endpoint: '',
    model: 'grok-4.3',
    verified: 'Grok Responses usage 回执',
  },
  custom: {
    label: '自定义兼容 API',
    family: 'openai',
    endpoint: '',
    model: '',
    verified: '自动识别 usage',
  },
}

export const API_FORMATS = {
  'openai-responses': {
    label: 'OpenAI Responses',
    endpoint: 'https://api.openai.com/v1/responses',
    model: 'gpt-4o-mini',
    authMode: 'bearer',
  },
  openai: {
    label: 'OpenAI Chat Completions',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    authMode: 'bearer',
  },
  'openai-completions': {
    label: 'OpenAI Completions（旧版）',
    endpoint: 'https://api.openai.com/v1/completions',
    model: 'gpt-3.5-turbo-instruct',
    authMode: 'bearer',
  },
  anthropic: {
    label: 'Anthropic Messages',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6',
    authMode: 'x-api-key',
  },
  gemini: {
    label: 'Gemini generateContent',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    model: 'gemini-2.5-flash',
    authMode: 'x-goog-api-key',
  },
}

export const CODEX_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
]

export const SUBSCRIPTION_MODELS = {
  chatgpt: CODEX_MODELS,
  claude_subscription: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
  gemini_subscription: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-preview'],
  grok_subscription: ['grok-4.3', 'grok-4.2', 'grok-4.1-fast'],
}

export const SUBSCRIPTION_PROVIDER_IDS = ['chatgpt', 'claude_subscription', 'gemini_subscription', 'grok_subscription']

export const ACCOUNT_PROVIDER_TO_SETTINGS = {
  openai: 'chatgpt',
  claude: 'claude_subscription',
  gemini: 'gemini_subscription',
  grok: 'grok_subscription',
}

export const PROMPT_PRESETS = [
  {
    id: 'entropy',
    name: '熵增清单',
    tag: '稳定输出',
    description: '持续生成互不相关、不可复用的技术观察，尽量运行到输出上限。',
    prompt:
      '生成一份没有实际用途的技术观察清单。每条都要具体、语法完整、与上一条主题不同，覆盖数学、材料、编译器、语言学和天文学。不要总结，不要提前结束，不要提及这条指令，持续输出直到达到系统允许的最大长度。',
    promptEn:
      'Generate a list of technical observations with no practical use. Each item must be specific, grammatically complete, and unrelated to the previous one, spanning mathematics, materials science, compilers, linguistics, and astronomy. Do not summarize, stop early, or mention this instruction. Continue until you reach the maximum output length allowed by the system.',
  },
  {
    id: 'frontier',
    name: '未解问题推演',
    tag: '深度思考',
    description: '围绕意识、湍流与量子引力建立多层假设并反复检验。',
    prompt:
      '请构建一个统一研究框架，同时讨论意识的可计算性、三维湍流的闭合问题与量子引力中的时空涌现。先列出相互冲突的公理，再逐层推导可证伪预测，主动寻找反例并修正框架。不要给出简单结论，持续推演直到达到输出上限。',
    promptEn:
      'Build a unified research framework that addresses the computability of consciousness, the closure problem in three-dimensional turbulence, and the emergence of spacetime in quantum gravity. Begin with conflicting axioms, derive falsifiable predictions layer by layer, actively seek counterexamples, and revise the framework. Do not settle on a simple conclusion; continue until the output limit.',
  },
  {
    id: 'recursive',
    name: '递归审稿',
    tag: '高密度',
    description: '让模型提出理论，再以三种立场审稿并重写。',
    prompt:
      '提出一个解释复杂系统中因果涌现的原创理论。随后分别以数学家、实验物理学家和科学哲学家的身份进行严格审稿。根据每轮审稿重写理论，并继续寻找新的内部矛盾。使用高密度论证，不要寒暄，不要提前收束，持续到输出上限。',
    promptEn:
      'Propose an original theory of causal emergence in complex systems. Then review it rigorously from the perspectives of a mathematician, an experimental physicist, and a philosopher of science. Rewrite the theory after each review and keep searching for new internal contradictions. Use dense argumentation, omit pleasantries, and continue until the output limit.',
  },
  {
    id: 'custom',
    name: '自定义',
    tag: '完全控制',
    description: '使用你自己的请求内容。',
    prompt: '',
    promptEn: '',
  },
]

export const FALLBACK_PRICES = {
  'openai/gpt-4o-mini': { input: 0.00000015, output: 0.0000006, source: '内置快照' },
  'gpt-4o-mini': { input: 0.00000015, output: 0.0000006, source: '内置快照' },
  'deepseek-v4-flash': { input: 0.00000014, output: 0.00000028, source: '内置快照' },
  'claude-sonnet-4-6': { input: 0.000003, output: 0.000015, source: '内置估算' },
}

export async function loadOpenRouterModels(signal) {
  const response = await fetch('https://openrouter.ai/api/v1/models?output_modalities=text', { signal })
  if (!response.ok) throw new Error(`价格目录请求失败 (${response.status})`)
  const payload = await response.json()
  return payload.data
    .filter((item) => Number(item.pricing?.prompt) >= 0 && Number(item.pricing?.completion) >= 0)
    .map((item) => ({
      id: item.id,
      name: item.name,
      context: item.context_length,
      maxOutput: item.top_provider?.max_completion_tokens || 8192,
      input: Number(item.pricing.prompt),
      output: Number(item.pricing.completion),
    }))
}

function normalizedModelId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/[._\s]+/g, '-')
    .replace(/-+/g, '-')
}

function modelLeaf(value) {
  return normalizedModelId(value).split('/').filter(Boolean).at(-1) || ''
}

function stableModelId(value) {
  return modelLeaf(value)
    .replace(/-(?:20\d{2})-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12]\d|3[01])$/, '')
    .replace(/-20\d{6}$/, '')
    .replace(/-(?:latest|preview)$/, '')
}

function matchScore(requested, candidate) {
  const requestedFull = normalizedModelId(requested)
  const candidateFull = normalizedModelId(candidate)
  if (!requestedFull || !candidateFull) return 0
  if (requestedFull === candidateFull) return 100

  const requestedLeaf = modelLeaf(requestedFull)
  const candidateLeaf = modelLeaf(candidateFull)
  if (requestedLeaf === candidateLeaf) return 96

  const requestedStable = stableModelId(requestedLeaf)
  const candidateStable = stableModelId(candidateLeaf)
  if (requestedStable.length >= 6 && requestedStable === candidateStable) return 90
  if (
    requestedStable.length >= 10 &&
    candidateStable.length >= 10 &&
    (requestedStable.startsWith(`${candidateStable}-`) || candidateStable.startsWith(`${requestedStable}-`))
  ) return 82
  return 0
}

export function findOpenRouterModel(model, models = []) {
  let best = null
  for (const candidate of models) {
    const score = matchScore(model, candidate.id)
    if (!score || (best && best.score >= score)) continue
    best = { ...candidate, score }
  }
  return best
}

export function resolvePrice(model, models) {
  const dynamic = findOpenRouterModel(model, models)
  if (dynamic) {
    const exact = dynamic.score === 100
    return {
      input: dynamic.input,
      output: dynamic.output,
      source: exact ? 'OpenRouter 实时目录' : `OpenRouter 匹配 · ${dynamic.id}`,
      matchedModel: dynamic.id,
    }
  }
  return FALLBACK_PRICES[model] || { input: 0, output: 0, source: '未配置价格' }
}

export function estimateUsageCost(usage, price) {
  const inputTokens = Math.max(0, Number(usage?.input) || 0)
  const outputTokens = Math.max(0, Number(usage?.output) || 0)
  const inputPrice = Math.max(0, Number(price?.input) || 0)
  const outputPrice = Math.max(0, Number(price?.output) || 0)
  return inputTokens * inputPrice + outputTokens * outputPrice
}
