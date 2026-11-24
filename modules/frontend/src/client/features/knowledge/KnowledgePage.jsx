import { useState } from 'react'
import { knowledgeApi } from './api.js'
import { useMutation, useResource } from '../../shared/hooks.js'
import { EmptyState, Feedback, ObjectView, Pager } from '../../shared/ui.jsx'
import { PanelIcon } from '../../shell/PanelIcon.jsx'

const types = { paper_summary: '论文摘要', experiment_report: '实验报告' }

export function KnowledgePage({ api }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState({ keyword: '', type: '' })
  const [cursors, setCursors] = useState([null])
  const [selected, setSelected] = useState(null)
  const [checked, setChecked] = useState([])
  const params = { ...query, cursor: cursors.at(-1), limit: 20 }
  const list = useResource((signal) => knowledgeApi.list(api, params, signal), [api, JSON.stringify(params)])
  function filter(next) { setQuery(next); setCursors([null]); setSelected(null) }
  function refreshed() { setSelected(null); setChecked([]); list.refresh() }

  return <div className="two-columns">
    <section className="card library-list">
      <div className="section-head"><h2>知识条目</h2><button className="quiet" type="button" onClick={list.refresh}>刷新</button></div>
      <form className="toolbar library-filters" onSubmit={(event) => { event.preventDefault(); filter({ ...query, keyword: search.trim() }) }}>
        <label className="search-field"><PanelIcon name="search" /><input aria-label="按标题搜索" placeholder="按标题搜索" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label="知识条目类型" value={query.type} onChange={(event) => filter({ ...query, type: event.target.value })}>
          <option value="">全部类型</option>
          {Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" className="primary">搜索</button>
      </form>
      <Feedback state={list} />
      {checked.length > 0 && <p className="selection-note muted">已勾选 {checked.length} 条 · 编号 {checked.join('、')}</p>}
      {list.data?.entries.length === 0 && <EmptyState icon="search" title="没有匹配的条目" description="试试更换关键词或类型。" />}
      <ul className="entry-list">{list.data?.entries.map((entry) => <li key={entry.document_id} className="entry-row">
        <label className="entry-check"><input type="checkbox" aria-label={`勾选 ${entry.title}`} checked={checked.includes(entry.document_id)} onChange={(event) => setChecked(event.target.checked ? [...checked, entry.document_id] : checked.filter((id) => id !== entry.document_id))} /></label>
        <button className="entry" aria-pressed={selected === entry.document_id} onClick={() => setSelected(entry.document_id)}>
          <span className="entry-copy"><strong>{entry.title}</strong><small>{types[entry.type] ?? entry.type} · {entry.created_at}</small></span>
          <PanelIcon name="chevron" />
        </button>
      </li>)}</ul>
      {list.data && <Pager cursors={cursors} next={list.data.nextCursor} onChange={setCursors} />}
    </section>
    <section className="card library-detail">
      {selected === null ? <><h2>条目详情</h2><EmptyState icon="knowledge" title="尚未选择条目" description="从知识条目中选择一项，即可查看来源、内容和备注。" /></> : <EntryDetail key={selected} api={api} id={selected} onChanged={refreshed} />}
    </section>
  </div>
}

function EntryDetail({ api, id, onChanged }) {
  const detail = useResource((signal) => knowledgeApi.detail(api, id, signal), [api, id])
  return <>
    <Feedback state={detail} />
    {detail.data && <Editor key={JSON.stringify(detail.data)} api={api} entry={detail.data} onChanged={onChanged} />}
  </>
}

function Editor({ api, entry, onChanged }) {
  const [title, setTitle] = useState(entry.title)
  const [note, setNote] = useState(entry.user_note ?? '')
  const mutation = useMutation()
  async function save(event) {
    event.preventDefault()
    const body = { title: title.trim() }
    if (note !== (entry.user_note ?? '')) body.user_note = note
    const result = await mutation.run(JSON.stringify(['edit', entry.document_id, body]), (key, signal) => knowledgeApi.update(api, entry.document_id, body, key, signal))
    if (result !== null) onChanged()
  }
  async function remove() {
    if (!window.confirm(`删除“${entry.title}”？`)) return
    const result = await mutation.run(`delete:${entry.document_id}`, (key, signal) => knowledgeApi.remove(api, entry.document_id, key, signal))
    if (result !== null) onChanged()
  }
  return <>
    <div className="detail-heading"><span className="tag">{types[entry.type] ?? entry.type}</span><span className="muted">条目 {entry.document_id}</span></div>
    <h2 className="entry-title">{entry.title}</h2>
    <p className="muted detail-source">来源 {entry.source_type} / {entry.source_id} · {entry.created_at}</p>
    <div className="detail-content"><h3>条目内容</h3><ObjectView value={entry.content} /></div>
    <form className="form detail-editor" onSubmit={save}>
      <label>标题<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>备注<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="toolbar"><button disabled={mutation.busy || !title.trim()} type="submit" className="primary">保存修改</button><button disabled={mutation.busy} type="button" className="danger" onClick={remove}>删除条目</button></div>
    </form>
    <Feedback state={mutation} />
  </>
}
