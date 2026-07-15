import { formatMoney, formatTokens } from './format.js'

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  ctx.fill()
}

export function exportShareCard({ todayTokens, totalTokens, totalCost, participantLabel, globalRank, tier }) {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 900
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#f2eee6'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#df593a'
  ctx.fillRect(0, 0, 18, canvas.height)

  ctx.fillStyle = '#23211d'
  ctx.font = '600 30px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillText('TOKEN KILLER', 108, 115)
  ctx.font = '500 24px ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillStyle = '#716c63'
  ctx.fillText('TOKEN 消耗报告', 108, 158)

  ctx.fillStyle = '#e6dfd4'
  roundedRect(ctx, 104, 230, 1392, 2, 1)

  ctx.fillStyle = '#23211d'
  ctx.font = '700 128px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillText(formatTokens(todayTokens), 104, 430)
  ctx.font = '500 30px ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillStyle = '#716c63'
  ctx.fillText('今日无意义消耗 TOKEN', 110, 490)

  const items = [
    ['累计消耗', formatTokens(totalTokens)],
    ['估算成本', formatMoney(totalCost)],
    ['当前排位', `${globalRank ? `全球 #${globalRank}` : '冲击全球榜'} / ${tier?.fullName || '火种 III'}`],
  ]
  items.forEach(([label, value], index) => {
    const x = 108 + index * 460
    ctx.fillStyle = '#e9e3d9'
    roundedRect(ctx, x, 590, 410, 170, 24)
    ctx.fillStyle = '#716c63'
    ctx.font = '500 22px ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillText(label, x + 32, 642)
    ctx.fillStyle = '#23211d'
    ctx.font = '650 36px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText(value, x + 32, 708)
  })

  ctx.fillStyle = '#716c63'
  ctx.font = '500 20px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillText(new Date().toLocaleDateString('zh-CN'), 108, 838)
  ctx.textAlign = 'right'
  ctx.fillText(participantLabel, 1492, 838)

  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = `token-killer-${new Date().toISOString().slice(0, 10)}.png`
  link.click()
}
