import { useState } from 'react'
import { metricsApi } from './api.js'
import { MetricChart } from './MetricChart.jsx'
import { useEventRevision, useResource } from '../../shared/hooks.js'
import { Feedback, Pager, StatusBadge, Value } from '../../shared/ui.jsx'

export function MetricsPage({ api, taskId, stream }) {
  const [params, setParams] = useState({ runId: '', name: '', split: 'val' })
  const [filters, setFilters] = useState(params)
  const [cursors, setCursors] = useState([null])
  const revision = useEventRevision(stream.events)
  const metrics = useResource((signal) => metricsApi.series(api, taskId, filters, signal), [api, taskId, JSON.stringify(filters), revision])
  const candidates = useResource((signal) => metricsApi.candidates(api, taskId, cursors.at(-1), signal), [api, taskId, cursors.at(-1), revision])
  const certification = useResource((signal) => metricsApi.certification(api, taskId, signal), [api, taskId, revision])
  const groups = new Map()
  for (const series of metrics.data?.series ?? []) {
    const key = `${series.name} · ${series.split}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(series)
  }
  return <>
    <section className="card">
      <div className="section-head"><h2>指标趋势</h2><button className="quiet" type="button" onClick={metrics.refresh}>刷新</button></div>
      <form className="toolbar metric-filters" onSubmit={(event) => { event.preventDefault(); setFilters({ ...params }) }}>
        <label>指标名称<input aria-label="指标名称" placeholder="全部指标" value={params.name} onChange={(event) => setParams({ ...params, name: event.target.value })} /></label>
        <label>运行编号<input aria-label="指标运行编号" placeholder="全部运行" inputMode="numeric" value={params.runId} onChange={(event) => setParams({ ...params, runId: event.target.value })} /></label>
        <label>数据划分<select aria-label="数据划分" value={params.split} onChange={(event) => setParams({ ...params, split: event.target.value })}>
          <option value="val">验证集</option><option value="train">训练集</option><option value="test">测试集（认证后可见）</option>
        </select></label>
        <button className="primary" type="submit">查询</button>
      </form>
      <Feedback state={metrics} />
      {metrics.data?.series.length === 0 && <p className="empty">没有符合条件的指标。</p>}
      {[...groups].map(([key, series]) => <MetricChart key={key} title={key} series={series} />)}
      {metrics.data && <details><summary>查看原始数值</summary><div className="table-scroll"><table>
        <thead><tr><th>运行</th><th>指标</th><th>划分</th><th>epoch</th><th>global_step</th><th>seed</th><th>数值</th><th>记录时间</th></tr></thead>
        <tbody>{metrics.data.series.flatMap((item, i) => item.points.map((point, j) => <tr key={`${i}-${j}`}><td>{item.runId}</td><td>{item.name}</td><td>{item.split}</td><td><Value>{point.epoch}</Value></td><td><Value>{point.global_step}</Value></td><td><Value>{point.seed}</Value></td><td><Value>{point.value}</Value></td><td>{point.recorded_at}</td></tr>))}</tbody>
      </table></div></details>}
    </section>
    <section className="card"><h2>候选方案</h2><Feedback state={candidates} />
      {candidates.data && <><div className="table-scroll"><table><thead><tr><th>候选</th><th>运行</th><th>验证指标</th><th>标准差</th><th>种子数</th><th>认证状态</th><th>测试指标</th></tr></thead><tbody>
        {candidates.data.candidates.map((item) => <tr key={item.candidate_id}><td>{item.candidate_id}</td><td>{item.run_id}</td><td><Value>{item.val_metric_mean ?? item.val_metric}</Value></td><td><Value>{item.val_metric_std}</Value></td><td><Value>{item.seed_count}</Value></td><td><StatusBadge>{item.cert_status}</StatusBadge></td><td><Value>{item.test_metric}</Value></td></tr>)}
      </tbody></table></div>{!candidates.data.candidates.length && <p className="empty">尚无候选方案。</p>}<Pager cursors={cursors} next={candidates.data.next_cursor} onChange={setCursors} /></>}
    </section>
    <section className="card"><h2>认证进度</h2><Feedback state={certification} />
      {certification.data && <><dl className="stats">{[['total', '总数'], ['certified', '已认证'], ['failed', '失败'], ['pending', '待认证']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Value>{certification.data[key]}</Value></dd></div>)}</dl>
        <div className="table-scroll"><table><thead><tr><th>候选编号</th><th>认证状态</th><th>测试指标</th></tr></thead><tbody>{certification.data.items?.map((item) => <tr key={item.candidate_id}><td>{item.candidate_id}</td><td><StatusBadge>{item.cert_status}</StatusBadge></td><td><Value>{item.test_metric}</Value></td></tr>)}</tbody></table></div>
      </>}
    </section>
  </>
}
