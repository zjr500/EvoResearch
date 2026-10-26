import {validateBudget, ACTIVE} from './model.js';

export const SAMPLE_TEMPLATES = [
  {id:'digits-mlp-v1', name:'手写数字识别', short_name:'Digits', category:'图像分类', description:'在固定数据划分上改进 MLP 分类模型，检查每轮修改是否有效。', primary_metric:'accuracy', secondary_metrics:['macro_f1'], direction:'maximize', editable_paths:['model.py'], defaults:{rounds:3,total_seconds:1800,experiment_seconds:120,max_llm_calls:12}, sample:true},
  {id:'sample-dlinear-etth1', name:'时间序列预测', short_name:'DLinear · ETTh1', category:'时间序列', description:'预测未来96小时的变化，比较 MSE 与 MAE，查看实际值和预测值。', primary_metric:'mse', secondary_metrics:['mae'], direction:'minimize', editable_paths:['model.py'], defaults:{rounds:3,total_seconds:1800,experiment_seconds:120,max_llm_calls:12}, sample:true}
];
const copy = value => JSON.parse(JSON.stringify(value));
function uid(prefix) { return `sample_${prefix}_${globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)}`; }
function baseline(template) { return template.primary_metric === 'accuracy' ? {accuracy:.9415,macro_f1:.9408} : {mse:.6724,mae:.5631}; }
function trialMetrics(template, index) { return template.primary_metric === 'accuracy' ? {accuracy:Math.min(.994,.953 + index*.009),macro_f1:Math.min(.994,.9521 + index*.009)} : {mse:Math.max(.28,.6312-index*.0261),mae:Math.max(.2,.5386-index*.0123)}; }
function curve() {
  const actual = Array.from({length:48}, (_,i) => Number((.65*Math.sin(i*.25) + .24*Math.sin(i*.63) + .004*i).toFixed(4)));
  return {actual, predicted:actual.map((v,i) => Number((v+.11*Math.sin(i*.7+.5)).toFixed(4))), timestamps:actual.map((_,i) => `第${i+1}小时`), target_name:'样例变量 OT', sample:true};
}

