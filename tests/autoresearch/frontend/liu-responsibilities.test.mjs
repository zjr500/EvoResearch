// 刘润涛6项职责测试：仅适配当前统一工作区的相对导入路径；原件在同步依据。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const engine=process.env.AUTORESEARCH_REVIEW_ENGINE || resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/autoresearch');
const web=relative=>pathToFileURL(resolve(engine,'src/autoresearch/web',relative));
const {createPayload,validateBudget}=await import(web('lib/model.js'));
const {createDialog}=await import(web('views/create.js'));
const {resultsView}=await import(web('views/results.js'));
const {ResearchAPI}=await import(web('lib/api.js'));
const templates=JSON.parse(await readFile(resolve(engine,'../../tests/fixtures/templates.json'),'utf8'));
const budget={rounds:3,total_seconds:1800,experiment_seconds:120,max_llm_calls:12};
const projectFor=t=>({id:'project_audit_fixture',goal:'核对创建与运行控制',template_id:t.id,editable_paths:t.editable_paths,budget,runs:[]});

test('两类正式模板均可创建，提交各自真实修改路径和完整预算',()=>{
  assert.deepEqual(templates.map(t=>t.id),['digits-mlp-v1','dlinear-etth1-v1']);
  for(const t of templates){
    assert.equal(t.runnable,true);
    assert.deepEqual(createPayload(t,'  核对研究目标  ',budget),{template_id:t.id,goal:'核对研究目标',editable_paths:t.editable_paths,budget});
  }
  assert.deepEqual(templates[1].editable_paths,['models/DLinear.py']);
});
test('目标空白与长度边界、四项预算上下界均执行校验',()=>{
  for(const goal of ['', '  ', 'ab', 'a'.repeat(2001)])assert.throws(()=>createPayload(templates[0],goal,budget));
  for(const goal of ['abc','a'.repeat(2000)])assert.equal(createPayload(templates[0],goal,budget).goal,goal);
  for(const [key,[lo,hi]] of Object.entries(templates[0].limits)){
    for(const n of [lo,hi])assert.equal(validateBudget({...budget,[key]:n})[key],n);
    for(const n of [lo-1,hi+1,NaN,Infinity,lo+.5])assert.throws(()=>validateBudget({...budget,[key]:n}));
  }
});
test('新建表单显示双任务、四项预算和样例提示，在线模式不标成模拟',()=>{
  const sample=createDialog(templates,'sample'),live=createDialog(templates,'live');
  for(const id of templates.map(t=>t.id))assert.ok(live.includes('value="'+id+'"'));
  for(const name of ['goal','rounds','total_seconds','experiment_seconds','max_llm_calls'])assert.ok(live.includes('name="'+name+'"'));
  assert.match(sample,/仅演示操作流程/);
  assert.doesNotMatch(live,/当前为样例模式/);
  assert.doesNotMatch(live,/value="(?:digits-mlp-v1|dlinear-etth1-v1)"[^>]*disabled/);
});
test('计划展示正式任务边界与预算，确认框和启动按钮存在且初始禁用',()=>{
  for(const t of templates){
    const html=resultsView(projectFor(t),null,t,{mode:'live',busy:false});
    assert.ok(html.includes(t.editable_paths[0]));
    assert.match(html,/3轮/);assert.match(html,/30 分 0 秒/);
    assert.match(html,/id="confirm-plan"/);
    assert.match(html,/id="start-run"[^>]*disabled/);
    assert.match(html,/id="plan-confirmer"/);assert.match(html,/id="plan-opinion"/);
  }
});
test('运行状态决定停止继续按钮，完成失败及耗尽状态不直接继续',()=>{
  const t=templates[0],p=projectFor(t);
  for(const status of ['queued','running','cancelling','cancelled','interrupted','completed','failed','budget_exhausted']){
    const run={id:'run_audit_fixture',status,stage:status,elapsed:10,llm_calls:1,baseline:{accuracy:.95},trials:[],artifacts:[]};
    const html=resultsView(p,run,t,{mode:'live',busy:false});
    assert.equal(html.includes('data-action="stop"'),['queued','running','cancelling'].includes(status));
    assert.equal(html.includes('data-action="resume"'),['cancelled','interrupted'].includes(status));
  }
});
test('控制请求沿用同一运行编号；确认人意见仅按实际传入；错误不伪装为成功',async()=>{
  const calls=[],api=new ResearchAPI({fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return {ok:true,json:async()=>({id:'run_audit_fixture',status:'queued'})};
  }});
  await api.start('project_audit_fixture',{confirmer:' 实际确认人 ',opinion:' 已核对任务与预算 '});
  assert.deepEqual(JSON.parse(calls[0].options.body),{confirm_plan:true,confirmer:'实际确认人',opinion:'已核对任务与预算'});
  await api.stop('run_audit_fixture');await api.resume('run_audit_fixture');
  assert.equal(calls[1].url,'/api/runs/run_audit_fixture/stop');
  assert.equal(calls[2].url,'/api/runs/run_audit_fixture/resume');
  const fail=new ResearchAPI({fetchImpl:async()=>({ok:false,status:409,json:async()=>({detail:'预算已耗尽'})})});
  await assert.rejects(fail.resume('run_audit_fixture'),/预算已耗尽.*409/);
});
