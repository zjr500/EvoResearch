import {ResearchAPI} from './lib/api.js';
import {ArchiveAPI} from './lib/archive-api.js';
import {SampleStore} from './lib/sample-store.js';
import {icon} from './lib/icons.js';
import {escapeHTML as e, ACTIVE, validateBudget, createPayload} from './lib/model.js';
import {projectsView,runsView} from './views/projects.js';
import {createDialog} from './views/create.js';
import {resultsView} from './views/results.js';
import {handoffsView} from './views/handoffs.js';

const $=id=>document.getElementById(id);
let stored={}; try{stored=JSON.parse(localStorage.getItem('ar-phase2-config')||'{}');}catch{}
const config={mode:'sample',apiBase:'/api',healthUrl:'/health',pollInterval:2000,...window.AUTORESEARCH_CONFIG,...stored};
const modeFromURL=new URLSearchParams(location.search).get('mode');
if(['sample','live','handoff'].includes(modeFromURL))config.mode=modeFromURL;
const state={mode:['live','handoff'].includes(config.mode)?config.mode:'sample',templates:[],projects:[],health:null,selected:null,run:null,loading:true,busy:false,error:'',authRequired:false,filter:'all',search:'',layout:'grid'};
let client, requestEpoch=0, polling=false, toastTimer, lastFocus;
const sample=new SampleStore(localStorage);
const archive=new ArchiveAPI();
function apiClient(settings=config,token=sessionStorage.getItem('ar-local-token')||'') { return new ResearchAPI({base:settings.apiBase,healthUrl:settings.healthUrl,token}); }
function errorMessage(error) { return error.status===401 ? '需要重新连接研究服务。请在连接设置中填写有效的团队访问令牌。' : error instanceof TypeError ? '无法连接研究服务。请检查服务地址、访问配置或跨域设置；未自动替换为样例数据。' : error.message||String(error); }
function setError(error) {state.error=errorMessage(error);if(state.mode==='live'&&error.status===401){state.authRequired=true;state.health=null;}}
function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function route(){const parts=location.hash.replace(/^#\/?/,'').split('/');return {view:parts[0]||'projects',id:parts[1]||null};}
function modeStrip(){if(state.authRequired)return `<div class="mode-strip">${icon('info')}<span><b>真实服务 · 等待认证</b> · 连接后读取项目和运行记录。</span><button data-action="settings">重新连接 ${icon('settings')}</button></div>`;if(state.mode==='handoff')return `<div class="mode-strip record-strip">${icon('book')}<span><b>交接记录 · 只读</b> · 25f5706本机/服务器GLM历史响应，另保留10月20日规则控制记录；不是实时执行，来源逐条标识。</span><button data-action="settings">切换模式 ${icon('arrow')}</button></div>`;return state.mode==='sample'?`<div class="mode-strip">${icon('info')}<span><b>样例预览</b> · 所有指标、曲线和状态均为模拟，不执行训练，也不作为验收成绩。</span><button data-action="settings">连接真实服务 ${icon('arrow')}</button></div>`:`<div class="mode-strip live-strip">${icon('checkCircle')}<span><b>真实服务模式</b> · ${state.health?`${e(state.health.provider==='feedback_demo'?'规则提案':state.health.provider==='openai_compatible'?'模型服务提案（实际调用以记录为准）':state.health.provider||'服务已连接')} · ${e(state.health.runner||'执行方式待提供')}`:'服务尚未连接成功'}；页面仅展示服务返回内容。</span><button data-action="settings">连接设置 ${icon('settings')}</button></div>`;}
function render(){
  const activeElement=document.activeElement, focusId=activeElement?.id, selection=activeElement?.selectionStart;
  const current=route();
  $('nav').innerHTML=[['projects','grid','研究项目'],['runs','activity','运行记录'],['handoffs','folder','组内核对'],['guide','book','使用指南']].map(([path,ico,label])=>`<a href="#/${path}" aria-label="${label}" class="nav-item ${(current.view==='project'&&path==='projects'||current.view===path)?'active':''}" ${current.view===path?'aria-current="page"':''}>${icon(ico)}<span>${label}</span>${path==='projects'?'<small>工作台</small>':''}</a>`).join('')+`<button class="nav-item" data-action="settings" aria-label="连接设置">${icon('settings')}<span>连接设置</span></button>`;
  $('breadcrumb').textContent={projects:'研究项目',project:'研究详情',runs:'运行记录',handoffs:'组内核对',guide:'使用指南'}[current.view]||'研究项目';
  $('connection-button').innerHTML=`<i class="${state.mode==='live'&&!state.health?'offline':''}"></i>${state.mode==='handoff'?'交接记录 · 只读':state.mode==='sample'?'样例预览':state.authRequired?'需要重新认证':state.health?'研究服务已连接':'研究服务未连接'}`;
  let content='';
  if(current.view==='handoffs')content=handoffsView();
  else if(state.loading)content='<div class="loading-state"><span class="spinner"></span>正在读取研究记录…</div>';
  else if(state.authRequired&&['projects','project','runs'].includes(current.view))content=`<section class="surface empty-state" role="alert">${icon('info')}<h2>请重新连接研究服务</h2><p>当前尚未读取项目和运行记录，请先完成认证。</p><p>团队访问令牌仅在当前标签会话中保留；关闭标签后，重新打开时需要再次填写。关闭页面不会删除服务器上的项目和结果。</p><button class="button primary" data-action="settings">重新连接</button></section>`;
  else if(current.view==='project')content=state.selected?resultsView(state.selected,state.run,state.templates.find(t=>t.id===state.selected.template_id),state):'<div class="empty-state"><h2>没有找到这项研究</h2><p>请检查连接模式，或返回研究项目重新选择。</p><a class="button secondary" href="#/projects">返回研究项目</a></div>';
  else if(current.view==='runs')content=runsView(state);
  else if(current.view==='guide')content=guideView();
  else content=projectsView(state);
  if(current.view==='handoffs')$('connection-button').innerHTML=`${icon('book')}组内核对 · 只读`;
  const strip=current.view==='handoffs'?`<div class="mode-strip record-strip">${icon('book')}<span><b>成员材料 · 历史核对</b> · 不连接后台、不新跑训练。已同步25f5706完整工程；保留原件，不把核对截图当新运行。</span></div>`:modeStrip();
  $('main').innerHTML=strip+(state.error&&!state.authRequired&&current.view!=='handoffs'?`<div class="error-banner" role="alert">${icon('info')}<span>${e(state.error)}</span><button class="text-button" data-action="refresh">重试</button></div>`:'')+content;
  if(focusId&&$(focusId)){ $(focusId).focus({preventScroll:true});if(typeof selection==='number'&&$(focusId).setSelectionRange)try{$(focusId).setSelectionRange(selection,selection);}catch{} }
}
function guideView(){
  return `<section class="page-heading"><div><div class="eyebrow">GETTING STARTED</div><h1>让研究，有据可循<span class="heading-dot">.</span></h1><p>从确认目标开始，到可检查的研究记录结束。</p></div><button class="button primary" data-action="create">${icon('plus')}创建第一个研究</button></section><div class="guide-grid">${[['01','选择任务与填写目标','选择手写数字识别或服务支持的预测任务，设置候选轮数和总时间预算。'],['02','确认研究计划','核对修改范围、固定参照和预算。生成计划不会自动启动研究，确认后才开始执行。'],['03','查看尝试与反馈','查看阶段、每轮修改、有效性和指标。准确率越高越好；MSE、MAE越低越好，按实际任务判断。'],['04','停止、继续和保存','停止会终止当前执行；可继续停止或中断的运行。预算不清零，下载记录用于核对。']].map(([n,title,text])=>`<section class="surface guide-card"><span>${n}</span><h2>${title}</h2><p>${text}</p></section>`).join('')}</div><section class="surface guide-note"><h2>理解记录的边界</h2><p>有效实验不一定带来改善。验证均值改善不代表统计显著性；测试结果不反馈给本轮搜索。预算耗尽、失败和验证未完成均应保留原始状态。</p><p>当前样例用于界面开发和操作预演，未执行训练或模型调用。真实服务模式只显示服务器支持的任务；若暂不支持预测任务，需由后台提供统一模板与曲线产物后接入。</p><p>本地连接使用“连接设置”。默认同源 /api 可通过启动服务的 --backend 参数转发；本机开发令牌仅用于本地会话，不需要在浏览器配置模型密钥或平台签名密钥。</p><button class="button secondary" data-action="settings">${icon('settings')}打开连接设置</button></section>`;
}
async function readProjects(source){
  const projects=await source.projects();
  if(!Array.isArray(projects))throw new Error('项目列表格式与当前接口约定不一致。');
  return await Promise.all(projects.map(async p=>{
    const project=Array.isArray(p.runs)?p:await source.project(p.id);
    const latest=project.runs?.[0];
    if(latest&&!Array.isArray(latest.trials))project.runs[0]={...latest,...await source.run(latest.id)};
    return project;
  }));
}
async function loadAll(){
  const epoch=++requestEpoch;state.loading=true;state.error='';render();
  try{
    client=state.mode==='sample'?sample:state.mode==='handoff'?archive:apiClient();
    const [templates,projects,health]=await Promise.all([client.templates(),readProjects(client),state.mode==='sample'?Promise.resolve(null):client.health()]);
    if(epoch!==requestEpoch)return;
    if(!Array.isArray(templates))throw new Error('模板列表格式与当前接口约定不一致。');
    state.templates=templates;state.projects=projects;state.health=health;state.authRequired=false;
    if(route().view==='project')await loadSelected(route().id,null,false,epoch);
  }catch(error){if(epoch===requestEpoch){setError(error);state.health=null;state.projects=[];state.templates=[];state.selected=null;state.run=null;}}
  finally{if(epoch===requestEpoch){state.loading=false;render();}}
}
async function loadSelected(id,runId=null,redraw=true,epoch=requestEpoch){
  const project=await client.project(id);
  const run=runId||project.runs?.[0]?.id;
  const record=run?await client.run(run):null;
  if(epoch!==requestEpoch||route().id!==id)return;
  if(record)project.runs=(project.runs||[]).map(r=>r.id===record.id?{...r,...record}:r);
  state.selected=project;state.run=record;
  if(redraw)render();
}
function showDialog(html){
  lastFocus=document.activeElement;$('modal-root').innerHTML=html;
  const dialog=$('app-dialog');dialog.showModal();
  dialog.addEventListener('close',()=>{$('modal-root').replaceChildren();lastFocus?.isConnected&&lastFocus.focus();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
}
function settingsDialog(){
  showDialog(`<dialog class="dialog settings-dialog" id="app-dialog" aria-labelledby="settings-title"><form id="settings-form"><header class="dialog-header"><div><span class="eyebrow">CONNECTION</span><h2 id="settings-title">连接研究服务</h2><p>样例预演与真实研究分开保存、清楚标识。</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></header><div class="dialog-body"><fieldset><legend>工作模式</legend><div class="mode-options"><label><input type="radio" name="mode" value="sample" ${state.mode==='sample'?'checked':''}><span><b>样例预览</b><small>浏览器内模拟流程，不执行训练</small></span></label><label><input type="radio" name="mode" value="handoff" ${state.mode==='handoff'?'checked':''}><span><b>交接记录（只读）</b><small>区分本机/服务器DLinear与旧控制记录，不启动研究</small></span></label><label><input type="radio" name="mode" value="live" ${state.mode==='live'?'checked':''}><span><b>真实服务</b><small>读取团队服务，执行真实接口操作</small></span></label></div></fieldset><div id="live-fields" ${state.mode!=='live'?'hidden':''}><label>API基础地址<input name="apiBase" value="${e(config.apiBase)}" placeholder="/api"></label><label>健康检查地址<input name="healthUrl" value="${e(config.healthUrl)}" placeholder="/health"></label><label>团队访问令牌（本地转发已加载时留空）<input type="password" name="token" value="${e(sessionStorage.getItem('ar-local-token')||'')}" autocomplete="off"></label><p class="field-help">同源默认使用 /api 和 /health。团队地址由童宇昕提供；需要跨域或平台认证时由服务侧配置。令牌仅在当前标签会话中保留，关闭标签后需重新填写；服务器上的项目和结果会保留。不要填写模型密钥。</p></div><div class="inline-note">${icon('info')}真实服务连接失败时显示错误，不自动切换为样例。样例数据只保存在本浏览器。</div><p id="form-error" class="form-error" role="alert" hidden></p></div><footer class="dialog-footer"><button type="button" class="button secondary" data-action="close-modal">取消</button><button type="submit" class="button primary">保存并连接 ${icon('arrow')}</button></footer></form></dialog>`);
}
function formError(message){$('form-error').textContent=message;$('form-error').hidden=false;}
function safeAddress(value){const url=new URL(value,location.href);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('服务地址应为HTTP(S)地址或同源路径，不在地址中填写账号密码。');return value.replace(/\/$/,'');}
async function saveSettings(form){
  const data=new FormData(form),mode=data.get('mode');
  let nextClient=sample,projects,templates,health=null;
  const next={...config,mode};
  if(mode==='live'){
    next.apiBase=safeAddress(String(data.get('apiBase')).trim());next.healthUrl=safeAddress(String(data.get('healthUrl')).trim());
    nextClient=apiClient(next,String(data.get('token')||''));
    [health,templates,projects]=await Promise.all([nextClient.health(),nextClient.templates(),readProjects(nextClient)]);
    if(!Array.isArray(templates))throw new Error('任务模板响应需要是数组，连接设置未保存。');
  }else if(mode==='handoff'){nextClient=archive;[templates,projects,health]=await Promise.all([archive.templates(),readProjects(archive),archive.health()]);}else{templates=sample.templates();projects=sample.projects();}
  Object.assign(config,next);client=nextClient;state.mode=mode;state.templates=templates;state.projects=projects;state.health=health;state.authRequired=false;state.selected=null;state.run=null;state.error='';
  localStorage.setItem('ar-phase2-config',JSON.stringify({mode,apiBase:config.apiBase,healthUrl:config.healthUrl}));
  if(mode==='live')sessionStorage.setItem('ar-local-token',String(data.get('token')||''));
  const nextURL=new URL(location.href);nextURL.searchParams.set('mode',mode);nextURL.hash='/projects';history.replaceState(null,'',nextURL);$('app-dialog').close();render();toast(mode==='handoff'?'已打开只读交接记录，不会启动研究。':mode==='sample'?'已进入样例预览；不执行训练。':'已连接真实研究服务。');
}
async function downloadResponse(response,name){const url=URL.createObjectURL(await response.blob());downloadURL(url,name);}
function downloadURL(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportRun(){if(!state.run)return;if(state.mode==='sample'){const data=sample.export(state.run.id);downloadURL(URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),state.run.id+'.json');toast('已导出样例JSON，文件中已注明非真实实验。');}else await downloadResponse(await client.export(state.run.id),state.run.id+(state.mode==='handoff'?'-交接记录.json':'.zip'));}
async function act(action,button){
  if(action==='settings')return settingsDialog();
  if(action==='close-modal')return $('app-dialog')?.close();
  if(action==='create'){if(state.mode==='handoff')return toast('交接记录为只读，请切换到样例或真实服务后创建。');if(!state.templates.length){toast('请先连接可用服务，或在连接设置选择样例预览。');return;}return showDialog(createDialog(state.templates,state.mode));}
  if(action==='filter'){state.filter=button.dataset.filter;return render();}
  if(action==='layout'){state.layout=button.dataset.layout;return render();}
  if(action==='clear-search'){state.search='';return render();}
  if(action==='open'||action==='open-run'){
    state.selected=null;state.run=null;const hash=`#/project/${encodeURIComponent(button.dataset.id)}`;
    if(location.hash!==hash){location.hash=hash;if(action==='open-run')sessionStorage.setItem('ar-selected-run',button.dataset.run);}
    else await loadSelected(button.dataset.id,button.dataset.run);
    return;
  }
  if(action==='refresh')return loadAll();
  if(action==='archive-report')return downloadResponse(await archive.report(),'童宇昕_正常完成交接报告.md');
  if(state.mode==='handoff'&&['start','stop','resume'].includes(action))return toast('交接记录只读，不能控制历史运行。');
  if(state.busy)return;
  state.busy=true;
  const startDisabled=$('start-run')?.disabled;
  try{
    if(action==='start'){
      if(!$('confirm-plan')?.checked)return toast('请先确认研究目标和预算。');
      $('start-run').disabled=true;
      await client.start(state.selected.id,{confirmer:$('plan-confirmer')?.value||'',opinion:$('plan-opinion')?.value||''});await loadSelected(state.selected.id);state.projects=await readProjects(client);render();toast(state.mode==='sample'?'正在播放样例状态流转，不执行训练。':'研究已提交，等待后台执行。');
    }else if(action==='stop'||action==='resume'){
      await client[action](state.run.id);await loadSelected(state.selected.id,state.run.id);state.projects=await readProjects(client);toast(action==='stop'?'已提交停止请求，请查看实际状态。':'已提交继续请求，累计预算保留。');
    }else if(action==='export')await exportRun();
    else if(action==='artifact')await downloadResponse(await client.artifact(button.dataset.id),button.dataset.name);
  }catch(error){setError(error);if($('start-run'))$('start-run').disabled=!!startDisabled;}
  finally{state.busy=false;render();}
}
document.addEventListener('click',event=>{if(event.target.closest('.skip-link')){event.preventDefault();$('main').focus();return;}const button=event.target.closest('[data-action]');if(button&&!button.disabled)act(button.dataset.action,button).catch(error=>{setError(error);render();});});
document.addEventListener('input',event=>{if(event.target.id==='project-search'){state.search=event.target.value;render();}});
document.addEventListener('change',event=>{
  if(event.target.id==='confirm-plan')$('start-run').disabled=!event.target.checked;
  if(event.target.id==='run-selector')loadSelected(state.selected.id,event.target.value).catch(error=>{setError(error);render();});
  if(event.target.name==='template'){const t=state.templates.find(t=>t.id===event.target.value);$('task-description').textContent=t?.description||'';}
  if(event.target.name==='mode')$('live-fields').hidden=event.target.value!=='live';
});
document.addEventListener('submit',async event=>{
  if(!['create-form','settings-form'].includes(event.target.id))return;event.preventDefault();
  const form=event.target,button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    if(form.id==='settings-form')await saveSettings(form);
    else{
      const data=new FormData(form),budget=validateBudget({rounds:Number(data.get('rounds')),total_seconds:Number(data.get('total_seconds')),experiment_seconds:Number(data.get('experiment_seconds')),max_llm_calls:Number(data.get('max_llm_calls'))});
      const template=state.templates.find(t=>t.id===String(data.get('template')));
      const p=await client.create(createPayload(template,String(data.get('goal')),budget));
      $('app-dialog').close();location.hash=`#/project/${encodeURIComponent(p.id)}`;toast('研究计划已生成，请核对后确认启动。');
      try { state.projects=await readProjects(client); } catch(error) { state.error='计划已创建，但列表刷新失败；请勿重复创建。'+errorMessage(error); }
    }
  }catch(error){formError(errorMessage(error));}finally{if(button.isConnected)button.disabled=false;}
});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&!$('app-dialog')?.open){event.preventDefault();$('project-search')?.focus();}});
window.addEventListener('hashchange',async()=>{
  const epoch=++requestEpoch,current=route();state.error='';
  if(!client&&current.view!=='handoffs'){await loadAll();return;}
  if(current.view==='project'){
    state.loading=true;render();
    try{const selected=sessionStorage.getItem('ar-selected-run');sessionStorage.removeItem('ar-selected-run');await loadSelected(decodeURIComponent(current.id),selected,false,epoch);}catch(error){setError(error);state.selected=null;state.run=null;}finally{if(epoch===requestEpoch){state.loading=false;render();window.scrollTo(0,0);}}
  }else{state.selected=null;state.run=null;state.loading=false;render();window.scrollTo(0,0);}
});
setInterval(async()=>{
  if(polling||route().view==='handoffs'||state.mode==='handoff'||state.loading||state.busy||document.hidden||$('app-dialog')?.open)return;
  const current=route(),epoch=requestEpoch;polling=true;
  try{
    if(current.view==='project'&&state.run&&ACTIVE.has(state.run.status)){
      await loadSelected(state.selected.id,state.run.id,false,epoch);
      if(epoch!==requestEpoch)return;
      state.projects=state.projects.map(p=>p.id===state.selected.id?state.selected:p);state.error='';render();
    }else if(state.projects.some(p=>(p.runs||[]).some(r=>ACTIVE.has(r.status)))){
      const projects=state.mode==='sample'?sample.projects():await readProjects(client);
      if(epoch!==requestEpoch)return;
      state.projects=projects;if(['projects','runs'].includes(current.view))render();
    }
  }catch(error){if(epoch===requestEpoch){setError(error);render();}}finally{polling=false;}
},Math.max(1000,Number(config.pollInterval)||2000));
if(route().view==='handoffs'){state.loading=false;render();}else loadAll();
