import { useId, useState } from 'react'
import { PanelIcon } from './PanelIcon.jsx'

export function AppSettings({ prefix, onPrefix, theme, onTheme, debug, onDebug }) {
  const settingsId = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(prefix)
  const [error, setError] = useState('')
  function save(event) {
    event.preventDefault()
    try { onPrefix(draft.trim()); setError(''); setOpen(false) }
    catch (failure) { setError(failure.message) }
  }
  return <div className="workspace-tools">
    <div className="settings-row">
      {onDebug
        ? <label className="inline debug-control" data-tone={debug ? 'warning' : 'neutral'}><input type="checkbox" checked={debug} onChange={(event) => onDebug(event.target.checked)} />启用本地调试数据</label>
        : <span className="source-pill"><i aria-hidden="true" />真实接口模式</span>}
      <div className="settings-actions">
        <label className="theme-control">外观 <select aria-label="面板外观" value={theme} onChange={(event) => onTheme(event.target.value)}>
          <option value="dsh">跟随 DSH</option><option value="light">浅色</option><option value="dark">夜间</option>
        </select></label>
        <button className="settings-toggle" type="button" aria-expanded={open} aria-controls={settingsId} onClick={() => { setDraft(prefix); setError(''); setOpen(!open) }}>
          <PanelIcon name="settings" />接口设置
        </button>
      </div>
    </div>
    <div id={settingsId} hidden={!open} className="card settings-card">
      <form className="toolbar" onSubmit={save}>
        <label>同源接口前缀<input aria-label="接口前缀" placeholder="evoresearch/api/" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
        <button className="primary" type="submit">应用</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
    {debug && <p className="debug-banner" role="status"><PanelIcon name="info" /><span>正在使用本地样例。所有修改只在内存中，关闭调试或刷新后恢复。</span></p>}
  </div>
}
