import { useState } from 'react'
import { processApi } from './api.js'
import { useEventRevision, useResource } from '../../shared/hooks.js'
import { Feedback, ObjectView, StatusBadge, Value } from '../../shared/ui.jsx'

const eventLabels = { run_status: '运行状态', log: '日志', metric: '指标', decision: '决策', alert: '预警', finish: '结束' }

export function ProcessPage({ api, taskId, stream }) {
  const [view, setView] = useState('timeline')
  const [run, setRun] = useState('')
  const [search, setSearch] = useState('')
  const revision = useEventRevision(stream.events)
  const runs = useResource((signal) => processApi.runs(api, taskId, signal), [api, taskId, revision])
  const events = stream.events.filter((event) =>
    (!run || String(event.runId) === run) &&
    (view === 'timeline' || (view === 'decision' ? event.type === 'decision' : event.type === 'log')) &&
    (!search || JSON.stringify(event.payload).toLowerCase().includes(search.toLowerCase())),
  )
  return <>
    <section className="card">
      <h2>实验轮次</h2><Feedback state={runs} />
      {runs.data && <div className="table-scroll"><table><thead><tr><th>轮次</th><th>运行编号</th><th>状态</th><th>调试深度</th><th>创建时间</th></tr></thead>
        <tbody>{runs.data.runs.map((item) => <tr key={item.run_id}><td>{item.round_no}</td><td>{item.run_id}</td><td><StatusBadge>{item.status}</StatusBadge></td><td><Value>{item.debug_depth}</Value></td><td>{item.created_at}</td></tr>)}</tbody>
      </table>{runs.data.runs.length === 0 && <p className="empty">这个任务尚无实验轮次。</p>}</div>}
    </section>
    <section className="card">
      <h2>实验事件</h2>
      <div className="toolbar event-filters">
        <div className="tabs" aria-label="过程视图">{[['timeline', '全流程时间线'], ['decision', '决策摘要'], ['logs', '实验日志']].map(([id, label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
        <label>运行编号<input aria-label="筛选运行编号" placeholder="全部运行" inputMode="numeric" value={run} onChange={(event) => setRun(event.target.value)} /></label>
        <label>搜索事件<input aria-label="筛选事件内容" placeholder="搜索内容或错误信息" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      </div>
      <Feedback state={stream} />
      {!stream.loading && !stream.error && events.length === 0 && <p className="empty">没有匹配的事件。</p>}
      <ol className="timeline">{events.map((event) => <li key={event.seq}>
        <details><summary><span className="tag" data-tone={event.type === 'alert' ? 'warning' : 'info'}>{eventLabels[event.type] ?? event.type}</span> {event.step ?? '任务事件'} <small>序号 {event.seq} · 运行 {event.runId ?? '—'} · {event.split ?? '—'}</small></summary>
          <ObjectView value={event.payload} />
        </details>
      </li>)}</ol>
    </section>
  </>
}
