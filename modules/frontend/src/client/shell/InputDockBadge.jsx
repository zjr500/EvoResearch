import { useEffect, useState } from 'react'
import { apiBase, createApi } from '../shared/api.js'

// 对话输入框停靠徽标：向用户表明知识库已接入当前对话。
// 只展示真实查询到的条目数；接口不可用时整体隐藏，不显示猜测内容。
export function InputDockBadge() {
  const [count, setCount] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    let api
    try { api = createApi(apiBase('/', document.baseURI)) } catch { return undefined }
    api.request('kb/entries', { params: { limit: 100 }, signal: controller.signal })
      .then((data) => {
        if (!Array.isArray(data?.entries)) return
        setCount(data.nextCursor ? '99+' : String(data.entries.length))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  if (count === null) return null
  return <span
    title="EvoResearch 知识库已接入对话，可在右侧工作台管理条目与引用。"
    style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: '12px', lineHeight: '18px', padding: '1px 8px',
      border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
      borderRadius: '999px', opacity: 0.75, userSelect: 'none',
    }}
  >知识库 · {count} 条</span>
}