/** 浏览器内样例状态机；所有数据均为模拟，不发请求、不执行模型。 */
export class SampleStore {
  constructor(storage, now = () => Date.now()) {
    this.storage = storage; this.now = now; this.key = 'ar-phase2-sample-v1';
    try { this.data = JSON.parse(storage.getItem(this.key)); } catch { this.data = null; }
    if (!this.data || this.data.schema !== 1 || !Array.isArray(this.data.projects)) this.seed();
  }
  save() { this.storage.setItem(this.key, JSON.stringify(this.data)); }
  seed() {
    this.data = {schema:1, projects:[]};
    for (const [index, template] of SAMPLE_TEMPLATES.entries()) {
      const project = this._newProject({template_id:template.id, goal:index ? '探索长期预测中的模型改进' : '提升手写数字的分类表现', budget:copy(template.defaults)});
      const run = this._newRun(project);
      run.status='completed'; run.stage='completed'; run.elapsed=42+index*9; run.llm_calls=3; run.trials=Array.from({length:3}, (_,i) => this.makeTrial(project, i));
      run.baseline=baseline(template); run.confirmation={improved:true, mean_delta:index ? -.0673 : .0241}; run.final_evaluation={mean_delta:index ? -.0556 : .0218};
      if (index) run.forecast=curve();
      project.runs=[run]; this.data.projects.push(project);
    }
    this.data.projects.push(this._newProject({template_id:SAMPLE_TEMPLATES[0].id,goal:'比较不同隐藏层容量的研究计划',budget:copy(SAMPLE_TEMPLATES[0].defaults)}));
    this.save();
  }
  _newProject(body) {
    const template = SAMPLE_TEMPLATES.find(t => t.id === body.template_id);
    if (!template) throw new Error('样例任务不存在。');
    if (typeof body.goal !== 'string' || body.goal.trim().length < 3 || body.goal.trim().length > 2000) throw new Error('研究目标请填写3—2000个字符。');
    return {id:uid('project'), goal:body.goal.trim(), template_id:body.template_id, editable_paths:['model.py'], budget:validateBudget(copy(body.budget)), plan:{goal:body.goal.trim(), editable_paths:['model.py'], template_version:'样例', flow:['baseline','proposal','experiment','confirmation','final_evaluation','report']}, created:this.now()/1000, runs:[], sample:true};
  }
  _newRun(project) { return {id:uid('run'), project_id:project.id, status:'queued',stage:'queued',elapsed:0,llm_calls:0,created:this.now()/1000,baseline:null,trials:[],artifacts:[],resume_history:[],_lastAt:this.now(),_proposed:0,sample:true}; }
  makeTrial(project, index) {
    const template = SAMPLE_TEMPLATES.find(t => t.id === project.template_id);
    const names = template.primary_metric === 'accuracy' ? ['调整隐藏层容量','增加迭代次数','调整初始学习率'] : ['调整学习率配置','调整训练轮数配置','调整模型参数配置'];
    const m = trialMetrics(template,index);
    return {ordinal:index, terminal:true, status:'valid', hypothesis:names[index%3], rationale:'模拟候选，用于检查界面与状态流转。不是实际模型建议或训练成绩。', metrics:m, delta:m[template.primary_metric]-baseline(template)[template.primary_metric], feedback_ordinals:Array.from({length:index},(_,i)=>i),sample:true};
  }
  getProject(id) { const p=this.data.projects.find(p => p.id===id); if(!p) throw new Error('研究项目不存在。'); return p; }
  getRun(id) { const r=this.data.projects.flatMap(p=>p.runs).find(r=>r.id===id); if(!r) throw new Error('运行记录不存在。'); return r; }
  templates() { return copy(SAMPLE_TEMPLATES); }
  projects() { this.tick(); return copy(this.data.projects); }
  project(id) { this.tick(); return copy(this.getProject(id)); }
  run(id) { this.tick(); return copy(this.getRun(id)); }
  create(body) { const project=this._newProject(body); this.data.projects.unshift(project); this.save(); return copy(project); }
  start(id) { const p=this.getProject(id); if(p.runs.some(r=>ACTIVE.has(r.status))) throw new Error('该项目已有运行中的研究。'); const r=this._newRun(p);p.runs.unshift(r);this.save();return copy(r); }
  stop(id) { this.tick(); const r=this.getRun(id);if(!ACTIVE.has(r.status))throw new Error('当前研究已经结束，不能再次停止。');r.status='cancelled';r.stop_reason='user_stop';this.save();return copy(r); }
  resume(id) {
    const r=this.getRun(id),p=this.getProject(r.project_id);
    if(!['cancelled','interrupted'].includes(r.status))throw new Error('只有停止或中断的研究可以继续。');
    if(r.elapsed>=p.budget.total_seconds)throw new Error('运行预算已耗尽，请创建新研究。');
    r.resume_history.push({previous_status:r.status,stop_reason:r.stop_reason||null,elapsed:r.elapsed,resumed_at:this.now()/1000});
    delete r.stop_reason;r.status='running';r._lastAt=this.now();this.save();return copy(r);
  }
  tick() {
    let changed=false;
    for(const p of this.data.projects) for(const r of p.runs) {
      if(!ACTIVE.has(r.status))continue;
      const template=SAMPLE_TEMPLATES.find(t=>t.id===p.template_id);
      r.elapsed=Math.min(p.budget.total_seconds,r.elapsed+Math.max(0,(this.now()-r._lastAt)/1000));r._lastAt=this.now();r.status='running';
      r.stage=r.elapsed<2?'baseline':'proposing';
      if(r.elapsed>=2)r.baseline=baseline(template);
      for(let i=0;i<p.budget.rounds;i++) {
        if(r.elapsed<3+i*3)break;
        if(r._proposed<=i) {
          if(r.llm_calls>=p.budget.max_llm_calls){r.status='budget_exhausted';r.stop_reason='model_call_budget_exhausted';break;}
          r._proposed=i+1;r.llm_calls++;
        }
        r.stage='experiment';r.current_round=i+1;
        if(r.elapsed>=6+i*3&&!r.trials.some(t=>t.ordinal===i))r.trials.push(this.makeTrial(p,i));
      }
      const finish=3+p.budget.rounds*3;
      if(r.status==='running'&&r.trials.length===p.budget.rounds) {
        r.stage=r.elapsed<finish+2?'confirmation':'final_evaluation';
        if(r.elapsed>=finish+2)r.confirmation={improved:true,mean_delta:r.trials.at(-1).delta};
        if(r.elapsed>=finish+4) {r.status='completed';r.stage='completed';r.final_evaluation={mean_delta:r.trials.at(-1).delta};if(template.primary_metric==='mse')r.forecast=curve();}
      }
      if(r.status==='running'&&r.elapsed>=p.budget.total_seconds){r.status='budget_exhausted';r.stop_reason='total_budget_exhausted';}
      changed=true;
    }
    if(changed)this.save();
  }
  export(id) { return {sample:true,notice:'样例预览记录；不包含真实训练或模型调用，不能作为实验成绩或阶段验收依据。',project:this.project(this.getRun(id).project_id),run:this.run(id)}; }
}
