import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// 只替换两个 DSH runtime 包，隔离测试真实业务模块。
register(new URL('./dsh-test-loader.mjs', import.meta.url), import.meta.url)
const plugin = await import('../dist/src/dsh/index.js')

test('DSH 模拟宿主：工具可注册、执行与卸载', async () => {
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
  const dispose = plugin.apply(ctx, { mode: 'mock' })
  assert.deepEqual([...registered.keys()], ['kb_search_sources', 'kb_cite_sources'])
  assert.equal(sections.has('tool:f12-knowledge-citation'), true)

  const candidates = await registered.get('kb_search_sources').execute({query:'RAG如何减少幻觉？',topK:3})
  assert.match(candidates, /ID=kb-101/)
  const cited = await registered.get('kb_cite_sources').execute({query:'RAG如何减少幻觉？',ids:['kb-101']})
  assert.match(cited, /【参考来源】\n\[1\]/)
  assert.match(cited, /arxiv\.org\/abs\/2005\.11401/)

  dispose()
  assert.equal(registered.size, 0)
  assert.equal(sections.size, 0)
})
