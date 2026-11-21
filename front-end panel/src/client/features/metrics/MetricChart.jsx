import { useEffect, useRef } from 'react'
import { chartLines } from './chart.js'

const colors = ['#326bc8', '#bc4a31', '#207a66', '#7a4cb4', '#936514', '#b63d77']
const nightColors = ['#83baff', '#ffae96', '#71dbbf', '#c9a7ff', '#f5c274', '#ffa8cc']

export function MetricChart({ series, title }) {
  const ref = useRef(null)
  const lines = chartLines(series)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    function draw() {
      const width = canvas.clientWidth
      if (!width) return
      const height = 240
      const ratio = window.devicePixelRatio || 1
      canvas.width = width * ratio; canvas.height = height * ratio
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const computed = getComputedStyle(canvas)
      const palette = computed.colorScheme === 'dark' ? nightColors : colors
      ctx.scale(ratio, ratio)
      const points = lines.flatMap((line) => line.points)
      if (!points.length) return
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (const point of points) {
        x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x)
        y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y)
      }
      if (x0 === x1) x1 = x0 + 1
      if (y0 === y1) { y0 -= 0.5; y1 += 0.5 }
      const left = 62, right = width - 18, top = 16, bottom = height - 30
      const x = (value) => left + (value - x0) / (x1 - x0) * (right - left)
      const y = (value) => bottom - (value - y0) / (y1 - y0) * (bottom - top)
      ctx.font = '12px system-ui'
      ctx.fillStyle = computed.color
      ctx.strokeStyle = 'rgba(130,140,150,.35)'
      for (let tick = 0; tick < 5; tick++) {
        const value = y0 + (y1 - y0) * tick / 4
        ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke()
        ctx.fillText(value.toPrecision(3), 3, y(value) + 4)
      }
      ctx.fillText(String(x0), left, height - 8); ctx.fillText(String(x1), right - 25, height - 8)
      lines.forEach((line, index) => {
        ctx.strokeStyle = palette[index % palette.length]; ctx.fillStyle = ctx.strokeStyle
        ctx.lineWidth = 2; ctx.beginPath()
        line.points.forEach((point, i) => { if (i) ctx.lineTo(x(point.x), y(point.y)); else ctx.moveTo(x(point.x), y(point.y)) })
        ctx.stroke()
        for (const point of line.points) { ctx.beginPath(); ctx.arc(x(point.x), y(point.y), 3, 0, Math.PI * 2); ctx.fill() }
      })
    }
    const observer = new ResizeObserver(draw)
    const themeObserver = new MutationObserver(draw)
    observer.observe(canvas)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    const app = canvas.closest('.evo-app')
    if (app) themeObserver.observe(app, { attributes: true, attributeFilter: ['data-theme'] })
    draw()
    return () => { observer.disconnect(); themeObserver.disconnect() }
  }, [series])
  return <figure className="chart">
    <figcaption>{title}{lines.length > 0 && <small> · 横轴 {lines[0].axis}</small>}</figcaption>
    {lines.length ? <><canvas ref={ref} role="img" aria-label={`${title}，详细数值见下表`} style={{ width: '100%', height: 240 }} />
      <div className="legend">{lines.map((line, index) => <span key={index} style={{ color: `light-dark(${colors[index % colors.length]}, ${nightColors[index % nightColors.length]})` }}>{line.label}</span>)}</div>
    </> : <p className="empty">需要统一的 epoch 或 global_step 坐标才能绘图，具体数值见下表。</p>}
  </figure>
}
