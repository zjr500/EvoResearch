import { useState } from 'react'
import { arrayField } from './api.js'
import { useResource } from './hooks.js'
import { Feedback, Pager } from './ui.jsx'

export function TaskSelector({ api, taskId, onChange }) {
  const [cursors, setCursors] = useState([null])
  const [manual, setManual] = useState('')
  const tasks = useResource(async (signal) => arrayField(await api.request('experiments', { signal, params: { cursor: cursors.at(-1), limit: 20 } }), 'tasks'), [api, cursors.at(-1)])
  return <section className="card task-selector">
    <div className="toolbar">
      <label>实验任务 <select aria-label="选择实验任务" value={taskId} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择任务</option>
        {taskId && !tasks.data?.tasks.some((task) => String(task.taskId) === taskId) && <option value={taskId}>任务 {taskId}</option>}
        {tasks.data?.tasks.map((task) => <option key={task.taskId} value={task.taskId}>{task.title} · {task.status}</option>)}
      </select></label>
      <button onClick={tasks.refresh}>刷新任务</button>
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); if (/^[1-9]\d*$/.test(manual)) onChange(manual) }}>
        <input aria-label="直接输入任务编号" placeholder="直接输入任务编号" required pattern="[1-9][0-9]*" value={manual} onChange={(event) => setManual(event.target.value)} />
        <button type="submit">打开任务</button>
      </form>
    </div>
    <Feedback state={tasks} />
    {tasks.data?.tasks.length === 0 && <p className="muted">后端返回的任务列表为空。</p>}
    {tasks.data && <Pager cursors={cursors} next={tasks.data.next_cursor} onChange={setCursors} />}
  </section>
}
