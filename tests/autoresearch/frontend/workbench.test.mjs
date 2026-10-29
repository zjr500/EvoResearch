import test from 'node:test';
import assert from 'node:assert/strict';
import {improvement,bestTrial,metricMeta,escapeHTML,validateBudget} from '../../../packages/autoresearch/src/autoresearch/web/lib/model.js';
import {SampleStore} from '../../../packages/autoresearch/src/autoresearch/web/lib/sample-store.js';
import {ResearchAPI} from '../../../packages/autoresearch/src/autoresearch/web/lib/api.js';
const budget={rounds:3,total_seconds:1800,experiment_seconds:120,max_llm_calls:12};
function memory(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}
function setup(){let time=100000;const storage=memory(),store=new SampleStore(storage,()=>time);const project=store.create({template_id:'digits-mlp-v1',goal:'检查样例停止和继续',budget});return {store,project,storage,setTime:value=>time=value};}

test('accuracy最大化与MSE最小化采用相反的改善方向',()=>{
  assert.equal(improvement(.96,.95,'maximize'),true);assert.equal(improvement(.61,.65,'minimize'),true);
  assert.equal(improvement(.66,.65,'minimize'),false);assert.equal(improvement(.65,.65,'minimize'),false);
  assert.equal(improvement(NaN,.65,'minimize'),null);assert.equal(improvement(.6,.7,null),null);
});
test('无效候选不参加最优比较，MSE按最低有效值选取',()=>{
  const run={baseline:{mse:.8},trials:[{status:'valid',metrics:{mse:.7},ordinal:0},{status:'timeout',metrics:{mse:.1},ordinal:1},{status:'valid',metrics:{mse:.6},ordinal:2}]};
  assert.equal(bestTrial(run,{key:'mse',direction:'minimize'}).ordinal,2);
  assert.equal(bestTrial(run,{key:'mse',direction:null}),null);
  assert.equal(metricMeta({primary_metric:'mse',direction:'minimize'}).label,'MSE');
});
test('研究目标和错误文本进行HTML转义',()=>assert.equal(escapeHTML('<img onerror="x">&'), '&lt;img onerror=&quot;x&quot;&gt;&amp;'));
test('预算拒绝超界、NaN和非整数输入',()=>{
  assert.deepEqual(validateBudget({...budget}),budget);
  for(const invalid of [{rounds:1},{rounds:2.5},{total_seconds:0},{experiment_seconds:121},{max_llm_calls:NaN}])assert.throws(()=>validateBudget({...budget,...invalid}));
});
test('样例停止后继续保留编号、累计预算和完成候选',()=>{
  const {store,project,storage,setTime}=setup();const run=store.start(project.id);setTime(107000);
  const stopped=store.stop(run.id);assert.equal(stopped.status,'cancelled');assert.equal(stopped.trials.length,1);
  setTime(120000);assert.equal(store.run(run.id).elapsed,7);
  const resumed=store.resume(run.id);assert.equal(resumed.id,run.id);assert.equal(resumed.elapsed,7);assert.equal(resumed.resume_history.length,1);
  setTime(122000);assert.equal(store.run(run.id).elapsed,9);
  const reopened=new SampleStore(storage,()=>122000);assert.equal(reopened.run(run.id).id,run.id);assert.equal(reopened.run(run.id).elapsed,9);
  assert.deepEqual(reopened.run(run.id).trials[0],stopped.trials[0]);
});
test('样例提案预算耗尽后拒绝继续，已完成结果保留',()=>{
  const {store,project,setTime}=setup();project.budget.max_llm_calls=1;
  // create返回副本，预算变更通过新的合法计划建立。
  const limited=store.create({template_id:'digits-mlp-v1',goal:'提案预算限制样例',budget:{...budget,max_llm_calls:1}});
  const r=store.start(limited.id);setTime(110000);const ended=store.run(r.id);
  assert.equal(ended.status,'budget_exhausted');assert.equal(ended.llm_calls,1);assert.equal(ended.trials.length,1);
  assert.throws(()=>store.resume(r.id));
});
test('样例总时间优先于单次上限，导出明确标为非真实实验',()=>{
  const {store,setTime}=setup();const p=store.create({template_id:'digits-mlp-v1',goal:'总时间限制样例',budget:{...budget,total_seconds:10}});
  const r=store.start(p.id);setTime(150000);const ended=store.run(r.id);
  assert.equal(ended.status,'budget_exhausted');assert.equal(ended.stop_reason,'total_budget_exhausted');assert.equal(ended.elapsed,10);
  assert.equal(store.export(r.id).sample,true);assert.match(store.export(r.id).notice,/不包含真实训练/);
});
test('已消费最后一次提案但候选未完成时，可以停止后继续完成该候选',()=>{
  const {store,setTime}=setup();const p=store.create({template_id:'digits-mlp-v1',goal:'最后提案停止继续',budget:{...budget,max_llm_calls:1}});
  const r=store.start(p.id);setTime(104000);assert.equal(store.stop(r.id).llm_calls,1);
  setTime(108000);assert.equal(store.resume(r.id).id,r.id);
  setTime(111000);const ended=store.run(r.id);assert.equal(ended.trials.length,1);assert.equal(ended.status,'budget_exhausted');
});
test('创建、启动和控制请求严格遵循当前HTTP样例，编号使用id',async()=>{
  const calls=[];const api=new ResearchAPI({base:'/api/',token:'test-only-token',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({id:'run_fixture'})};}});
  await api.create({template_id:'digits-mlp-v1',goal:'接口样例',budget});const run=await api.start('project_test');await api.stop(run.id);await api.resume(run.id);
  assert.equal(calls[1].url,'/api/projects/project_test/runs');assert.deepEqual(JSON.parse(calls[1].options.body),{confirm_plan:true});
  assert.equal(calls[2].url,'/api/runs/run_fixture/stop');assert.equal(calls[3].url,'/api/runs/run_fixture/resume');assert.equal(calls[0].options.headers.Authorization,'Bearer test-only-token');
});
test('浏览器fetch正确绑定全局接收者，不在发请求前Illegal invocation',async()=>{
  const api=new ResearchAPI({fetchImpl:async function(){assert.equal(this,globalThis);return {ok:true,json:async()=>[]};}});
  assert.deepEqual(await api.templates(),[]);
});
test('真实接口409错误保留，不能退回成功样例',async()=>{
  const api=new ResearchAPI({fetchImpl:async()=>({ok:false,status:409,json:async()=>({detail:'Only interrupted or stopped runs can resume'})})});
  await assert.rejects(api.resume('run_fixture'),/Only interrupted.*409/);
});
