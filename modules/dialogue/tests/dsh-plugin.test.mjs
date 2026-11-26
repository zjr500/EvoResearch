import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { MockSearchAdapter } from './mock-search.mjs'

// 只替换两个 DSH runtime 包，隔离测试真实业务模块。
register(new URL('./dsh-test-loader.mjs', import.meta.url), import.meta.url)
const { registerKnowledgeTools, CITATION_PROMPT } = await import('../dist/src/tools/knowledge-tools.js')
const { SearchService } = await import('../dist/src/services/search-service.js')

test('DSH 模拟宿主：引用工具可注册、执行与卸载', async () => {
  const registered = new Map()
  const sections = new Map()
  const ctx = {
    tools: {
      register(definition) {
        assert.ok(!registered.has(definition.name))
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
    systemPrompt: {
      section(section) {
        sections.set(section.name, section)
        return () => sections.delete(section.name)
      },
    },
  }
  const service = new SearchService(new MockSearchAdapter(), 'mock')
  const disposers = registerKnowledgeTools(ctx, service)
  const disposePrompt = ctx.systemPrompt.section({
    name: 'tool:f12-knowledge-citation', order: 155,
    text: CITATION_PROMPT,
  })
  assert.deepEqual([...registered.keys()], ['kb_search_sources', 'kb_cite_sources'])
  assert.equal(sections.has('tool:f12-knowledge-citation'), true)

  const candidates = await registered.get('kb_search_sources').execute({query:'RAG如何减少幻觉？',topK:3})
  assert.match(candidates, /ID=kb-101/)
  const cited = await registered.get('kb_cite_sources').execute({query:'RAG如何减少幻觉？',ids:['kb-101']})
  assert.match(cited, /【参考来源】\n\[1\]/)
  assert.match(cited, /arxiv\.org\/abs\/2005\.11401/)

  for (const dispose of disposers.reverse()) dispose()
  disposePrompt()
  assert.equal(registered.size, 0)
  assert.equal(sections.size, 0)
})
