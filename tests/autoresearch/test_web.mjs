import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchAPI} from '../../packages/autoresearch/src/autoresearch/web/lib/api.js';
import {createPayload} from '../../packages/autoresearch/src/autoresearch/web/lib/model.js';

test('DLinear创建沿用服务给定的模型路径', () => {
  const budget={rounds:3,total_seconds:1800,experiment_seconds:120,max_llm_calls:12};
  const template={id:'dlinear-etth1-v1',runnable:true,editable_paths:['models/DLinear.py']};
  assert.deepEqual(createPayload(template,'降低预测误差',budget).editable_paths,template.editable_paths);
});

test('大运行包下载等待压缩，普通查询仍使用15秒超时', async () => {
  const original=globalThis.setTimeout;
  const seen=[];
  globalThis.setTimeout=(fn,ms)=>{seen.push(ms);return original(fn,ms);};
  try {
    const api=new ResearchAPI({fetchImpl:async()=>({ok:true,json:async()=>[],blob:async()=>new Blob()})});
    await api.templates();
    await api.export('test');
    assert.deepEqual(seen,[15000,180000]);
  } finally {globalThis.setTimeout=original;}
});
