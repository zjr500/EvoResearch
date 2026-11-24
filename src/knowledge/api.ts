import {success,failure,objectBody,resourceId} from '../infrastructure/http.js';
import {ownerId} from '../infrastructure/errors.js';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { Operations } from './operations.js';
import { KnowledgeError,importPaper,confirmPaper,summarizePaper,paperFor,entryFor,listEntries } from './paper-service.js';
import type { SummaryModel } from './summary-model.js';
export function knowledgeApi(db:Database.Database,operations:Operations,storageDir:string,model:SummaryModel) {
 return async (request:Request,owner:number):Promise<Response>=>{
  try {
   ownerId(owner);
   const url=new URL(request.url), path=url.pathname.replace(/^\/api/,'');
   const idMatch=path.match(/^\/(?:papers|kb\/entries|kb\/operations)\/(\d+)(?:\/summary)?$/);
   const id=idMatch?resourceId(idMatch[1]):0;
   if(request.method==='GET') {
    let data:unknown;
    if(path==='/kb/entries') data=listEntries(db,owner,url.searchParams);
    else if(id && path.startsWith('/papers/')) { const p=paperFor(db,owner,id); const {file_path,full_text,...view}=p; data=view; }
    else if(id && path.startsWith('/kb/entries/')) data=entryFor(db,owner,id);
    else if(id && path.startsWith('/kb/operations/')) data=operations.get(owner,id);
    else throw new KnowledgeError(4004,'Route not found');
    return success(data);
   }
   const body=await objectBody(request);
   const {idempotency_key,...input}=body;
   let task:()=>Promise<unknown>, operationType:string, fingerprint:unknown=input;
   if(request.method==='POST' && path==='/papers') {
    if(Object.keys(input).some(k=>k!=='pdf_base64')||typeof input.pdf_base64!=='string'||!input.pdf_base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.pdf_base64)) throw new KnowledgeError(4001,'pdf_base64 required');
    const buffer=Buffer.from(input.pdf_base64,'base64');
    fingerprint={sha256:createHash('sha256').update(buffer).digest('hex')}; operationType='paper-import';
    task=async()=>{const result=await importPaper(db,{filePath:'upload.pdf',uploaderId:owner,buffer,storageDir}); const {file_path,full_text,...paper}=result.paper; return {paper,duplicated:result.duplicated};};
   } else if(request.method==='PUT' && /^\/papers\/\d+$/.test(path)) {
    paperFor(db,owner,id); operationType='paper-confirm'; task=async()=>{const {file_path,full_text,...paper}=confirmPaper(db,owner,id,input);return paper;};
   } else if(request.method==='POST' && /^\/papers\/\d+\/summary$/.test(path)) {
    paperFor(db,owner,id); if(Object.keys(input).length) throw new KnowledgeError(4001,'No summary body fields allowed');
    operationType='paper-summary'; task=()=>summarizePaper(db,owner,id,model);
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
