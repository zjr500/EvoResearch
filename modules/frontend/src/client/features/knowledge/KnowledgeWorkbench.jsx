import { useRef, useState } from 'react'
import { useResource, useMutation } from '../../shared/hooks.js'
import { EmptyState, Feedback, StatusBadge } from '../../shared/ui.jsx'
import { PanelIcon } from '../../shell/PanelIcon.jsx'

// 知识库工作台：接入位置已定型，业务页面由成员在各自用例中补全。
// 列表/详情/导入对接真实 UC01 后端；语义检索、图谱、对话引用在骨架就位后接入。

async function waitOperation(api, operationId, signal) {
  for (let i = 0; i < 200; i++) {
    const op = await api.request(`kb/operations/${operationId}`, { signal })
    if (op.status === '成功') return op.result
    if (op.status === '失败') throw new Error(op.error_code ? `导入失败（${op.error_code}）` : '导入失败')
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (signal?.aborted) return null
  }
  throw new Error('导入超时，请在知识库列表确认结果')
}

export function KnowledgeWorkbench({ api }) {
  const [keyword, setKeyword] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [citation, setCitation] = useState('')
  const list = useResource(
    (signal) => api.request('kb/entries', { params: { limit: 50, keyword: submitted }, signal })
      .then((data) => data.entries ?? []),
    [submitted],
  )
  const detail = useResource(
    (signal) => selectedId ? api.request(`kb/entries/${selectedId}`, { signal }) : Promise.resolve(null),
    [selectedId],
  )
  const upload = useMutation()
  const fileInput = useRef(null)
  const [imports, setImports] = useState([])

  const entries = list.data ?? []
  const reportCount = entries.filter((entry) => entry.type === 'experiment_report').length
  const selected = entries.find((entry) => entry.document_id === selectedId) ?? null

  async function importFiles(fileList) {
    const files = [...fileList]
    if (!files.length) return
    setImports(files.map((file) => ({ name: file.name, state: '上传中' })))
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      try {
        const buffer = await file.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buffer)
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
        const operation = await api.request('papers', {
          method: 'POST', key: crypto.randomUUID(),
          body: { pdf_base64: btoa(binary) },
        })
        setImports((current) => current.map((item, i) => i === index ? { ...item, state: '解析与摘要中' } : item))
        const result = await waitOperation(api, operation.operation_id)
        const paper = result?.paper
        setImports((current) => current.map((item, i) => i === index
          ? { ...item, state: paper ? `待确认：${paper.title ?? file.name}` : '已处理' } : item))
      } catch (failure) {
        setImports((current) => current.map((item, i) => i === index ? { ...item, state: `失败：${failure.message}` } : item))
      }
    }
    list.refresh()
  }

  function cite(entry) {
    // 接入位置：UC14 将把选中条目注入 DSH 当前会话；骨架阶段先给出可核验的引用文本。
    const text = `[知识库条目 #${entry.document_id}] ${entry.title}`
    navigator.clipboard?.writeText(text).catch(() => {})
    setCitation(text)
  }

  return <div className="kb">
    <div className="kb-toolbar">
      <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
        <PanelIcon name="setup" />导入论文
      </button>
      <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden
        onChange={(event) => { importFiles(event.target.files); event.target.value = '' }} />
      {reportCount > 0 && <span className="reflow-badge" title="实验报告已回流到知识库">
        <PanelIcon name="activity" />回流报告 {reportCount}
      </span>}
      <form className="kb-search" onSubmit={(event) => { event.preventDefault(); setSubmitted(keyword.trim()) }}>
        <input aria-label="检索知识库" placeholder="检索论文、报告…" value={keyword}
          onChange={(event) => setKeyword(event.target.value)} />
        <button type="submit" aria-label="检索"><PanelIcon name="search" /></button>
      </form>
    </div>

    {imports.length > 0 && <section className="card imports" aria-label="导入结果">
      <header><strong>导入结果</strong><button type="button" className="quiet" onClick={() => setImports([])}>清除</button></header>
      <ul>{imports.map((item, index) => <li key={index}><span className="file-name">{item.name}</span><span className="muted">{item.state}</span></li>)}</ul>
      <p className="muted">草稿确认的完整界面属于 UC01 成员业务，此处为接入位置。</p>
    </section>}

    <Feedback state={{ ...list, loading: list.loading }} />
    <div className="kb-columns">
      <section className="card kb-list" aria-label="知识条目">
        <header><strong>知识条目{entries.length ? `（${entries.length}）` : ''}</strong></header>
        {!list.loading && !entries.length && !list.error &&
          <EmptyState icon="knowledge" title="知识库为空" description="导入论文并确认后，条目会出现在这里。" />}
        <ul>
          {entries.map((entry) => (
            <li key={entry.document_id}>
              <button type="button" className="kb-entry" aria-current={entry.document_id === selectedId}
                onClick={() => setSelectedId(entry.document_id)}>
                <PanelIcon name={entry.type === 'experiment_report' ? 'metrics' : 'knowledge'} />
                <span className="title">{entry.title}</span>
                <span className="muted">{entry.type === 'experiment_report' ? '实验报告' : '论文'}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card kb-detail" aria-label="条目详情">
        {!selected && <EmptyState icon="info" title="选择条目查看详情" description="图谱可视化与对话引用在对应用例中接入。" />}
        {selected && <>
          <header>
            <strong>{selected.title}</strong>
            <StatusBadge>{detail.data?.index_status === 'ready' ? '已索引' : '待同步'}</StatusBadge>
          </header>
          <Feedback state={detail} />
          {detail.data && <>
            <dl className="meta">
              <div><dt>类型</dt><dd>{detail.data.type === 'experiment_report' ? '实验报告' : '论文摘要'}</dd></div>
              <div><dt>入库时间</dt><dd>{detail.data.created_at}</dd></div>
              {detail.data.user_note && <div><dt>备注</dt><dd>{detail.data.user_note}</dd></div>}
            </dl>
            {detail.data.content?.summary && <p className="summary">{detail.data.content.summary}</p>}
            {detail.data.content?.abstract && <details><summary>原文摘要</summary><p className="summary">{detail.data.content.abstract}</p></details>}
            <div className="kb-actions">
              <button type="button" className="quiet" disabled title="UC03 图谱业务接入位置">
                <PanelIcon name="graph" />查看知识图谱
              </button>
              <button type="button" onClick={() => cite(selected)}>
                <PanelIcon name="chevron" />在对话中引用
              </button>
            </div>
            {citation && <p className="muted">已复制引用文本：{citation}（UC14 将直接注入当前会话）</p>}
          </>}
        </>}
      </section>
    </div>
  </div>
}
