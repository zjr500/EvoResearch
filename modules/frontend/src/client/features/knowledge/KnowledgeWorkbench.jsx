import { useEffect, useRef, useState } from 'react'
import { useResource } from '../../shared/hooks.js'
import { EmptyState, Feedback, ObjectView, Pager, StatusBadge } from '../../shared/ui.jsx'
import { PanelIcon } from '../../shell/PanelIcon.jsx'

// 知识库工作台：导入 → 待确认（编辑/重生成/确认）→ 条目检索与引用 的完整流程。
// 所有写操作经后端异步操作（202 + operation_id），结果以操作记录为准。

async function waitOperation(api, operationId, signal) {
  for (let i = 0; i < 200; i++) {
    const op = await api.request(`kb/operations/${operationId}`, { signal })
    if (op.status === '成功') return op.result
    if (op.status === '失败') throw new Error(op.error_message || `操作失败（${op.error_code ?? '未知错误'}）`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (signal?.aborted) return null
  }
  throw new Error('操作超时，请刷新列表确认实际结果')
}

function fileToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export function KnowledgeWorkbench({ api }) {
  const [keyword, setKeyword] = useState('')
  const [submitted, setSubmitted] = useState({ text: '', mode: 'keyword' })
  const [typeFilter, setTypeFilter] = useState('')
  const [cursors, setCursors] = useState([''])
  const [selectedId, setSelectedId] = useState(null)
  const [citations, setCitations] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [semanticHits, setSemanticHits] = useState(null)
  const [semanticError, setSemanticError] = useState('')

  const list = useResource(
    (signal) => api.request('kb/entries', {
      params: { limit: 20, keyword: submitted.mode === 'keyword' ? submitted.text : '', type: typeFilter, cursor: cursors.at(-1) }, signal,
    }),
    [submitted, typeFilter, cursors],
  )
  const entries = list.data?.entries ?? []
  const reportCount = entries.filter((entry) => entry.type === 'experiment_report').length

  async function runSemantic(event) {
    event.preventDefault()
    const query = keyword.trim()
    if (!query) return
    setSemanticError(''); setSemanticHits(null)
    try {
      const data = await api.request('kb/search', { method: 'POST', key: crypto.randomUUID(), body: { query, top_k: 10 } })
      setSemanticHits(data.items ?? [])
      setSubmitted({ text: query, mode: 'semantic' })
    } catch (error) { setSemanticError(error.message); setSubmitted({ text: query, mode: 'semantic' }) }
  }

  function cite(entry) {
    setCitations((current) => current.some((item) => item.document_id === entry.document_id)
      ? current : [...current, { document_id: entry.document_id, title: entry.title }])
  }

  return <div className="kb">
    <div className="kb-toolbar">
      <ImportButton api={api} onDone={() => { list.refresh() }} />
      <button type="button" className="quiet" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)}>
        <PanelIcon name="setup" />摘要模型
      </button>
      {reportCount > 0 && <span className="reflow-badge" title="实验报告已回流到知识库">
        <PanelIcon name="activity" />回流报告 {reportCount}
      </span>}
      <form className="kb-search" onSubmit={(event) => {
        event.preventDefault()
        setSemanticHits(null); setSemanticError('')
        setCursors(['']); setSubmitted({ text: keyword.trim(), mode: 'keyword' })
      }}>
        <input aria-label="检索知识库" placeholder="检索论文、报告…" value={keyword}
          onChange={(event) => setKeyword(event.target.value)} />
        <button type="submit" aria-label="关键词检索"><PanelIcon name="search" /></button>
        <button type="button" className="quiet" onClick={runSemantic}>语义检索</button>
      </form>
    </div>

    {settingsOpen && <ModelSettings api={api} />}

    {submitted.mode === 'semantic' && <section className="card" aria-label="语义检索结果">
      <header><strong>语义检索：{submitted.text}</strong>
        <button type="button" className="quiet" onClick={() => { setSemanticHits(null); setSemanticError(''); setSubmitted({ text: '', mode: 'keyword' }) }}>关闭</button>
      </header>
      {semanticError && <p className="error message" role="alert"><PanelIcon name="alerts" />{semanticError}</p>}
      {semanticHits && !semanticHits.length && <p className="muted">没有相关内容。</p>}
      {semanticHits && <ul className="kb-hits">
        {semanticHits.map((hit) => <li key={hit.entry_id}>
          <button type="button" className="kb-entry" onClick={() => setSelectedId(hit.entry_id)}>
            <PanelIcon name="knowledge" /><span className="title">{hit.title}</span>
            <span className="muted">相关度 {(hit.score * 100).toFixed(0)}%</span>
          </button>
        </li>)}
      </ul>}
    </section>}

    <PendingPapers api={api} onChanged={() => list.refresh()} />

    <Feedback state={{ ...list, loading: list.loading }} />
    <div className="kb-columns">
      <section className="card kb-list" aria-label="知识条目">
        <header>
          <strong>知识条目{entries.length ? `（${entries.length}）` : ''}</strong>
          <select aria-label="类型过滤" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setCursors(['']) }}>
            <option value="">全部类型</option>
            <option value="paper_summary">论文摘要</option>
            <option value="experiment_report">实验报告</option>
          </select>
        </header>
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
        <Pager cursors={cursors} next={list.data?.nextCursor} onChange={setCursors} />
      </section>

      <EntryDetail api={api} entryId={selectedId} onCite={cite} onChanged={() => list.refresh()} />
    </div>

    {citations.length > 0 && <footer className="citation-bar" aria-label="引用">
      <span className="muted">已选引用 {citations.length} 条：</span>
      <span className="citation-text">{citations.map((item) => `[知识库条目 #${item.document_id}] ${item.title}`).join('；')}</span>
      <button type="button" onClick={() => {
        navigator.clipboard?.writeText(citations.map((item) => `[知识库条目 #${item.document_id}] ${item.title}`).join('\n')).catch(() => {})
      }}><PanelIcon name="chevron" />复制</button>
      <button type="button" className="quiet" onClick={() => setCitations([])}>清空</button>
    </footer>}
  </div>
}

