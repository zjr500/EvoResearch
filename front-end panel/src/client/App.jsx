import { useMemo, useState } from 'react'
import { apiBase, createApi } from './shared/api.js'
import { TaskSelector } from './shared/TaskSelector.jsx'
import { useEvents } from './shared/useEvents.js'
import { KnowledgePage } from './features/knowledge/KnowledgePage.jsx'
import { ProcessPage } from './features/process/ProcessPage.jsx'
import { MetricsPage } from './features/metrics/MetricsPage.jsx'
import { AlertsPage } from './features/alerts/AlertsPage.jsx'
import { ExperimentSetupPage } from './features/experiment-setup/ExperimentSetupPage.jsx'
import { KnowledgeGraphPage } from './features/knowledge-graph/KnowledgeGraphPage.jsx'
import { AppSettings } from './shell/AppSettings.jsx'
import { PanelIcon } from './shell/PanelIcon.jsx'
import { createDebugApi } from '#debug-panel'

const panels = [
  { id: 'knowledge', title: '知识库', description: '浏览论文摘要与实验报告，整理你的研究资料。', Page: KnowledgePage },
  { id: 'setup', title: '实验提交', description: '实验任务的填写、确认与启动入口。', Page: ExperimentSetupPage },
  { id: 'process', title: '实验过程', description: '查看运行轮次、决策和实验日志。', Page: ProcessPage, usesTask: true },
  { id: 'metrics', title: '指标图表', description: '比较不同运行的指标，跟踪候选方案和认证结果。', Page: MetricsPage, usesTask: true },
  { id: 'alerts', title: '预警与终止', description: '管理预警规则，查看记录与任务状态。', Page: AlertsPage, usesTask: true },
  { id: 'graph', title: '知识图谱', description: '查看研究条目之间的关联。', Page: KnowledgeGraphPage },
]
const defaultPrefix = 'evoresearch/api/'
const themeKey = 'evoresearch.theme'

export function App() {
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
  const [panelId, setPanelId] = useState('knowledge')
  const panel = panels.find(({ id }) => id === panelId)
  const base = useMemo(() => {
    try { return apiBase(prefix, document.baseURI) } catch { return apiBase(defaultPrefix, document.baseURI) }
  }, [prefix])
  function applyPrefix(value) {
    apiBase(value, document.baseURI)
    setPrefix(value)
    try { localStorage.setItem('evoresearch.apiPrefix', value) } catch {}
  }
  function changeTheme(value) {
    setTheme(value)
    try { localStorage.setItem(themeKey, value) } catch {}
  }
  return <div className="evo-app" data-theme={theme}>
    <div className="app-inner">
      <header className="app-header">
        <p className="product"><span className="brand-icon"><PanelIcon name="brand" /></span>EvoResearch <span className="brand-caption">研究工作台</span></p>
        <h1>{panel.title}</h1>
        <p className="panel-description">{panel.description}</p>
      </header>
      <nav className="tabs main-tabs" aria-label="功能面板">
        {panels.map(({ id, title }) => <button key={id} aria-current={panel.id === id ? 'page' : undefined} onClick={() => setPanelId(id)}><PanelIcon name={id} />{title}</button>)}
      </nav>
      <AppSettings prefix={prefix} onPrefix={applyPrefix} theme={theme} onTheme={changeTheme} debug={debug} onDebug={createDebugApi && setDebug} />
      <Workspace key={debug ? 'local-debug' : base} base={debug ? apiBase(defaultPrefix, document.baseURI) : base} panel={panel} debug={debug} />
    </div>
  </div>
}

function Workspace({ base, panel: { Page, title, usesTask }, debug }) {
  const api = useMemo(() => debug && createDebugApi ? createDebugApi(base) : createApi(base), [debug, base])
  const [taskId, setTaskId] = useState('')
  const stream = useEvents(api, usesTask ? taskId : '')
  return <>
    {usesTask && <TaskSelector api={api} taskId={taskId} onChange={setTaskId} />}
    {usesTask && !taskId && <section className="card empty">选择实验任务后查看{title}。</section>}
    {usesTask && taskId && <div className="stream-status"><span role="status">{stream.status}</span><button onClick={stream.refresh}>重新连接</button></div>}
    {(!usesTask || taskId) && <Page key={usesTask ? taskId : undefined} api={api} taskId={taskId} stream={stream} />}
  </>
}
