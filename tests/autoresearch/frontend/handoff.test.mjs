import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ArchiveAPI} from '../../../packages/autoresearch/src/autoresearch/web/lib/archive-api.js';
import {ResearchAPI} from '../../../packages/autoresearch/src/autoresearch/web/lib/api.js';
import {metricMeta,progress,roundsCompleted,proposalCount,failureReason,createPayload,stageLabel,elapsedSeconds} from '../../../packages/autoresearch/src/autoresearch/web/lib/model.js';
import {resultsView} from '../../../packages/autoresearch/src/autoresearch/web/views/results.js';
import {createDialog} from '../../../packages/autoresearch/src/autoresearch/web/views/create.js';
import {projectsView} from '../../../packages/autoresearch/src/autoresearch/web/views/projects.js';
const catalog=JSON.parse(await readFile(new URL('../../fixtures/archive.json',import.meta.url),'utf8'));
const budget={rounds:2,total_seconds:10,experiment_seconds:120,max_llm_calls:1};

test('新接口metric优先级、辅助指标与量纲采用服务字段',()=>{
  const fallback={primary_metric:'accuracy',direction:'maximize'};
  const project={metric:{primary_metric:'mae',direction:'minimize'}};
  const run={metric:{primary_metric:'mse',direction:'minimize',secondary_metric:'mae',primary_label:'均方误差',secondary_label:'绝对误差',unit:'train_standardized'}};
  assert.deepEqual(metricMeta(fallback,run,project),{key:'mse',label:'均方误差',direction:'minimize',secondary:['mae'],secondaryLabel:'绝对误差',unit:'train_standardized',runnable:undefined});
  assert.equal(metricMeta(fallback,{},project).key,'mae');
});
test('真实交接记录的部分进度与预算计数不按旧阶段推算',()=>{
  const run=catalog.runs.find(r=>r.id==='run_8cb4687bd4c4479f9950a45023584181');
  assert.equal(progress(run,2),50);assert.equal(roundsCompleted(run),1);assert.equal(proposalCount(run),1);
  assert.equal(stageLabel(run),'生成候选');assert.equal(elapsedSeconds(run),18.02);
  assert.equal(failureReason(run),'model_call_budget_exhausted');
  assert.equal(failureReason({status:'completed',stop_reason:'user_stop',snapshot:{failure_reason:null}}),null);
});
test('统一模板可创建DLinear并使用独立修改路径，未就绪模板仍拒绝',()=>{
  const digits=catalog.templates.find(t=>t.id==='digits-mlp-v1'),dlinear=catalog.templates.find(t=>t.id==='dlinear-etth1-v1');
  const html=createDialog(catalog.templates,'live');
  assert.doesNotMatch(html,/value="dlinear-etth1-v1"[^>]*disabled/);
  assert.match(html,/name="total_seconds"[^>]*min="10"/);
  assert.throws(()=>createPayload({...dlinear,runnable:false},'测试预测任务',budget));
  assert.deepEqual(createPayload(dlinear,'检查预测路径',budget).editable_paths,['models/DLinear.py']);
  assert.deepEqual(createPayload(digits,'  检查10秒预算  ',budget),{template_id:digits.id,goal:'检查10秒预算',editable_paths:['model.py'],budget});
});
test('确认信息只传实际填写字段，不自动补人员签认；fetch不使用Cookie',async()=>{
  const calls=[];
  const api=new ResearchAPI({fetchImpl:async(url,options)=>{calls.push(options);return {ok:true,json:async()=>({id:'fixture'})};}});
  await api.start('p',{confirmer:'  ',opinion:'',unapproved:'ignore'});
  await api.start('p',{confirmer:' 实际测试人 ',opinion:' 已核对 ',unapproved:'ignore'});
  assert.deepEqual(JSON.parse(calls[0].body),{confirm_plan:true});
  assert.deepEqual(JSON.parse(calls[1].body),{confirm_plan:true,confirmer:'实际测试人',opinion:'已核对'});
  assert.equal(calls[1].credentials,'omit');
});
test('交接记录只读API不发线上请求，运行编号与源文件对应',async()=>{
  const calls=[];const archive=new ArchiveAPI(async(url)=>{calls.push(url);return new Response(JSON.stringify(catalog));});
  assert.equal((await archive.projects()).length,3);
  for(const project of await archive.projects()){
    const record=await archive.run(project.runs[0].id);
    assert.equal(record.project_id,project.id);assert.match(project.record_source.sha256,/^[a-f0-9]{64}$/);
  }
  for(const method of ['create','start','stop','resume'])assert.throws(()=>archive[method]('anything'),/只读/);
  assert.deepEqual(calls,['./handoff/catalog.json']);
  const exported=await (await archive.export(catalog.runs[0].id)).json();
  assert.equal(exported.recorded,true);assert.equal(exported.read_only,true);assert.deepEqual(exported.run,catalog.runs[0]);
});
test('历史页面保留完成、停止与失败，缺详情不改写为未执行',async()=>{
  const archive=new ArchiveAPI(async()=>new Response(JSON.stringify(catalog)));
  for(const project of await archive.projects()){
    const run=project.runs[0],html=resultsView(project,run,catalog.templates[0],{mode:'handoff'});
    assert.doesNotMatch(html,/data-action="(?:start|stop|resume|artifact)"/);
    assert.match(html,/历史记录只读/);assert.match(html,/原响应文件SHA-256/);
    if(run.status==='completed'&&!run.confirmation)assert.match(html,/响应未提供阶段详情/);
    if(run.status==='failed')assert.match(html,/model_call_budget_exhausted/);
  }
  const state={projects:await archive.projects(),templates:catalog.templates,mode:'handoff',filter:'all',search:'',layout:'grid'};
  assert.match(projectsView(state),/data-action="create" disabled/);
  const stopped=catalog.runs.find(r=>r.id==='run_4e4da5898dc948508fb77f44752ba49a');
  assert.equal(stopped.status,'cancelled');
});
