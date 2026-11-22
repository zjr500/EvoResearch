import type Database from 'better-sqlite3';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readPdf, extractAbstract } from './paper-import.js';
import { savePaper, type PaperRecord } from './paper-repository.js';
import { validateSummary, type SummaryModel } from './summary-model.js';

export class KnowledgeError extends Error {
 constructor(public code:number,message:string,public data:unknown=null) { super(message); }
}
export interface StoredPaper extends PaperRecord { full_text:string|null; parse_error:string|null }
export function ownerId(value:number):number {
 if(!Number.isSafeInteger(value)||value<1) throw new KnowledgeError(4001,'Authenticated owner required');
 return value;
}
export function paperFor(db:Database.Database,owner:number,id:number):StoredPaper {
 const paper=db.prepare('SELECT * FROM papers WHERE paper_id=? AND uploader_id=?').get(id,ownerId(owner)) as StoredPaper|undefined;
 if(!paper) throw new KnowledgeError(4004,'Paper not found'); return paper;
}
function metadataString(v:unknown):string|null { return typeof v==='string' && v.trim() ? v.trim().slice(0,4000):null; }
export async function importPaper(db:Database.Database,input:{filePath:string;uploaderId:number;buffer?:Buffer;storageDir?:string}) {
 const owner=ownerId(input.uploaderId), bytes=input.buffer ?? await readFile(input.filePath);
 if(bytes.length>20*1024*1024 || bytes.subarray(0,5).toString()!=='%PDF-') throw new KnowledgeError(4001,'Invalid PDF or exceeds 20 MiB',{paperId:null});
 const hash=createHash('sha256').update(bytes).digest('hex');
 const existing=db.prepare('SELECT * FROM papers WHERE uploader_id=? AND content_hash=?').get(owner,hash) as StoredPaper|undefined;
 if(existing) return {paper:existing,duplicated:true};
 let filePath=input.filePath;
 if(input.storageDir) { const folder=join(input.storageDir,String(owner)); await mkdir(folder,{recursive:true}); filePath=join(folder,hash+'.pdf'); await writeFile(filePath,bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST') throw e;}); }
 const saved=savePaper(db,{filePath,uploaderId:owner,contentHash:hash});
 if(saved.duplicated) return {paper:paperFor(db,owner,saved.record.paper_id),duplicated:true};
 const id=saved.record.paper_id;
 try {
  const parsed=await readPdf(filePath,bytes);
  if(!parsed.text.trim()) throw new Error('No extractable text');
  const title=metadataString(parsed.metadata.Title) ?? metadataString(parsed.text.match(/^\s*Title\s*:\s*(.+)$/mi)?.[1]);
  const authors=metadataString(parsed.metadata.Author) ?? metadataString(parsed.text.match(/^\s*Authors?\s*:\s*(.+)$/mi)?.[1]);
  const yearText=parsed.text.match(/^\s*(?:Year|Published)\s*:\s*((?:19|20)\d{2})\b/mi)?.[1];
  db.prepare('UPDATE papers SET title=?,authors=?,year=?,abstract=?,full_text=? WHERE paper_id=? AND uploader_id=?')
   .run(title,authors,yearText?Number(yearText):null,extractAbstract(parsed.text),parsed.text,id,owner);
 } catch {
  db.prepare("UPDATE papers SET status='待补全',parse_error='PDF text extraction failed' WHERE paper_id=? AND uploader_id=?").run(id,owner);
  throw new KnowledgeError(4001,'PDF parsing failed; complete metadata manually',{paperId:id});
 }
 return {paper:paperFor(db,owner,id),duplicated:false};
}
export function confirmPaper(db:Database.Database,owner:number,id:number,changes:Record<string,unknown>) {
 const paper=paperFor(db,owner,id);
 for(const key of Object.keys(changes)) if(!['title','authors','year','abstract'].includes(key)) throw new KnowledgeError(4001,'Unsupported metadata field');
 const next={title:paper.title,authors:paper.authors,year:paper.year,abstract:paper.abstract,...changes};
 for(const key of ['title','authors','abstract'] as const) if(next[key]!==null && (typeof next[key]!=='string'||next[key].length>30000)) throw new KnowledgeError(4001,'Invalid metadata');
 if(typeof next.title!=='string'||!next.title.trim()) throw new KnowledgeError(4001,'Title is required to confirm');
 if(next.year!==null && (!Number.isInteger(next.year)||Number(next.year)<1000||Number(next.year)>new Date().getFullYear()+1)) throw new KnowledgeError(4001,'Invalid publication year');
 db.prepare("UPDATE papers SET title=?,authors=?,year=?,abstract=?,status='已入库' WHERE paper_id=? AND uploader_id=?").run(next.title.trim(),next.authors,next.year,next.abstract,id,owner);
 return paperFor(db,owner,id);
}
export async function summarizePaper(db:Database.Database,owner:number,id:number,model:SummaryModel,signal=AbortSignal.timeout(120000)) {
 const paper=paperFor(db,owner,id);
 if(paper.status!=='已入库') throw new KnowledgeError(4009,'Confirm paper metadata first');
 const text=paper.full_text?.trim() || paper.abstract?.trim();
 if(!text) throw new KnowledgeError(4009,'No paper text or manually supplied abstract');
 const content=validateSummary(await model.generate(text,signal));
 signal.throwIfAborted();
 return db.transaction(()=>{
  const current=paperFor(db,owner,id);
  if(current.title!==paper.title || current.abstract!==paper.abstract) throw new KnowledgeError(4009,'Paper changed while summary was running');
  db.prepare(`INSERT INTO kb_entries(type,title,content,source_type,source_id,owner_id) VALUES('paper_summary',?,?,'paper',?,?)
   ON CONFLICT(source_type,source_id) DO UPDATE SET title=excluded.title,content=excluded.content,embedding=NULL WHERE kb_entries.owner_id=excluded.owner_id`)
   .run(paper.title,JSON.stringify(content),id,owner);
  return entryFor(db,owner,(db.prepare("SELECT entry_id FROM kb_entries WHERE source_type='paper' AND source_id=? AND owner_id=?").get(id,owner) as {entry_id:number}).entry_id);
 })();
}
export function entryFor(db:Database.Database,owner:number,id:number): Record<string,any> {
 const row=db.prepare('SELECT entry_id AS document_id,type,title,user_note,content,source_type,source_id,created_at FROM kb_entries WHERE entry_id=? AND owner_id=?').get(id,ownerId(owner)) as Record<string,unknown>|undefined;
 if(!row) throw new KnowledgeError(4004,'Entry not found');
 return {...row,content:JSON.parse(row.content as string)};
}
export function listEntries(db:Database.Database,owner:number,query:URLSearchParams) {
 const limit=Number(query.get('limit')??20), cursor=query.get('cursor');
 if(!Number.isInteger(limit)||limit<1||limit>100||cursor && !/^\d+$/.test(cursor)) throw new KnowledgeError(4001,'Invalid pagination');
 const type=query.get('type'), keyword=query.get('keyword')??'';
 if(type && !['paper_summary','experiment_report'].includes(type)) throw new KnowledgeError(4001,'Invalid type');
 const rows=db.prepare(`SELECT entry_id AS document_id,type,title,source_type,source_id,created_at FROM kb_entries
  WHERE owner_id=? AND (? IS NULL OR type=?) AND instr(lower(title),lower(?))>0 AND (? IS NULL OR entry_id<?)
  ORDER BY entry_id DESC LIMIT ?`).all(ownerId(owner),type,type,keyword,cursor,cursor,limit+1) as {document_id:number}[];
 const more=rows.length>limit; return {entries:rows.slice(0,limit),nextCursor:more?String(rows[limit-1].document_id):null};
}
