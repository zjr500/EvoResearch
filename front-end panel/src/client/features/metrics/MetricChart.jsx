import { useEffect, useRef } from 'react'
import { chartLines } from './chart.js'

const colors = ['#285cc4', '#a64a26', '#137765', '#7346a5', '#8c6318', '#a43671']
const nightColors = ['#90b5ff', '#ffad91', '#76d9bf', '#c7a5ff', '#f4c47c', '#f5a1ce']
const dashes = [[], [7, 4], [2, 4], [7, 3, 2, 3], [11, 5], [4, 4]]

export function MetricChart({ series, title }) {
  const ref = useRef(null)
  const lines = chartLines(series)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    function draw() {
      const width = canvas.clientWidth
      if (width < 100) return
      const height = canvas.clientHeight
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
      ctx.font = `12px ${computed.fontFamily}`
      ctx.fillStyle = computed.color
      ctx.strokeStyle = 'rgba(125,133,148,.24)'
      for (let tick = 0; tick < 5; tick++) {
        const value = y0 + (y1 - y0) * tick / 4
        ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke()
        ctx.fillText(value.toPrecision(3), 3, y(value) + 4)
      }
      ctx.fillText(String(x0), left, height - 8)
      ctx.textAlign = 'right'
      ctx.fillText(String(x1), right, height - 8)
      lines.forEach((line, index) => {
        ctx.strokeStyle = palette[index % palette.length]; ctx.fillStyle = ctx.strokeStyle
        ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
        ctx.setLineDash(dashes[index % dashes.length]); ctx.beginPath()
        line.points.forEach((point, i) => { if (i) ctx.lineTo(x(point.x), y(point.y)); else ctx.moveTo(x(point.x), y(point.y)) })
        ctx.stroke()
        for (const point of line.points) { ctx.beginPath(); ctx.arc(x(point.x), y(point.y), 2.5, 0, Math.PI * 2); ctx.fill() }
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
    <figcaption><span>{title}</span>{lines.length > 0 && <small className="tag" data-tone="neutral">横轴 {lines[0].axis}</small>}</figcaption>
    {lines.length ? <><canvas ref={ref} role="img" aria-label={`${title}，详细数值见下表`} />
      <div className="legend">{lines.map((line, index) => <span key={index}>
        <svg viewBox="0 0 24 10" width="24" height="10" aria-hidden="true" style={{ color: `light-dark(${colors[index % colors.length]}, ${nightColors[index % nightColors.length]})` }}><path d="M1 5h22" stroke="currentColor" strokeWidth="2" strokeDasharray={dashes[index % dashes.length].join(' ')} /></svg>
        {line.label}
      </span>)}</div>
    </> : <p className="empty">需要统一的 epoch 或 global_step 坐标才能绘图，具体数值见下表。</p>}
  </figure>
}
