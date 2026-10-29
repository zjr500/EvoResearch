import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resultsView} from '../../../packages/autoresearch/src/autoresearch/web/views/results.js';
import {ResearchAPI} from '../../../packages/autoresearch/src/autoresearch/web/lib/api.js';
const web='../../../packages/autoresearch/src/autoresearch/web/';
const catalog=JSON.parse(await readFile(new URL(web+'handoff/catalog.json',import.meta.url),'utf8'));

test('统一版下载等待三分钟、普通请求15秒，保持HTTP请求语义',async t=>{
  const delays=[];
  t.mock.method(globalThis,'setTimeout',(_,ms)=>{delays.push(ms);return 0;});
  t.mock.method(globalThis,'clearTimeout',()=>{});
  const api=new ResearchAPI({fetchImpl:async()=>({ok:true,json:async()=>({}),blob:async()=>new Blob()})});
  await api.templates();await api.export('recorded_fixture');await api.artifact('recorded_artifact');
  assert.deepEqual(delays,[15000,180000,180000]);
});
