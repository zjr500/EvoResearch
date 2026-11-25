import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {openDatabase} from '../../dist/infrastructure/database.js';
import {installKnowledge} from '../../dist/knowledge/plugin.js';
import {PurposeModels} from '../../dist/infrastructure/models.js';
export const inject=['connection','webServer'];
export function apply(ctx){
 const root=process.env.EVORESEARCH_UC01_ROOT;if(!root)throw Error('Explicit isolated UC01 root required');
 let cleanup,store;const report={model:'mock DSH stream',realHost:'0.2.1-rc.2',paidCalls:0};
 const timeout=setTimeout(()=>{writeFileSync(join(root,'host-result.json'),JSON.stringify({error:'timeout'}));process.exit(2)},60000);
 void(async()=>{try{
  await new Promise(r=>setTimeout(r,1500));
  let calls=0;
  const llm={listProviders:()=>[{id:'fixture',name:'Fixture'}],async listModels(){return [{id:'summary'}]},listConfigurableProviders:()=>[],async *stream(){calls++;yield {type:'text-delta',text:JSON.stringify({method:'Mock method',datasets:'Synthetic PDF',conclusions:'Mock conclusion'})};}};
  const defaults={currentSelection:()=>({provider:'fixture',model:'summary'})};
  const models=new PurposeModels(llm,defaults,{});
  store=openDatabase({databasePath:join(root,'host-'+Date.now()+'.sqlite')});
  cleanup=installKnowledge({provide:()=>()=>{},connection:ctx.connection,webServer:ctx.webServer,llm,get:n=>n==='evoresearchModels'?models:n==='agentDefaultModel'?defaults:undefined},store);
  const origin=ctx.webServer.getOrigin();
  report.unauthenticated=(await fetch(origin+'/papers/1')).status;assert.equal(report.unauthenticated,401);
  // Public DSH browser bootstrap for this disposable profile only. Never persist credentials.
  const authenticated=await fetch(ctx.connection.authenticatedUrl(origin+'/'),{redirect:'manual'});
  const cookies=authenticated.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  assert.ok(cookies,'DSH browser bootstrap must issue cookie');
  const call=async(method,path,body)=>{const res=await fetch(origin+path,{method,headers:{cookie:cookies,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await res.json();assert.equal(result.code,0,method+' '+path+' failed');return result.data;};
  const wait=async op=>{for(let i=0;i<200;i++){const r=await call('GET','/kb/operations/'+op.operation_id);if(r.status==='成功')return r.result;if(r.status==='失败')throw Error('Operation failed: '+r.error_code);await new Promise(r=>setTimeout(r,30));}throw Error('Operation timeout');};
  await wait(await call('PUT','/models/summary',{idempotency_key:'configure',model_choice:{mode:'dsh-default'},expected_revision:0}));
  const imported=await wait(await call('POST','/papers',{idempotency_key:'upload',pdf_base64:readFileSync(join(root,'fixture.pdf')).toString('base64')}));
  const p=imported.paper;assert.equal(p.summary.method,'Mock method');assert.equal((await call('GET','/kb/entries')).entries.length,0);
  const edited=await wait(await call('PATCH','/papers/'+p.paper_id,{idempotency_key:'edit',expected_revision:p.revision,title:'Reviewed in real DSH',summary:{...p.summary,conclusions:'User corrected'}}));
  const result=await wait(await call('POST','/papers/confirm',{idempotency_key:'confirm',paper_ids:[p.paper_id],expected_revisions:{[p.paper_id]:edited.revision}}));
  assert.equal(result.items[0].code,0);const entry=await call('GET','/kb/entries/'+result.items[0].paper.document_id);assert.equal(entry.content.conclusions,'User corrected');assert.equal(entry.index_status,'pending');
  report.patchAndBatchConfirm=true;report.summaryCalls=calls;report.document_id=entry.document_id;report.draftExcluded=true;report.indexStatus=entry.index_status;assert.equal(calls,1);
 }catch(e){report.error=e.message;}finally{await cleanup?.();store?.close();clearTimeout(timeout);writeFileSync(join(root,'host-result.json'),JSON.stringify(report,null,2));process.exit(report.error?2:0);}})();
}

