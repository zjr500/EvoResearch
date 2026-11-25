// Preserve seed boundaries so separate repetitions never become one line.
export function chartLines(series) {
  const lines = []
  const allPoints = series.flatMap((item) => item.points)
  const axis = allPoints.every((point) => Number.isFinite(point.epoch)) ? 'epoch' : 'global_step'
  if (!allPoints.every((point) => Number.isFinite(point[axis]))) return lines
  for (const item of series) {
    const seeds = new Map()
    for (const point of item.points) {
      const x = point[axis]
      if (!Number.isFinite(x) || !Number.isFinite(point.value)) continue
      const seed = point.seed ?? '未指定'
      if (!seeds.has(seed)) seeds.set(seed, [])
      seeds.get(seed).push({ x, y: point.value })
    }
    for (const [seed, points] of seeds) lines.push({
      label: `运行 ${item.runId} · seed ${seed}`,
      axis,
      points: points.sort((a, b) => a.x - b.x),
    })
  }
  return lines
}
