import { useCallback, useEffect, useRef, useState } from 'react'
import { callProvider, guardedPromptEstimate } from '../../lib/api.js'
import {
  PROMPT_PRESETS,
  createPricingSnapshot,
  estimateUsageCost,
} from '../../lib/catalog.js'
import { formatDuration, formatMoney, formatTokens, todayKey } from '../../lib/format.js'
import { createLeaderboardSession, submitLeaderboardRun } from '../../lib/leaderboard.js'
import { providerBlockedMessage } from '../../lib/providerGuard.js'
import {
  clearRunCheckpoint,
  isProviderBlocked,
  readProviderBlocklist,
  writeRunCheckpoint,
} from '../../lib/storage.js'

export const INITIAL_SESSION = {
  status: 'idle',
  tokens: 0,
  input: 0,
  output: 0,
  cost: 0,
  rounds: 0,
  verifiedRounds: 0,
  startedAt: 0,
  endedAt: 0,
  currentOutput: '',
  logs: [],
  message: '等待启动',
}

export function useBurnSession({
  settings,
  price,
  catalogUpdatedAt,
  locale,
  saveRun,
  onProviderBlocklistChange,
  onLeaderboardPublished,
}) {
  const [session, setSession] = useState(INITIAL_SESSION)
  const abortRef = useRef(null)
  const pauseRef = useRef({ requested: false, resume: null, reason: '' })
  const wakeLockRef = useRef(null)

  const requestPause = useCallback((reason = '已请求暂停，等待本轮结束') => {
    if (!abortRef.current || pauseRef.current.requested) return
    pauseRef.current.requested = true
    pauseRef.current.reason = reason
    setSession((current) => current.status === 'running'
      ? { ...current, status: 'pausing', message: reason }
      : current)
  }, [])

  const resumeRun = useCallback(() => {
    pauseRef.current.requested = false
    pauseRef.current.reason = ''
    const resume = pauseRef.current.resume
    pauseRef.current.resume = null
    setSession((current) => current.status === 'paused'
      ? { ...current, status: 'running', message: `正在准备第 ${current.rounds + 1} 轮` }
      : current)
    resume?.()
  }, [])

  const releaseWakeLock = useCallback(async () => {
    const lock = wakeLockRef.current
    wakeLockRef.current = null
    if (!lock || lock.released) return
    try {
      await lock.release()
    } catch {
      // Browsers may release the lock themselves when the page becomes hidden.
    }
  }, [])

  const acquireWakeLock = useCallback(async () => {
    if (!settings.keepAwake || document.visibilityState !== 'visible' || !navigator.wakeLock || wakeLockRef.current) return
    try {
      const lock = await navigator.wakeLock.request('screen')
      wakeLockRef.current = lock
      lock.addEventListener('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null
      }, { once: true })
    } catch {
      // Wake Lock is optional; the run remains usable when the browser denies it.
    }
  }, [settings.keepAwake])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        releaseWakeLock()
        if (settings.pauseWhenHidden) requestPause('页面已转入后台，本轮结束后暂停')
      } else if (abortRef.current && !pauseRef.current.requested) {
        acquireWakeLock()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [acquireWakeLock, releaseWakeLock, requestPause, settings.pauseWhenHidden])

  useEffect(() => () => {
    abortRef.current?.abort()
    pauseRef.current.resume?.()
    releaseWakeLock()
  }, [releaseWakeLock])

  const startRun = async () => {
    if (['running', 'pausing', 'paused', 'stopping'].includes(session.status)) return
    if (isProviderBlocked(settings)) {
      onProviderBlocklistChange?.(readProviderBlocklist())
      setSession({ ...INITIAL_SESSION, status: 'blocked', endedAt: Date.now(), message: providerBlockedMessage() })
      return
    }
    const preset = PROMPT_PRESETS.find((item) => item.id === settings.promptId) || PROMPT_PRESETS[0]
    const prompt = settings.promptId === 'custom'
      ? settings.customPrompt
      : locale === 'en'
        ? preset.promptEn
        : preset.prompt
    const target = settings.targetMode === 'tokens' ? Number(settings.targetTokens) : Number(settings.targetAmount)
    const batchSize = Math.max(1, Number(settings.batchSize) || 1)
    const maxRounds = Math.max(0, Number(settings.maxRounds) || 0)
    const maxDurationMs = Math.max(0, Number(settings.maxDurationMinutes) || 0) * 60_000
    const startedAt = Date.now()
    const runPrice = { ...price }
    const runId = crypto.randomUUID()
    const runPricingSnapshot = createPricingSnapshot(settings.model, runPrice, catalogUpdatedAt, startedAt)
    const controller = new AbortController()
    abortRef.current = controller
    pauseRef.current = { requested: false, resume: null, reason: '' }

    let totals = { tokens: 0, input: 0, output: 0, cost: 0, rounds: 0, verifiedRounds: 0 }
    let calibratedInput = 0
    let finalStatus = 'completed'
    let finalMessage = '目标已完成'
    let latestLogs = []
    let leaderboardSession = null

    setSession({ ...INITIAL_SESSION, status: 'running', startedAt, message: '正在准备第 1 轮' })
    acquireWakeLock()

    const waitIfPaused = async () => {
      if (!pauseRef.current.requested) return
      await releaseWakeLock()
      setSession((current) => ({ ...current, status: 'paused', message: '已安全暂停' }))
      await new Promise((resolve) => {
        pauseRef.current.resume = resolve
      })
      pauseRef.current.resume = null
      if (controller.signal.aborted) throw new DOMException('Run stopped', 'AbortError')
    }

    try {
      if (settings.publishToLeaderboard) {
        try {
          leaderboardSession = await createLeaderboardSession(settings.leaderboardApiUrl, settings)
          latestLogs = [{ id: `board-${Date.now()}`, label: '排行榜', value: '运行票据已签发' }]
        } catch (error) {
          latestLogs = [{ id: `board-${Date.now()}`, label: '排行榜未连接', value: error.message }]
        }
      }

      for (let iteration = 0; ; iteration += 1) {
        if (controller.signal.aborted) throw new DOMException('Run stopped', 'AbortError')
        await waitIfPaused()
        if (maxRounds && totals.rounds >= maxRounds) {
          finalStatus = 'limited'
          finalMessage = `已达到 ${maxRounds} 轮运行限制`
          break
        }
        if (maxDurationMs && Date.now() - startedAt >= maxDurationMs) {
          finalStatus = 'limited'
          finalMessage = `已达到 ${formatDuration(maxDurationMs)} 运行限制`
          break
        }
        const inputReserve = calibratedInput
          ? Math.ceil(calibratedInput * 1.05 + 8)
          : guardedPromptEstimate(settings.systemPrompt, prompt)
        let maxOutput

        if (settings.targetMode === 'tokens') {
          const remaining = target - totals.tokens
          maxOutput = Math.min(batchSize, Math.floor(remaining - inputReserve))
          if (remaining <= 0) break
          if (maxOutput < 1) {
            finalStatus = 'guarded'
            finalMessage = `已触发上限保护，剩余 ${formatTokens(remaining)} token 小于下一轮安全预留`
            break
          }
        } else {
          if (!runPrice.output || (!runPrice.input && !runPrice.output)) {
            throw new Error('金额模式需要有效的模型输入与输出价格')
          }
          const remaining = target - totals.cost
          const inputCostReserve = inputReserve * runPrice.input
          maxOutput = Math.min(batchSize, Math.floor((remaining - inputCostReserve) / runPrice.output))
          if (remaining <= 0) break
          if (maxOutput < 1) {
            finalStatus = 'guarded'
            finalMessage = `已触发金额保护，余额 ${formatMoney(remaining)} 不足以安全发起下一轮`
            break
          }
        }

        setSession((current) => ({ ...current, message: `第 ${iteration + 1} 轮请求中，输出上限 ${formatTokens(maxOutput)}` }))
        let outputPreview = ''
        let lastPaint = 0
        const result = await callProvider(settings, prompt, maxOutput, controller.signal, (delta) => {
          outputPreview = `${outputPreview}${delta}`.slice(-1200)
          const now = Date.now()
          if (now - lastPaint > 120) {
            lastPaint = now
            setSession((current) => ({ ...current, currentOutput: outputPreview }))
          }
        })

        calibratedInput = result.usage.input || calibratedInput
        const roundCost = estimateUsageCost(result.usage, runPrice)
        totals = {
          tokens: totals.tokens + result.usage.total,
          input: totals.input + result.usage.input,
          output: totals.output + result.usage.output,
          cost: totals.cost + roundCost,
          rounds: totals.rounds + 1,
          verifiedRounds: totals.verifiedRounds + (result.usage.verified ? 1 : 0),
        }
        latestLogs = [
          ...latestLogs,
          {
            id: `${iteration}-${Date.now()}`,
            label: `第 ${iteration + 1} 轮${result.usage.verified ? '' : '（估算）'}`,
            value: `+${formatTokens(result.usage.total)} / ${formatMoney(roundCost)}`,
          },
        ].slice(-20)

        writeRunCheckpoint({
          id: runId,
          date: todayKey(new Date(startedAt)),
          startedAt,
          provider: settings.provider,
          model: settings.model,
          promptId: settings.promptId,
          ...totals,
          pricing: runPricingSnapshot,
        })

        setSession((current) => ({
          ...current,
          ...totals,
          logs: latestLogs,
          currentOutput: result.text.slice(-1200),
          message: `第 ${iteration + 1} 轮完成，已回收 usage`,
        }))

        if (settings.targetMode === 'tokens' && totals.tokens >= target) {
          if (totals.tokens > target) {
            finalStatus = 'exceeded'
            finalMessage = `供应商实际分词超出软上限 ${formatTokens(totals.tokens - target)} token`
          }
          break
        }
        if (settings.targetMode === 'money' && totals.cost >= target) {
          if (totals.cost > target) {
            finalStatus = 'exceeded'
            finalMessage = `实际估算超出目标 ${formatMoney(totals.cost - target)}`
          }
          break
        }

        await waitIfPaused()
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        finalStatus = 'stopped'
        finalMessage = '已停止。在途请求可能已被供应商计费，但未返回最终 usage'
      } else if (error.providerBlock) {
        finalStatus = 'blocked'
        finalMessage = providerBlockedMessage()
        onProviderBlocklistChange?.(readProviderBlocklist())
      } else if (error.outcomeUnknown) {
        finalStatus = 'unknown'
        finalMessage = error.message
      } else {
        finalStatus = 'error'
        finalMessage = error.message
      }
    } finally {
      abortRef.current = null
      pauseRef.current.resume?.()
      pauseRef.current = { requested: false, resume: null, reason: '' }
      releaseWakeLock()
      const endedAt = Date.now()
      setSession((current) => ({ ...current, ...totals, status: finalStatus, endedAt, message: finalMessage, logs: latestLogs }))
      if (totals.rounds > 0) {
        const run = {
          id: runId,
          date: todayKey(new Date(startedAt)),
          startedAt,
          duration: endedAt - startedAt,
          provider: settings.provider,
          model: settings.model,
          promptId: settings.promptId,
          tokens: totals.tokens,
          input: totals.input,
          output: totals.output,
          cost: totals.cost,
          rounds: totals.rounds,
          verified: totals.rounds === totals.verifiedRounds,
          status: finalStatus,
          pricing: runPricingSnapshot,
        }
        saveRun(run)
        clearRunCheckpoint()
        if (leaderboardSession && run.verified) {
          submitLeaderboardRun(settings.leaderboardApiUrl, leaderboardSession, run)
            .then((result) => {
              if (!result) return
              onLeaderboardPublished?.(result)
              setSession((current) => ({
                ...current,
                logs: [...current.logs, { id: `board-${Date.now()}`, label: '排行榜', value: '已发布' }].slice(-20),
              }))
            })
            .catch((error) => {
              setSession((current) => ({
                ...current,
                logs: [...current.logs, { id: `board-${Date.now()}`, label: '排行榜发布失败', value: error.message }].slice(-20),
              }))
            })
        }
      } else {
        clearRunCheckpoint()
      }
    }
  }

  const stopRun = useCallback(() => {
    setSession((current) => ({ ...current, status: 'stopping', message: '正在中止当前请求' }))
    abortRef.current?.abort()
    pauseRef.current.resume?.()
    pauseRef.current.resume = null
  }, [])

  const resetSession = useCallback(() => setSession(INITIAL_SESSION), [])

  return {
    session,
    startRun,
    requestPause,
    resumeRun,
    stopRun,
    resetSession,
    acquireWakeLock,
  }
}
