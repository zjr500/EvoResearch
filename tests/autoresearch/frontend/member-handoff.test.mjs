import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handoffsView} from '../../../packages/autoresearch/src/autoresearch/web/views/handoffs.js';
test('fresh checkout excludes private historical records',async()=>{
 const data=JSON.parse(await readFile(new URL('../../../packages/autoresearch/src/autoresearch/web/handoff/catalog.json',import.meta.url),'utf8'));
 assert.deepEqual(data.projects,[]);assert.deepEqual(data.runs,[]);assert.equal(data.templates.length,2);
 assert.match(handoffsView(),/GitHub/);assert.doesNotMatch(handoffsView(),/data-action=/);
});
