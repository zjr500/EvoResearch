import { useMemo, useState } from 'react'
import { apiBase, createApi } from './shared/api.js'
import { AppSettings } from './shell/AppSettings.jsx'
import { PanelIcon } from './shell/PanelIcon.jsx'
import { KnowledgeWorkbench } from './features/knowledge/KnowledgeWorkbench.jsx'
import { ExperimentWorkbench } from './features/experiment/ExperimentWorkbench.jsx'
import { workbenchStyles } from './workbench-styles.js'
import { createDebugApi } from '#debug-panel'

// 后端正式路由挂载在 DSH 同源根路径（/papers、/kb、/models、/operations）。
const defaultPrefix = '/'
const themeKey = 'evoresearch.theme'

const entries = [
  { id: 'experiment', title: '实验', icon: 'process' },
  { id: 'knowledge', title: '知识库', icon: 'knowledge' },
]

export function Workbench() {
  const [entry, setEntry] = useState('knowledge')
  const [prefix, setPrefix] = useState(() => {
    try { return localStorage.getItem('evoresearch.apiPrefix') || defaultPrefix } catch { return defaultPrefix }
  })
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem(themeKey)
      return ['light', 'dark'].includes(stored) ? stored : 'dsh'
    } catch { return 'dsh' }
  })
  const [debug, setDebug] = useState(false)
  const base = useMemo(() => {
    try { return apiBase(prefix, document.baseURI) } catch { return apiBase(defaultPrefix, document.baseURI) }
  }, [prefix])
  const api = useMemo(() => debug && createDebugApi ? createDebugApi(base) : createApi(base), [debug, base])

  function applyPrefix(value) {
    apiBase(value, document.baseURI)
    setPrefix(value)
    try { localStorage.setItem('evoresearch.apiPrefix', value) } catch {}
  }
  function changeTheme(value) {
    setTheme(value)
    try { localStorage.setItem(themeKey, value) } catch {}
  }

  return <div className="evo-wb" role="region" aria-label="EvoResearch 研究工作台" data-theme={theme}>
    <style>{workbenchStyles}</style>
    <header className="wb-header">
      <span className="wb-brand"><PanelIcon name="brand" /><strong>EvoResearch</strong></span>
      <nav className="wb-entries" aria-label="工作台入口">
        {entries.map(({ id, title, icon }) => (
          <button type="button" key={id} aria-current={entry === id ? 'page' : undefined}
            onClick={() => setEntry(id)}><PanelIcon name={icon} /><span>{title}</span></button>
        ))}
      </nav>
      <AppSettings prefix={prefix} onPrefix={applyPrefix} theme={theme} onTheme={changeTheme}
        debug={debug} onDebug={createDebugApi && setDebug} />
    </header>
    {debug && <p className="debug-banner" role="status"><PanelIcon name="info" /><span>正在使用本地样例。所有修改只在内存中，关闭调试或刷新后恢复。</span></p>}
    <div className="wb-body" key={`${entry}:${debug}`}>
      {entry === 'knowledge'
        ? <KnowledgeWorkbench api={api} debug={debug} />
        : <ExperimentWorkbench api={api} debug={debug} />}
    </div>
  </div>
}
