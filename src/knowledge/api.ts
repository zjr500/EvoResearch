import {success,failure,objectBody,resourceId} from '../infrastructure/http.js';
import {ownerId} from '../infrastructure/errors.js';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { Operations } from './operations.js';
import {
 KnowledgeError,
 importPaper,
 confirmPaper,
 summarizePaper,
 paperFor,
 entryFor,
 listEntries,
 paperView,
 updatePendingPaper
} from './paper-service.js';
import {parseModelChoice,type SummaryConfiguration} from './model-configuration.js';
import type { SummaryModel } from './summary-model.js';
export function knowledgeApi(db:Database.Database,operations:Operations,storageDir:string,model:SummaryModel,models?:SummaryConfiguration) {
 return async (request:Request,owner:number):Promise<Response>=>{
  try {
   ownerId(owner);
   const url=new URL(request.url), path=url.pathname.replace(/^\/api/,'');
   const idMatch=path.match(/^\/(?:papers|kb\/entries|kb\/operations)\/(\d+)(?:\/summary)?$/);
   const id=idMatch?resourceId(idMatch[1]):0;
   if(request.method==='GET') {
    let data:unknown;
    if(path==='/models/summary') { if(!models)throw new KnowledgeError(4009,'Model service unavailable'); data=models.view(owner); }
    else if(path==='/models') { if(!models)throw new KnowledgeError(4009,'Model service unavailable'); if(url.searchParams.get('purpose')!=='summary')throw new KnowledgeError(4001,'This endpoint currently supports summary only'); data={...models.directory() as object,selection:models.view(owner)}; }
    else if(path.startsWith('/models/')) { if(!models)throw new KnowledgeError(4009,'Model service unavailable'); data=await models.models(decodeURIComponent(path.slice(8))); }
    else if(path==='/kb/entries') data=listEntries(db,owner,url.searchParams);
    else if(id && path.startsWith('/papers/')) { data=paperView(db,owner,id); }
    else if(id && path.startsWith('/kb/entries/')) data=entryFor(db,owner,id);
    else if(id && path.startsWith('/kb/operations/')) data=operations.get(owner,id);
    else throw new KnowledgeError(4004,'Route not found');
    return success(data);
   }
   const body=await objectBody(request);
   const {idempotency_key,...input}=body;
   if(input.model_choice!==undefined)parseModelChoice(input.model_choice);
   let task:()=>Promise<unknown>, operationType:string, fingerprint:unknown=input;
   if(request.method==='PUT' && path==='/models/summary') {
    if(!models)throw new KnowledgeError(4009,'Model service unavailable');
    if(Object.keys(input).some(k=>!['model_choice','expected_revision'].includes(k))||!Number.isSafeInteger(input.expected_revision)||Number(input.expected_revision)<0)throw new KnowledgeError(4001,'model_choice and expected_revision required');
    operationType='summary-model-config';task=()=>models.configure(owner,input.model_choice,Number(input.expected_revision));
   } else if(request.method==='POST' && path==='/papers/confirm') {
    if(Object.keys(input).some(k=>!['paper_ids','expected_revisions'].includes(k))||!Array.isArray(input.paper_ids)||!input.paper_ids.length||input.paper_ids.length>100||new Set(input.paper_ids).size!==input.paper_ids.length)throw new KnowledgeError(4001,'Provide 1 to 100 distinct paper_ids');
    const ids=input.paper_ids.map(x=>{if(typeof x!=='number')throw new KnowledgeError(4001,'Invalid paper ID');return resourceId(String(x));});
    const revisions=input.expected_revisions;
    if(!revisions||typeof revisions!=='object'||Array.isArray(revisions)||Object.keys(revisions).length!==ids.length||ids.some(id=>!Number.isSafeInteger((revisions as any)[id])||(revisions as any)[id]<0))throw new KnowledgeError(4001,'expected_revisions required for every paper');
    operationType='paper-batch-confirm';
    task=async()=>({items:ids.map(paper_id=>{try{confirmPaper(db,owner,paper_id,{expected_revision:(revisions as any)[paper_id]});return {paper_id,code:0,paper:paperView(db,owner,paper_id)};}catch(e){return {paper_id,code:e instanceof KnowledgeError?e.code:5000,message:e instanceof KnowledgeError?e.message:'Confirmation failed'};}})});
   } else if(request.method==='POST' && path==='/papers') {
    if(Object.keys(input).some(k=>!['pdf_base64','model_choice'].includes(k))||typeof input.pdf_base64!=='string'||!input.pdf_base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.pdf_base64)) throw new KnowledgeError(4001,'pdf_base64 required');
    const buffer=Buffer.from(input.pdf_base64,'base64');
    fingerprint={sha256:createHash('sha256').update(buffer).digest('hex'),...(input.model_choice===undefined?{}:{model_choice:input.model_choice})}; operationType='paper-import';
    task=async()=>{
     const result=await importPaper(db,{filePath:'upload.pdf',uploaderId:owner,buffer,storageDir});
     if(result.duplicated && result.paper.parse_error && !result.paper.full_text)throw new KnowledgeError(4001,'Existing PDF could not be parsed; complete metadata manually',{paper:paperView(db,owner,result.paper.paper_id)});
     // Duplicate uploads never automatically incur a second model call.
     if(!result.duplicated) {
      try {const chosen=models?await models.snapshot(owner,input.model_choice):model; await summarizePaper(db,owner,result.paper.paper_id,chosen);}
      catch {db.prepare("UPDATE papers SET summary_status='failed',summary_error='DSH model unavailable or summary generation failed' WHERE paper_id=? AND uploader_id=? AND summary_run IS NULL AND pending_summary IS NULL").run(result.paper.paper_id,owner);throw new KnowledgeError(4009,'Summary generation failed; paper retained for retry',{paper:paperView(db,owner,result.paper.paper_id),duplicated:false});}
     }
     return {paper:paperView(db,owner,result.paper.paper_id),duplicated:result.duplicated};
    };

    } else if(request.method==='PATCH' && /^\/papers\/\d+$/.test(path)) {
        paperFor(db,owner,id);
        if(!Number.isSafeInteger(input.expected_revision)||Number(input.expected_revision)<0)throw new KnowledgeError(4001,'expected_revision required');
        if('summary' in input){if('pending_summary' in input)throw new KnowledgeError(4001,'Provide only summary');input.pending_summary=input.summary;delete input.summary;}
        operationType='paper-edit';
        task=async()=>{
        updatePendingPaper(db,owner,id,input);
        return paperView(db,owner,id);
        };
    } else if(request.method==='PUT' && /^\/papers\/\d+$/.test(path)) {

    paperFor(db,owner,id); if(!Number.isSafeInteger(input.expected_revision)||Number(input.expected_revision)<0)throw new KnowledgeError(4001,'expected_revision required'); operationType='paper-confirm'; task=async()=>{confirmPaper(db,owner,id,input);return paperView(db,owner,id);};
   } else if(request.method==='POST' && /^\/papers\/\d+\/summary$/.test(path)) {
    paperFor(db,owner,id); if(Object.keys(input).some(k=>k!=='model_choice')) throw new KnowledgeError(4001,'Only model_choice allowed');
    operationType='paper-summary'; task=async()=>summarizePaper(db,owner,id,models?await models.snapshot(owner,input.model_choice):model);
   } else if(request.method==='PUT' && /^\/kb\/entries\/\d+$/.test(path)) {
    entryFor(db,owner,id); operationType='entry-edit';
    if(!Object.keys(input).length||Object.keys(input).some(k=>!['title','user_note'].includes(k))) throw new KnowledgeError(4001,'Only title and user_note are editable');
    for(const [k,v] of Object.entries(input)) if(typeof v!=='string'||v.length>30000||(k==='title'&&!v.trim())) throw new KnowledgeError(4001,'Invalid entry field');
    task=async()=>{ const old=entryFor(db,owner,id); db.prepare('UPDATE kb_entries SET title=?,user_note=?,embedding=NULL WHERE entry_id=? AND owner_id=?').run(input.title??old.title,input.user_note??old.user_note,id,owner); return {...entryFor(db,owner,id),indexed:false}; };
   } else throw new KnowledgeError(4004,'Route not found');
   const data=operations.submit(owner,idempotency_key,operationType,{path,input:fingerprint},task,id?String(id):undefined);
   return success(data,'accepted',202);
  } catch(e) {
   return failure(e);
  }
 };
}