function ImportButton({ api, onDone }) {
  const fileInput = useRef(null)
  const [imports, setImports] = useState([])

  async function importFiles(fileList) {
    const files = [...fileList]
    if (!files.length) return
    setImports(files.map((file) => ({ name: file.name, state: '上传中' })))
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      try {
        const operation = await api.request('papers', {
          method: 'POST', key: crypto.randomUUID(),
          body: { pdf_base64: fileToBase64(await file.arrayBuffer()) },
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
    onDone()
  }

  return <>
    <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
      <PanelIcon name="setup" />导入论文
    </button>
    <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden
      onChange={(event) => { importFiles(event.target.files); event.target.value = '' }} />
    {imports.length > 0 && <section className="card imports" aria-label="导入进度">
      <header><strong>导入进度</strong><button type="button" className="quiet" onClick={() => setImports([])}>清除</button></header>
      <ul>{imports.map((item, index) => <li key={index}><span className="file-name">{item.name}</span><span className="muted">{item.state}</span></li>)}</ul>
    </section>}
  </>
}

function ModelSettings({ api }) {
  const view = useResource((signal) => api.request('models/summary', { signal }), [])
  const [mode, setMode] = useState('dsh-default')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const choice = view.data?.choice
    if (choice?.mode === 'selected') { setMode('selected'); setProvider(choice.provider ?? ''); setModel(choice.model ?? '') }
  }, [view.data])

  async function save() {
    setBusy(true); setError(''); setMessage('')
    try {
      const choice = mode === 'dsh-default' ? { mode: 'dsh-default' } : { mode: 'selected', provider, model }
      const operation = await api.request('models/summary', {
        method: 'PUT', key: crypto.randomUUID(),
        body: { model_choice: choice, expected_revision: view.data?.revision ?? 0 },
      })
      await waitOperation(api, operation.operation_id)
      setMessage('摘要模型配置已保存')
      view.refresh()
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  return <section className="card settings-card" aria-label="摘要模型配置">
    <header><strong>摘要模型</strong></header>
    <Feedback state={view} />
    {view.data && <>
      <p className="muted">当前：{view.data.choice
        ? (view.data.choice.mode === 'dsh-default' ? '跟随 DSH 默认模型' : `${view.data.choice.provider} / ${view.data.choice.model}`)
        : '未配置（跟随 DSH 默认模型）'}</p>
      <div className="settings-row">
        <label><input type="radio" name="summary-mode" checked={mode === 'dsh-default'} onChange={() => setMode('dsh-default')} /> 跟随 DSH 默认</label>
        <label><input type="radio" name="summary-mode" checked={mode === 'selected'} onChange={() => setMode('selected')} /> 指定模型</label>
      </div>
      {mode === 'selected' && <div className="settings-row">
        <input aria-label="Provider" placeholder="provider（在 DSH 设置中配置凭证）" value={provider} onChange={(event) => setProvider(event.target.value)} />
        <input aria-label="模型" placeholder="模型 ID" value={model} onChange={(event) => setModel(event.target.value)} />
      </div>}
      <div className="settings-row">
        <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存配置'}</button>
        {message && <span className="message">{message}</span>}
        {error && <span className="error message" role="alert">{error}</span>}
      </div>
    </>}
  </section>
}

function PendingPapers({ api, onChanged }) {
  const [cursors, setCursors] = useState([''])
  const [checked, setChecked] = useState(new Set())
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const list = useResource(
    (signal) => api.request('papers', { params: { status: '待确认', limit: 20, cursor: cursors.at(-1) }, signal }),
    [cursors],
  )
  const papers = list.data?.papers ?? []

  function refreshAll() { list.refresh(); onChanged() }

  async function runOperation(label, request) {
    setError(''); setNotice('')
    try {
      const operation = await request()
      const result = await waitOperation(api, operation.operation_id)
      setNotice(label)
      refreshAll()
      return result
    } catch (failure) { setError(failure.message); return null }
  }

  async function confirmOne(paper) {
    await runOperation(`已确认《${paper.title ?? '未命名论文'}》`, () =>
      api.request(`papers/${paper.paper_id}`, { method: 'PUT', key: crypto.randomUUID(), body: { expected_revision: paper.revision } }))
    setChecked((current) => { const next = new Set(current); next.delete(paper.paper_id); return next })
  }

  async function confirmBatch() {
    const selected = papers.filter((paper) => checked.has(paper.paper_id))
    if (!selected.length) return
    const result = await runOperation('', () => api.request('papers/confirm', {
      method: 'POST', key: crypto.randomUUID(),
      body: { paper_ids: selected.map((paper) => paper.paper_id), expected_revisions: Object.fromEntries(selected.map((paper) => [paper.paper_id, paper.revision])) },
    }))
    if (result?.items) {
      const failed = result.items.filter((item) => item.code !== 0)
      setNotice(failed.length
        ? `批量确认完成：成功 ${result.items.length - failed.length} 篇，失败 ${failed.length} 篇（${failed.map((item) => `#${item.paper_id} ${item.message}`).join('；')}）`
        : `批量确认完成：${result.items.length} 篇全部入库`)
    }
    setChecked(new Set())
  }

  async function regenerate(paper) {
    await runOperation(`已重新生成《${paper.title ?? '未命名论文'}》的摘要`, () =>
      api.request(`papers/${paper.paper_id}/summary`, { method: 'POST', key: crypto.randomUUID(), body: {} }))
  }

  if (!list.loading && !papers.length && !list.error) return null
  return <section className="card pending" aria-label="待确认论文">
    <header>
      <strong>待确认论文{papers.length ? `（${papers.length}）` : ''}</strong>
      <span className="settings-actions">
        {notice && <span className="message">{notice}</span>}
        <button type="button" className="primary" disabled={!checked.size} onClick={confirmBatch}>
          批量确认{checked.size ? `（${checked.size}）` : ''}
        </button>
      </span>
    </header>
    {error && <p className="error message" role="alert"><PanelIcon name="alerts" />{error}</p>}
    <Feedback state={{ ...list, loading: list.loading }} />
    <ul className="pending-list">
      {papers.map((paper) => <li key={paper.paper_id}>
        <label className="pending-check">
          <input type="checkbox" checked={checked.has(paper.paper_id)}
            onChange={(event) => setChecked((current) => {
              const next = new Set(current)
              if (event.target.checked) next.add(paper.paper_id); else next.delete(paper.paper_id)
              return next
            })} />
        </label>
        <div className="pending-main">
          <strong>{paper.title ?? '（未提取到标题）'}</strong>
          <span className="muted">
            {[paper.authors, paper.year, paper.summary_status === 'ready' ? '摘要已生成' : paper.summary_status === 'running' ? '摘要生成中' : paper.summary_status === 'failed' ? '摘要失败' : '未生成摘要'].filter(Boolean).join(' · ')}
          </span>
          {paper.summary_error && <span className="error">{paper.summary_error}</span>}
        </div>
        <span className="pending-actions">
          <button type="button" className="quiet" onClick={() => setEditing(editing === paper.paper_id ? null : paper.paper_id)}>
            {editing === paper.paper_id ? '收起' : '查看 / 编辑'}
          </button>
          <button type="button" className="quiet" onClick={() => regenerate(paper)}>重新生成摘要</button>
          <button type="button" onClick={() => confirmOne(paper)}>确认入库</button>
        </span>
        {editing === paper.paper_id && <PaperEditor api={api} paperId={paper.paper_id} onSaved={refreshAll} />}
      </li>)}
    </ul>
    <Pager cursors={cursors} next={list.data?.nextCursor} onChange={setCursors} />
  </section>
}

function PaperEditor({ api, paperId, onSaved }) {
  const detail = useResource((signal) => api.request(`papers/${paperId}`, { signal }), [paperId])
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!detail.data) return
    const paper = detail.data
    setForm({
      title: paper.title ?? '', authors: paper.authors ?? '', year: paper.year ?? '', abstract: paper.abstract ?? '',
      summary: paper.pending_summary ?? paper.summary ?? null,
      revision: paper.revision,
    })
  }, [detail.data])

  async function save() {
    setBusy(true); setError(''); setMessage('')
    try {
      const body = {
        expected_revision: form.revision,
        title: form.title || null, authors: form.authors || null,
        year: form.year === '' ? null : Number(form.year), abstract: form.abstract || null,
      }
      if (form.summary) body.summary = form.summary
      const operation = await api.request(`papers/${paperId}`, { method: 'PATCH', key: crypto.randomUUID(), body })
      await waitOperation(api, operation.operation_id)
      setMessage('已保存')
      onSaved()
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }

  if (detail.error) return <p className="error message" role="alert">{detail.error}</p>
  if (!form) return <p className="message loading">正在加载…</p>
  return <div className="paper-editor">
    <div className="settings-row"><label>标题<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label></div>
    <div className="settings-row">
      <label>作者<input value={form.authors} onChange={(event) => setForm({ ...form, authors: event.target.value })} /></label>
      <label>年份<input value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} /></label>
    </div>
    <label>摘要原文<textarea rows={3} value={form.abstract} onChange={(event) => setForm({ ...form, abstract: event.target.value })} /></label>
    {form.summary && <>
      <label>方法（生成的摘要，可修改）<textarea rows={2} value={form.summary.method ?? ''} onChange={(event) => setForm({ ...form, summary: { ...form.summary, method: event.target.value } })} /></label>
      <label>数据<textarea rows={2} value={form.summary.datasets ?? ''} onChange={(event) => setForm({ ...form, summary: { ...form.summary, datasets: event.target.value } })} /></label>
      <label>结论<textarea rows={2} value={form.summary.conclusions ?? ''} onChange={(event) => setForm({ ...form, summary: { ...form.summary, conclusions: event.target.value } })} /></label>
    </>}
    <PdfPreview api={api} paperId={paperId} />
    <div className="settings-row">
      <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存修改'}</button>
      {message && <span className="message">{message}</span>}
      {error && <span className="error message" role="alert">{error}</span>}
    </div>
  </div>
}

