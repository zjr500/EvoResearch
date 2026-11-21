export function Feedback({ state }) {
  if (state.loading || state.busy) return <p role="status" className="message">正在加载…</p>
  if (state.error) return <div role="alert" className="error message">{state.error} {state.refresh && <button onClick={state.refresh}>重试</button>}</div>
  return state.message ? <p role="status" className="message">{state.message}</p> : null
}

export function Pager({ cursors, next, onChange }) {
  if (cursors.length === 1 && !next) return null
  return <nav className="pager" aria-label="分页">
    <button disabled={cursors.length === 1} onClick={() => onChange(cursors.slice(0, -1))}>上一页</button>
    <span>第 {cursors.length} 页</span>
    <button disabled={!next} onClick={() => onChange([...cursors, next])}>下一页</button>
  </nav>
}

export function ObjectView({ value }) {
  if (value === null || value === undefined) return <span className="muted">未提供</span>
  if (typeof value !== 'object') return <span className="prewrap">{String(value)}</span>
  return <pre>{JSON.stringify(value, null, 2)}</pre>
}

export function Value({ children }) { return <>{children ?? '—'}</> }
