import {randomUUID} from 'node:crypto';
// Run only in an isolated DSH profile with synthetic fixtures; never invokes a model.
import {writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
export const name='evoresearch-local-probe';
export const inject=['evoresearchLocalExecution','evoresearchModels','evoresearchOperations','fs','webServer','agents'];
export function apply(ctx){
 const local=ctx.get('evoresearchLocalExecution'),ops=ctx.get('evoresearchOperations');
 const root=process.env.EVORESEARCH_PROBE_ROOT,python=process.env.EVORESEARCH_PROBE_PYTHON,resultFile=process.env.EVORESEARCH_PROBE_RESULT;
 if(!root||!python||!resultFile)throw new Error('Explicit isolated probe paths required');
 const cwd=join(root,'workspace');const report={modelCalls:0};
 let agentHandle;const sessionId=randomUUID();
 ctx.on('llm/stream',()=>{report.modelCalls++;throw new Error('Model calls disabled during validation');});
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const text=id=>local.output(1,id,0).chunks.map(c=>c.text).join('');
 async function started(op){for(let i=0;i<200;i++){const r=local.lookup(1,op.operation_id);if(r?.job_id)return r;if(r?.status==='failed')throw new Error('Python launch failed');await pause(100);}throw new Error('Job start timed out');}
 async function finished(id,ms=60000){const until=Date.now()+ms;while(Date.now()<until){const r=local.status(1,id);if(!['starting','running','stopping'].includes(r.status))return r;await pause(100);}await local.stop(1,id);throw new Error('Probe job timed out');}
 const watchdog=setTimeout(()=>{writeFileSync(resultFile,JSON.stringify({...report,error:'Host probe timeout'},null,2));process.exit(3);},150000);
 (async()=>{
  try{
   agentHandle=await ctx.agents.create({sessionId,meta:{cwd}});report.nativeAgentSession=Boolean(ctx.agents.get(sessionId));
   // File writes/reads use the same DSH filesystem service as Agent tools.
   const target=await ctx.fs.resolve(join(cwd,'native-file.txt'));
   await ctx.fs.writeText(target,'native-filesystem-ok',undefined,undefined,{mode:'workspace-write',workspaceRoot:cwd});
   report.nativeFilesystem=await ctx.fs.readText(target)==='native-filesystem-ok';
   const op=local.startPython(1,'stream-'+Date.now(),{python,cwd,sessionId,script:join(cwd,'stream.py')});
   const running=await started(op);await pause(1200);const first=text(running.execution_id);await pause(600);const second=text(running.execution_id);
   report.streaming={execution_id:running.execution_id,job_id:running.job_id,status:local.status(1,running.execution_id).status,grew:second.length>first.length,enforcement:running.enforcement};
   const pids=second.split(/\r?\n/).map(x=>{try{return JSON.parse(x);}catch{return null;}}).find(x=>x?.parent_pid);
   report.stop=await local.stop(1,running.execution_id);await finished(running.execution_id);await pause(300);
   const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
   report.processTree=pids?{...pids,parentAlive:alive(pids.parent_pid),childAlive:alive(pids.child_pid)}:{notObserved:true};
   report.operation=ops.getPublic(1,op.operation_id);
   const envOp=local.checkEnvironment(1,'env-'+Date.now(),{python,cwd,sessionId});const env=await started(envOp);await finished(env.execution_id);
   const envLines=text(env.execution_id).split(/\r?\n/).filter(x=>x.startsWith('{'));report.environment=envLines.length?JSON.parse(envLines.at(-1)):{status:local.status(1,env.execution_id).status};
   const accessOp=local.startPython(1,'access-'+Date.now(),{python,cwd,sessionId,script:join(cwd,'access.py'),args:[root]});const access=await started(accessOp);await finished(access.execution_id);
   const accessLines=text(access.execution_id).split(/\r?\n/).filter(x=>x.startsWith('{'));report.sandboxAccess=accessLines.length?JSON.parse(accessLines.at(-1)):{status:local.status(1,access.execution_id).status};
   appendFileSync(join(root,'access-log.jsonl'),JSON.stringify({time:new Date().toISOString(),synthetic:true,result:report.sandboxAccess})+'\n');
   report.publicUnauthenticated=(await fetch(ctx.webServer.getOrigin()+'/operations/'+op.operation_id)).status;
   report.executionPassed=report.nativeAgentSession&&report.nativeFilesystem&&report.streaming.grew&&report.stop.terminationConfirmed&&report.processTree.parentAlive===false&&report.processTree.childAlive===false&&report.publicUnauthenticated===401&&report.modelCalls===0;
   if(!report.executionPassed)report.error='Local execution acceptance failed';
  }catch(e){report.error=e instanceof Error?e.message:'Probe failed';}
  finally{await local.dispose();await agentHandle?.dispose();clearTimeout(watchdog);writeFileSync(resultFile,JSON.stringify(report,null,2));process.exit(report.error?2:0);}
 })();
}