function PdfPreview({ api, paperId }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  async function open() {
    setError('')
    try {
      const response = await fetch(api.url(`papers/${paperId}/original`), { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`原文读取失败（HTTP ${response.status}）`)
      setUrl(URL.createObjectURL(await response.blob()))
    } catch (failure) { setError(failure.message) }
  }

  return <div className="pdf-block">
    {!url && <button type="button" className="quiet" onClick={open}><PanelIcon name="knowledge" />预览 / 下载原文 PDF</button>}
    {error && <span className="error message" role="alert">{error}</span>}
    {url && <>
      <div className="settings-row">
        <a className="quiet link-button" href={url} download={`paper-${paperId}.pdf`}>下载 PDF</a>
        <button type="button" className="quiet" onClick={() => { URL.revokeObjectURL(url); setUrl(null) }}>关闭预览</button>
      </div>
      <iframe className="pdf-frame" title={`论文 ${paperId} 原文`} src={url} />
    </>}
  </div>
}

function EntryDetail({ api, entryId, onCite, onChanged }) {
  const detail = useResource(
    (signal) => entryId ? api.request(`kb/entries/${entryId}`, { signal }) : Promise.resolve(null),
    [entryId],
  )
  const [noteEdit, setNoteEdit] = useState(null)
  const [error, setError] = useState('')
  const entry = detail.data

  async function saveNote() {
    setError('')
    try {
      const operation = await api.request(`kb/entries/${entryId}`, {
        method: 'PUT', key: crypto.randomUUID(),
        body: { title: noteEdit.title, user_note: noteEdit.user_note },
      })
      await waitOperation(api, operation.operation_id)
      setNoteEdit(null); detail.refresh(); onChanged()
    } catch (failure) { setError(failure.message) }
  }

  return <section className="card kb-detail" aria-label="条目详情">
    {!entry && <EmptyState icon="info" title="选择条目查看详情" description="论文与实验报告的完整内容在这里查看。" />}
    {entry && <>
      <header>
        <strong>{entry.title}</strong>
        <StatusBadge>{entry.index_status === 'done' ? '已索引' : '待同步'}</StatusBadge>
      </header>
      <dl className="meta">
        <div><dt>类型</dt><dd>{entry.type === 'experiment_report' ? '实验报告' : '论文摘要'}</dd></div>
        <div><dt>入库时间</dt><dd>{entry.created_at}</dd></div>
        {entry.user_note && <div><dt>备注</dt><dd>{entry.user_note}</dd></div>}
      </dl>
      {entry.type === 'experiment_report'
        ? <ObjectView value={entry.content} />
        : <>
          {entry.content?.summary && <p className="summary">{entry.content.summary}</p>}
          {['method', 'datasets', 'conclusions'].map((key) => entry.content?.[key] && <p key={key} className="summary"><strong>{{ method: '方法', datasets: '数据', conclusions: '结论' }[key]}：</strong>{entry.content[key]}</p>)}
          {entry.content?.abstract && <details><summary>原文摘要</summary><p className="summary">{entry.content.abstract}</p></details>}
          {entry.source_type === 'paper' && <PdfPreview api={api} paperId={entry.source_id} />}
        </>}
      {noteEdit
        ? <div className="paper-editor">
          <label>标题<input value={noteEdit.title} onChange={(event) => setNoteEdit({ ...noteEdit, title: event.target.value })} /></label>
          <label>备注<textarea rows={2} value={noteEdit.user_note} onChange={(event) => setNoteEdit({ ...noteEdit, user_note: event.target.value })} /></label>
          <div className="settings-row">
            <button type="button" className="primary" onClick={saveNote}>保存</button>
            <button type="button" className="quiet" onClick={() => setNoteEdit(null)}>取消</button>
            {error && <span className="error message" role="alert">{error}</span>}
          </div>
        </div>
        : <div className="kb-actions">
          <button type="button" className="quiet" onClick={() => setNoteEdit({ title: entry.title, user_note: entry.user_note ?? '' })}>编辑标题 / 备注</button>
          <button type="button" onClick={() => onCite(entry)}><PanelIcon name="chevron" />加入引用</button>
        </div>}
    </>}
  </section>
}
