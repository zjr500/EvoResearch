import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, name, inject } from '../dist/index.js'

test('compiled plugin registers a callable DSH entry', async () => {
  const registered = []
  apply({ tools: { register: definition => registered.push(definition) } })
  assert.equal(name, 'evoresearch')
  assert.deepEqual(inject, ['tools'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'evoresearch_status')
  assert.match(await registered[0].execute({}), /plugin is ready/)
})
