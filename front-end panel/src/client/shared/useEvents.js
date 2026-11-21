import { useEffect, useState } from 'react'
import { eventTypes, loadHistory, mergeEvents } from './events.js'
import { taskPath } from './api.js'

export function useEvents(api, taskId) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ events: [], status: '未连接' })
  useEffect(() => {
    const update = (next) => setState({ ...next, taskId })
    if (!taskId) { update({ events: [], status: '未选择任务' }); return }
    const controller = new AbortController()
    let source
    let events = []
    update({ events, status: '读取历史事件', loading: true })
    loadHistory(api, taskId, controller.signal).then((history) => {
      if (controller.signal.aborted) return
      events = history
      source = api.openEvents(`${taskPath(taskId)}/events/stream`, { since: events.at(-1)?.seq ?? 0 })
      update({ events, status: '正在连接实时事件' })
      const connected = source.debug ? '本地事件流已连接' : '实时事件已连接'
      source.onopen = () => update({ events, status: connected })
      source.onerror = () => update({ events, status: '实时连接中断，正在重连', error: '请检查事件推送接口或登录状态。' })
      for (const type of eventTypes) source.addEventListener(type, (message) => {
        try {
          const event = JSON.parse(message.data)
          if (event.type !== type || String(event.seq) !== message.lastEventId) throw new Error('SSE 的 id、event 与 data 不一致。')
          events = mergeEvents(events, [event], taskId)
          update({ events, status: connected })
        } catch (error) {
          source.close()
          update({ events, status: '事件解析失败', error: error.message })
        }
      })
    }).catch((error) => {
      if (!controller.signal.aborted) update({ events, status: '事件接口未连接', error: error.message })
    })
    return () => { controller.abort(); source?.close() }
  }, [api, taskId, attempt])
  // Never show the previous task's history while the next effect starts.
  const visible = state.taskId === taskId ? state : { events: [], status: taskId ? '读取历史事件' : '未选择任务', loading: Boolean(taskId) }
  return { ...visible, refresh: () => setAttempt((value) => value + 1) }
}
