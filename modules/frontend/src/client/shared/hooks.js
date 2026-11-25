import { useEffect, useRef, useState } from 'react'

export function useResource(load, dependencies) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ loading: true })
  const signature = JSON.stringify([...dependencies, attempt])
  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true, signature })
    Promise.resolve().then(() => load(controller.signal)).then(
      (data) => { if (!controller.signal.aborted) setState({ data, signature }) },
      (error) => { if (!controller.signal.aborted) setState({ error: error.message, signature }) },
    )
    return () => controller.abort()
  }, [...dependencies, attempt])
  const current = state.signature === signature ? state : { loading: true }
  return { ...current, refresh: () => setAttempt((value) => value + 1) }
}

export function useMutation() {
  const [state, setState] = useState({ busy: false })
  const pending = useRef(null)
  const active = useRef(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++; active.current?.abort() }, [])
  async function run(identity, operation) {
    if (active.current) return null
    if (pending.current?.identity !== identity) pending.current = { identity, key: crypto.randomUUID() }
    const controller = new AbortController()
    const current = generation.current
    active.current = controller
    setState({ busy: true })
    try {
      const data = await operation(pending.current.key, controller.signal)
      if (generation.current !== current) return null
      pending.current = null
      setState({ busy: false, message: '操作成功' })
      return data
    } catch (error) {
      if (generation.current === current) setState({ busy: false, error: error.message })
      return null
    } finally { active.current = null }
  }
  return { ...state, run }
}

export function useEventRevision(events) {
  const [revision, setRevision] = useState(0)
  const timer = useRef(null)
  const seq = events.at(-1)?.seq
  useEffect(() => {
    if (seq === undefined || timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      setRevision((value) => value + 1)
    }, 1000)
  }, [seq])
  useEffect(() => () => clearTimeout(timer.current), [])
  return revision
}
