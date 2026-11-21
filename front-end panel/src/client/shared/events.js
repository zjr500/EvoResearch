import { arrayField, taskPath } from './api.js'

export const eventTypes = ['run_status', 'log', 'metric', 'decision', 'alert', 'finish']

export function mergeEvents(previous, incoming, taskId) {
  const events = new Map(previous.map((event) => [event.seq, event]))
  for (const event of incoming) {
    if (String(event.taskId) !== String(taskId) || !Number.isSafeInteger(event.seq) || event.seq < 1 || !eventTypes.includes(event.type)) throw new Error('事件字段不符合契约，请核对 taskId、seq 和 type。')
    events.set(event.seq, event)
  }
  return [...events.values()].sort((a, b) => a.seq - b.seq)
}

export async function loadHistory(api, id, signal) {
  let events = []
  let cursor
  const seen = new Set()
  do {
    const result = arrayField(await api.request(`${taskPath(id)}/events`, { signal, params: { cursor, limit: 100 } }), 'events')
    events = mergeEvents(events, result.events, id)
    cursor = result.next_cursor
    if (cursor && seen.has(cursor)) throw new Error('事件分页游标重复，已停止回放。')
    seen.add(cursor)
  } while (cursor)
  return events
}
