import { PanelIcon } from '../shell/PanelIcon.jsx'

export function Feedback({ state }) {
  if (state.loading || state.busy) return <p role="status" className="message loading"><PanelIcon name="activity" />正在加载…</p>
  if (state.error) return <div role="alert" className="error message"><span><PanelIcon name="alerts" />{state.error}</span>{state.refresh && <button type="button" onClick={state.refresh}>重试</button>}</div>
  return state.message ? <p role="status" className="message">{state.message}</p> : null
}

export function EmptyState({ icon, title, description }) {
  return <div className="empty-state">
    <span className="empty-icon"><PanelIcon name={icon} /></span>
    <p><strong>{title}</strong></p>
    {description && <p>{description}</p>}
  </div>
}

export function StatusBadge({ children }) {
  if (!children) return <Value>{children}</Value>
  const tone = ['成功', '已完成', '已认证', '认证通过'].includes(children) ? 'success'
    : ['运行中', '调试中', '认证中'].includes(children) ? 'info'
    : ['待启动', '待认证', '终止确认中'].includes(children) ? 'warning'
    : ['失败', '启动失败', '认证失败'].includes(children) ? 'danger' : 'neutral'
  return <span className="status-badge" data-tone={tone}>{children}</span>
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
