import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppError,ownerId} from './errors.js';
import {OperationService} from './operations.js';
// Structural subsets of the fixed-version DSH public APIs; no second process manager.
interface Read {text:string;nextOffset:number;lossy:boolean;spillPath?:string}
interface Handle {
 collected:{stdout?:{readFrom(offset:number):Read};stderr?:{readFrom(offset:number):Read}};
 done:Promise<{exitCode:number|null;signal:string|null}>;
 terminate():void;waitForExit(signal?:AbortSignal):Promise<boolean>;
}
interface Outcome {status:'completed'|'killed'|'failed';detail?:string}
export interface LocalServices {
 subprocess:{resolveExecutable(command:string):Promise<string>;spawn(spec:{argv:readonly string[];cwd:string;stdio:{stdin:'ignore';stdout:{maxBytes:number};stderr:{maxBytes:number}};graceMs:number}):Handle};
 sandbox:{confine(argv:readonly string[],policy:{mode:'workspace-write';workspaceRoot:string;sessionId?:string}):Promise<{argv:string[];enforcement:'full'|'partial'}>};
 jobs:{attachController(name:string):()=>void;start(spec:{kind:string;label:string;owner?:string;output:{channel:'stdout'|'stderr';read(offset:number):Read}[];run(job:{id:string}):{cancel():void;done:Promise<Outcome>}}):string;
 get(id:string,caller?:string):unknown;readAt(id:string,from:number,caller?:string):unknown;kill(id:string,caller?:string,reason?:string):string};
 fs:{resolve(path:string,options?:{cwd?:string}):Promise<any>;processPath(target:any):string};
}
export interface PythonExecution {python:string;cwd:string;script:string;args?:string[];sessionId?:string}
export class LocalExecution {
 private operations:OperationService;
 private detach:()=>void;
 private handles=new Map<string,Handle>();
 private closing=false;
 private disposal?:Promise<void>;
 constructor(private db:Database.Database,private native:LocalServices) {
  this.operations=new OperationService(db,'local-execution');
  this.detach=native.jobs.attachController('evoresearch-local-execution');
  // Native process/job handles are process-local. Never guess termination after a restart.
  db.prepare("UPDATE local_executions SET status='unknown',termination_confirmed=0,updated_at=CURRENT_TIMESTAMP WHERE status IN ('starting','running','stopping')").run();
  this.operations.recoverInterrupted();
 }
 startPython(owner:number,key:unknown,input:PythonExecution) {
  ownerId(owner);
  if(this.closing)throw new AppError(4009,'Local execution is shutting down');
  if(!input||!input.python||!isAbsolute(input.cwd)||!isAbsolute(input.script)||!Array.isArray(input.args??[])||(input.args??[]).some(x=>typeof x!=='string'))throw new AppError(4001,'Absolute workspace/script and a Python executable required');
  // Snapshot caller-owned arguments before the async claim starts.
  const spec={python:input.python,cwd:input.cwd,script:input.script,args:[...(input.args??[])],sessionId:input.sessionId};
  let accepted:Record<string,unknown>;
  accepted=this.operations.submit(owner,key,'local-python',spec,()=>this.run(owner,Number(accepted.operation_id),spec));
  return accepted;
 }
 checkEnvironment(owner:number,key:unknown,input:{python:string;cwd:string;sessionId?:string}) {
  return this.startPython(owner,key,{...input,script:fileURLToPath(new URL('../../scripts/probes/environment.py',import.meta.url))});
 }
 private async run(owner:number,operationId:number,input:PythonExecution) {
  const id=randomUUID();
  this.db.prepare("INSERT INTO local_executions(execution_id,operation_id,owner_id,session_id,status) VALUES(?,?,?,?,'starting')").run(id,operationId,owner,input.sessionId??null);
  let handle:Handle|undefined;let killed=false;
  try {
   const cwd=this.native.fs.processPath(await this.native.fs.resolve(input.cwd));
   const script=this.native.fs.processPath(await this.native.fs.resolve(input.script,{cwd}));
   const python=await this.native.subprocess.resolveExecutable(input.python);
   const confined=await this.native.sandbox.confine([python,'-u',script,...(input.args??[])],{mode:'workspace-write',workspaceRoot:cwd,...(input.sessionId?{sessionId:input.sessionId}:{})});
   if(this.closing)throw new AppError(4009,'Local execution is shutting down');
   const output=(channel:'stdout'|'stderr')=>({channel,read:(offset:number)=>handle?.collected[channel]?.readFrom(offset)??{text:'',nextOffset:offset,lossy:false}});
   let finished!:Promise<Outcome>;
   const jobId=this.native.jobs.start({kind:'bash',label:'EvoResearch local Python',owner:input.sessionId,output:[output('stdout'),output('stderr')],run:()=>{
    handle=this.native.subprocess.spawn({argv:confined.argv,cwd,stdio:{stdin:'ignore',stdout:{maxBytes:1024*1024},stderr:{maxBytes:1024*1024}},graceMs:2000});
    this.handles.set(id,handle);
    finished=(async()=>{
     try {
      const outcome=await handle!.done;
      const empty=await handle!.waitForExit(AbortSignal.timeout(10000));
      const state=!empty?'unknown':killed?'killed':outcome.exitCode===0?'completed':'failed';
      this.db.prepare('UPDATE local_executions SET status=?,exit_code=?,termination_confirmed=?,updated_at=CURRENT_TIMESTAMP WHERE execution_id=?').run(state,outcome.exitCode,empty?1:0,id);
      return {status:state==='unknown'?'failed':state,detail:empty?`exit code: ${outcome.exitCode}`:'Process tree termination unconfirmed'} as Outcome;
     }catch{
      this.db.prepare("UPDATE local_executions SET status='unknown',termination_confirmed=0,updated_at=CURRENT_TIMESTAMP WHERE execution_id=?").run(id);
      return {status:'failed',detail:'Native process outcome unavailable'} as Outcome;
     }finally{const row=this.db.prepare('SELECT termination_confirmed FROM local_executions WHERE execution_id=?').get(id) as any;if(row?.termination_confirmed)this.handles.delete(id);}
    })();
    return {cancel:()=>{handle!.terminate();killed=true;this.db.prepare("UPDATE local_executions SET status='stopping',updated_at=CURRENT_TIMESTAMP WHERE execution_id=?").run(id);},done:finished};
   }});
   this.db.prepare("UPDATE local_executions SET job_id=?,status='running',enforcement=?,updated_at=CURRENT_TIMESTAMP WHERE execution_id=?").run(jobId,confined.enforcement,id);
   const outcome=await finished;
   if(outcome.status==='failed')throw new AppError(5000,'Local execution failed or termination is unconfirmed',{execution_id:id,job_id:jobId});
   if(outcome.status==='killed')throw new AppError(4009,'Local execution stopped',{execution_id:id,job_id:jobId,status:'killed'});
   return {execution_id:id,job_id:jobId,status:outcome.status};
  }catch(error){
   if(handle&&this.handles.has(id)){
    handle.terminate();const empty=await handle.waitForExit(AbortSignal.timeout(10000)).catch(()=>false);
    if(empty){this.db.prepare("UPDATE local_executions SET termination_confirmed=1,status='failed',updated_at=CURRENT_TIMESTAMP WHERE execution_id=?").run(id);this.handles.delete(id);}
   }
   this.db.prepare("UPDATE local_executions SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE execution_id=? AND status='starting'").run(id);
   if(error instanceof AppError)throw error;
   throw new AppError(5000,'DSH local Python launch failed; check executable and sandbox availability',{execution_id:id});
  }
 }
 lookup(owner:number,operationId:number) {
  this.operations.get(owner,operationId);
  return this.db.prepare('SELECT * FROM local_executions WHERE owner_id=? AND operation_id=?').get(ownerId(owner),operationId) as any;
 }
 private record(owner:number,id:string) {
  const row=this.db.prepare('SELECT * FROM local_executions WHERE execution_id=? AND owner_id=?').get(id,ownerId(owner)) as any;
  if(!row)throw new AppError(4004,'Execution not found');return row;
 }
 status(owner:number,id:string){const r=this.record(owner,id);let job:unknown=null;try{if(r.job_id)job=this.native.jobs.get(r.job_id,r.session_id??undefined);}catch{/* Durable history survives native registry restart; no live state is claimed. */}return {...r,job};}
 output(owner:number,id:string,from=0){const r=this.record(owner,id);if(!r.job_id)throw new AppError(4009,'Job has not started');return this.native.jobs.readAt(r.job_id,from,r.session_id??undefined);}
 async stop(owner:number,id:string) {
  const r=this.record(owner,id);const handle=this.handles.get(id);
  if(!handle){if(r.termination_confirmed)return {terminationConfirmed:true};throw new AppError(4009,'No live native handle; termination cannot be confirmed');}
  this.native.jobs.kill(r.job_id,r.session_id??undefined,'EvoResearch owner requested stop');
  handle.terminate();
  const empty=await handle.waitForExit(AbortSignal.timeout(10000));
  if(empty){this.db.prepare('UPDATE local_executions SET termination_confirmed=1,updated_at=CURRENT_TIMESTAMP WHERE execution_id=?').run(id);}
  return {terminationConfirmed:empty};
 }
 drain(){return this.operations.drain();}
 dispose(){return this.disposal??=(async()=>{this.closing=true;for(const handle of this.handles.values())handle.terminate();try{await this.operations.drain();for(const handle of this.handles.values()){if(!await handle.waitForExit(AbortSignal.timeout(10000)))throw new AppError(5000,'Native process termination unconfirmed');}}finally{this.detach();}})();}
}
