import test from 'node:test'
import assert from 'node:assert/strict'
import { MockSearchAdapter } from './mock-search.mjs'
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
