import test from 'node:test'
import assert from 'node:assert/strict'
import { MockSearchAdapter } from '../dist/src/adapters/mock-search.js'
import { HttpSearchAdapter } from '../dist/src/adapters/http-search.js'
import { SearchService } from '../dist/src/services/search-service.js'
import { parseSearchResponse, validateRequest } from '../dist/src/domain/validate.js'
import { renderCitedAnswer, renderSearchCandidates } from '../dist/src/services/citation-service.js'

const service = new SearchService(new MockSearchAdapter(), 'mock')

test('mock：能从 RAG 问题检索到可引用条目', async () => {
  const result = await service.search('RAG如何减少幻觉？')
  assert.ok(result.items.some((item) => item.id === 'kb-101'))
  assert.match(renderSearchCandidates(result), /ID=kb-101/)
})

test('选中后：回答引用 [1] 并给出确切来源', async () => {
  const selected = await service.select('RAG如何减少幻觉？', ['kb-101'])
  const answer = renderCitedAnswer(selected)
  assert.match(answer, /\[1\]/)
  assert.match(answer, /【参考来源】\n\[1\]/)
  assert.match(answer, /Retrieval-Augmented Generation/)
  assert.match(answer, /https:\/\/arxiv.org\/abs\/2005.11401/)
})

test('拒绝杜撰 ID', async () => {
  await assert.rejects(service.select('RAG如何减少幻觉？', ['kb-does-not-exist']), /拒绝伪造引用/)
})

test('无匹配内容：不编造来源', async () => {
  const result = await service.search('zxqy987无关问题')
  assert.equal(result.items.length, 0)
  assert.match(renderSearchCandidates(result), /没有找到/)
})

test('输入约束：空问题、topK 越界均拒绝', () => {
  assert.throws(() => validateRequest(' '), /非空/)
  assert.throws(() => validateRequest('RAG', 11), /1~10/)
})

test('来源 URL 约束：拒绝 javascript 协议', () => {
  assert.throws(() => parseSearchResponse({
    query: 'x', total: 1, items: [{ id:'a', title:'b', snippet:'c', score:0.7,
      source:{type:'web', title:'x', url:'javascript:alert(1)'} }],
  }), /有效的 HTTP\(S\)/)
})

test('HTTP 适配层：POST body 与响应字段校验', async () => {
  let captured
  const fakeFetch = async (url, init) => {
    captured = { url, init }
    return {
      ok: true, status: 200,
      json: async () => ({ query: 'LoRA', total: 1, items: [{
        id:'kb-1', title:'LoRA', snippet:'低秩矩阵', score:0.9,
        source:{type:'paper',title:'paper',url:'https://example.org/paper'},
      }] }),
    }
  }
  const adapter = new HttpSearchAdapter('http://127.0.0.1:3000', 1000, fakeFetch)
  const result = await adapter.search({query:'LoRA',topK:2})
  assert.equal(captured.url, 'http://127.0.0.1:3000/kb/search')
  assert.deepEqual(JSON.parse(captured.init.body), {query:'LoRA',top_k:2})
  assert.equal(result.items[0].id, 'kb-1')
})

test('HTTP 适配层：错误响应提示清楚', async () => {
  const adapter = new HttpSearchAdapter('http://localhost:3000',1000, async () => ({ok:false,status:503}))
  await assert.rejects(adapter.search({query:'RAG',topK:3}), /HTTP 503/)
})

test('检索结果去重、分数排序', async () => {
  const adapter = { search: async ({query}) => ({query,total:3,items:[
    {id:'same',title:'first',snippet:'text',score:.3,source:{type:'internal',title:'a',url:null}},
    {id:'other',title:'b',snippet:'text',score:.8,source:{type:'internal',title:'b',url:null}},
    {id:'same',title:'high',snippet:'text',score:.9,source:{type:'internal',title:'c',url:null}},
  ]}) }
  const result = await new SearchService(adapter,'mock').search('RAG')
  assert.deepEqual(result.items.map((item)=>item.id), ['same','other'])
  assert.equal(result.items[0].title,'high')
})
