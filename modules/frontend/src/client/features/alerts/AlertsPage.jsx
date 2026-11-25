import { useEffect, useState } from 'react'
import { alertsApi } from './api.js'
import { useEventRevision, useMutation, useResource } from '../../shared/hooks.js'
import { Feedback, ObjectView, StatusBadge } from '../../shared/ui.jsx'

export function AlertsPage({ api, taskId, stream }) {
  const rules = useResource((signal) => alertsApi.rules(api, taskId, signal), [api, taskId])
  const stop = useMutation()
  const [followingStop, setFollowingStop] = useState(false)
  const [poll, setPoll] = useState(0)
  const revision = useEventRevision(stream.events)
  const task = useResource((signal) => alertsApi.task(api, taskId, signal), [api, taskId, poll, revision])
  const terminal = ['已终止', '已完成'].includes(task.data?.status)
  useEffect(() => {
    if (!followingStop || terminal) return
    const timer = setTimeout(() => setPoll((value) => value + 1), 3000)
    return () => clearTimeout(timer)
  }, [followingStop, terminal, poll])
  async function stopTask() {
    if (!window.confirm('确认请求终止当前实验？远端确认后会更新状态。')) return
    const result = await stop.run(`stop:${taskId}`, (key, signal) => alertsApi.stop(api, taskId, key, signal))
    // An interrupted response may still have reached the server.
    setFollowingStop(true)
    if (result !== null) task.refresh()
  }
  const events = stream.events.filter((event) => event.type === 'alert')
  return <>
    <section className="card">
      <div className="section-head"><h2>预警规则</h2><button className="quiet" onClick={rules.refresh}>重新读取</button></div>
      <Feedback state={rules} />
      {rules.data && <RulesEditor key={JSON.stringify(rules.data)} api={api} taskId={taskId} initial={rules.data.rules} onSaved={rules.refresh} />}
    </section>
    <section className="card">
      <h2>远程终止</h2>
      <Feedback state={task} />
      <p className="task-status">任务状态 <StatusBadge>{task.data?.status ?? '等待后端返回'}</StatusBadge></p>
      <div className="toolbar"><button className="danger" disabled={!task.data || stop.busy || terminal || task.data.status === '终止确认中'} onClick={stopTask}>请求终止实验</button><button onClick={task.refresh}>刷新状态</button></div>
      <Feedback state={stop} />
      {followingStop && !terminal && <p className="muted">正在向后端核对任务状态。</p>}
    </section>
    <section className="card"><h2>预警记录</h2><Feedback state={stream} />
      {!stream.loading && !stream.error && !events.length && <p className="empty">当前任务尚无预警事件。</p>}
      {events.map((event) => <details key={event.seq}><summary>预警 {event.seq} · 运行 {event.runId ?? '—'}</summary><ObjectView value={event.payload} /></details>)}
    </section>
  </>
}

function RulesEditor({ api, taskId, initial, onSaved }) {
  const [rules, setRules] = useState(() => initial.map((rule) => ({
    direction: 'above', split: 'val', repeat_policy: 'once', channel: '界面弹窗', enabled: true, ...rule,
  })))
  const save = useMutation()
  const [validation, setValidation] = useState('')
  function change(index, key, value) { setRules(rules.map((rule, i) => i === index ? { ...rule, [key]: value } : rule)) }
  function add() {
    setRules([...rules, { metric: '', threshold: '', direction: 'above', split: 'val', repeat_policy: 'once', channel: '界面弹窗', enabled: true }])
  }
  async function submit(event) {
    event.preventDefault()
    if (rules.some((rule) => !rule.metric.trim() || rule.threshold === '' || !Number.isFinite(Number(rule.threshold)) ||
      (rule.repeat_policy === 'interval' && (!Number.isInteger(Number(rule.interval_seconds)) || Number(rule.interval_seconds) < 1)))) {
      setValidation('请填写指标、有效阈值和周期秒数。'); return
    }
    if (!rules.length && !window.confirm('保存后将清空当前任务的全部预警规则，确认继续？')) return
    setValidation('')
    const body = rules.map((rule) => {
      const result = {
        metric: rule.metric.trim(), threshold: Number(rule.threshold), direction: rule.direction,
        split: rule.split, repeat_policy: rule.repeat_policy, channel: rule.channel, enabled: rule.enabled,
      }
      if (rule.rule_id != null) result.rule_id = rule.rule_id
      if (rule.repeat_policy === 'interval') result.interval_seconds = Number(rule.interval_seconds)
      return result
    })
    const result = await save.run(JSON.stringify([taskId, body]), (key, signal) => alertsApi.save(api, taskId, body, key, signal))
    if (result !== null) onSaved()
  }
  return <form className="form" onSubmit={submit}>
    {!rules.length && <p className="empty">尚未设置预警规则。</p>}
    {rules.map((rule, index) => <fieldset key={index} disabled={save.busy} className="rule">
      <legend>规则 {rule.rule_id ?? index + 1}</legend>
      <div className="form-grid">
        <label>指标名称<input required value={rule.metric} onChange={(event) => change(index, 'metric', event.target.value)} /></label>
        <label>阈值<input required type="number" step="any" value={rule.threshold} onChange={(event) => change(index, 'threshold', event.target.value)} /></label>
        <label>触发方向<select value={rule.direction} onChange={(event) => change(index, 'direction', event.target.value)}><option value="above">高于阈值</option><option value="below">低于阈值</option></select></label>
        <label>数据划分<select value={rule.split} onChange={(event) => change(index, 'split', event.target.value)}><option value="train">训练集</option><option value="val">验证集</option><option value="test">测试集（认证后）</option></select></label>
        <label>提醒频率<select value={rule.repeat_policy} onChange={(event) => change(index, 'repeat_policy', event.target.value)}><option value="once">仅一次</option><option value="every">每次命中</option><option value="interval">按周期</option></select></label>
        {rule.repeat_policy === 'interval' && <label>周期秒数<input required type="number" min="1" step="1" value={rule.interval_seconds ?? ''} onChange={(event) => change(index, 'interval_seconds', event.target.value)} /></label>}
        <label>通知方式<select value={rule.channel} onChange={(event) => change(index, 'channel', event.target.value)}><option value="界面弹窗">界面弹窗</option><option value="邮件">邮件</option></select></label>
      </div>
      <div className="toolbar"><label className="inline"><input type="checkbox" checked={rule.enabled} onChange={(event) => change(index, 'enabled', event.target.checked)} />启用规则</label><button type="button" onClick={() => setRules(rules.filter((_, i) => i !== index))}>移除</button></div>
    </fieldset>)}
    {validation && <p role="alert" className="error">{validation}</p>}
    <div className="toolbar"><button type="button" disabled={save.busy} onClick={add}>添加规则</button><button className="primary" type="submit" disabled={save.busy}>保存全部规则</button></div>
    <Feedback state={save} />
  </form>
}
