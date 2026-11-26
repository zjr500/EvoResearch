import type Database from 'better-sqlite3';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readPdf, extractAbstract } from './paper-import.js';
import { savePaper, type PaperRecord } from './paper-repository.js';
import { validateSummary, SummarySelectionError, type SummaryModel } from './summary-model.js';

import { AppError as KnowledgeError, ownerId } from '../infrastructure/errors.js';
export { AppError as KnowledgeError, ownerId } from '../infrastructure/errors.js';
export interface StoredPaper extends PaperRecord {
 full_text: string | null;
 parse_error: string | null;
 pending_summary: string | null;
 revision:number; summary_status:string; summary_error:string|null; summary_run:string|null;
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
  db.prepare('UPDATE papers SET title=CASE WHEN revision=0 THEN ? ELSE title END,authors=CASE WHEN revision=0 THEN ? ELSE authors END,year=CASE WHEN revision=0 THEN ? ELSE year END,abstract=CASE WHEN revision=0 THEN ? ELSE abstract END,full_text=?,revision=revision+1 WHERE paper_id=? AND uploader_id=?')
   .run(title,authors,yearText?Number(yearText):null,extractAbstract(parsed.text),parsed.text,id,owner);
 } catch {
  db.prepare("UPDATE papers SET status=CASE WHEN status='已入库' THEN status ELSE '待补全' END,parse_error='PDF text extraction failed',revision=revision+1 WHERE paper_id=? AND uploader_id=?").run(id,owner);
  throw new KnowledgeError(4001,'PDF parsing failed; complete metadata manually',{paperId:id});
 }
 return {paper:paperFor(db,owner,id),duplicated:false};
}


export function updatePendingPaper(
 db: Database.Database,
 owner: number,
 id: number,
 changes: Record<string, unknown>
) {
 return db.transaction(() => {
  const paper = paperFor(db, owner, id);
  if ('expected_revision' in changes && changes.expected_revision !== paper.revision) throw new KnowledgeError(4009,'Paper revision conflict');

  if (paper.status === '已入库')
   throw new KnowledgeError(4009, 'Paper already imported');

  const allowed = [
   'title', 'authors', 'year', 'abstract', 'pending_summary', 'expected_revision'
  ];

  if (
   !Object.keys(changes).some(k=>k!=='expected_revision') ||
   Object.keys(changes).some(key => !allowed.includes(key))
  )
   throw new KnowledgeError(4001, 'Unsupported metadata field');

  const next = {
   title: paper.title,
   authors: paper.authors,
   year: paper.year,
   abstract: paper.abstract,
   ...changes
  };

  for (const key of ['title', 'authors', 'abstract'] as const)
   if (
    next[key] !== null &&
    (typeof next[key] !== 'string' || next[key].length > 30000)
   )
    throw new KnowledgeError(4001, 'Invalid metadata');

  if (
   next.year !== null &&
   (
    !Number.isInteger(next.year) ||
    Number(next.year) < 1000 ||
    Number(next.year) > new Date().getFullYear() + 1
   )
  )
   throw new KnowledgeError(4001, 'Invalid publication year');

  let summary = paper.pending_summary;

  if ('pending_summary' in changes) {
   if (!paper.pending_summary)
    throw new KnowledgeError(4009, 'Generate paper summary first');

   try {
    summary = JSON.stringify(
     validateSummary(changes.pending_summary)
    );
   } catch {
    throw new KnowledgeError(4001, 'Invalid paper summary');
   }
  } else if (
   next.abstract !== paper.abstract &&
   !paper.full_text?.trim()
  ) {
   summary = null;
  }

  db.prepare(`
   UPDATE papers
   SET title=?, authors=?, year=?, abstract=?,
       pending_summary=?, revision=revision+1, summary_status=CASE WHEN summary_run IS NOT NULL THEN 'running' WHEN ? IS NULL THEN 'not_generated' ELSE 'ready' END, summary_error=NULL
   WHERE paper_id=? AND uploader_id=?
  `).run(
   next.title,
   next.authors,
   next.year,
   next.abstract,
   summary,
   summary,
   id,
   owner
  );

  return paperFor(db, owner, id);
 })();
}

export function confirmPaper(
 db: Database.Database,
 owner: number,
 id: number,
 changes: Record<string, unknown>
) {
 return db.transaction(() => {
  const paper = paperFor(db, owner, id);
  if ('expected_revision' in changes && changes.expected_revision !== paper.revision) throw new KnowledgeError(4009,'Paper revision conflict');

  if (paper.status === '已入库') {
   if(Object.keys(changes).some(k=>k!=='expected_revision')) throw new KnowledgeError(4009,'Paper already imported');
   return paper;
  }
  if(paper.summary_run) throw new KnowledgeError(4009,'Summary is running');

  for (const key of Object.keys(changes))
   if (!['title', 'authors', 'year', 'abstract', 'pending_summary', 'expected_revision'].includes(key))
    throw new KnowledgeError(4001, 'Unsupported metadata field');

  const next = {
   title: paper.title,
   authors: paper.authors,
   year: paper.year,
   abstract: paper.abstract,
   ...changes
  };

  for (const key of ['title', 'authors', 'abstract'] as const)
   if (
    next[key] !== null &&
    (typeof next[key] !== 'string' || next[key].length > 30000)
   )
    throw new KnowledgeError(4001, 'Invalid metadata');

  if (typeof next.title !== 'string' || !next.title.trim())
   throw new KnowledgeError(4001, 'Title is required to confirm');

  if (
   next.year !== null &&
   (
    !Number.isInteger(next.year) ||
    Number(next.year) < 1000 ||
    Number(next.year) > new Date().getFullYear() + 1
   )
  )
   throw new KnowledgeError(4001, 'Invalid publication year');

  if (!paper.pending_summary)
   throw new KnowledgeError(4009, 'Generate paper summary first');
  if(!paper.full_text?.trim() && next.abstract!==paper.abstract)throw new KnowledgeError(4009,'Save the new abstract and regenerate summary before confirmation');

  let content;

  try {
   content = validateSummary(
    changes.pending_summary !== undefined
     ? changes.pending_summary
     : JSON.parse(paper.pending_summary)
   );
  } catch {
   throw new KnowledgeError(4001, 'Invalid paper summary');
  }

  db.prepare(`
   UPDATE papers
   SET title=?, authors=?, year=?, abstract=?,
       status='已入库', pending_summary=NULL, revision=revision+1, summary_status='ready', summary_error=NULL
   WHERE paper_id=? AND uploader_id=?
  `).run(
   next.title.trim(),
   next.authors,
   next.year,
   next.abstract,
   id,
   owner
  );

  db.prepare(`
   INSERT INTO kb_entries(
    type, title, content, source_type, source_id, owner_id
   )
   VALUES('paper_summary', ?, ?, 'paper', ?, ?)
  `).run(
   next.title.trim(),
   JSON.stringify(content),
   id,
   owner
  );

  const entry=db.prepare("SELECT entry_id FROM kb_entries WHERE source_type='paper' AND source_id=? AND owner_id=?").get(id,owner) as {entry_id:number};
  db.prepare('INSERT INTO knowledge_sync_events(document_id,owner_id) VALUES(?,?)').run(entry.entry_id,owner);
  return paperFor(db, owner, id);
 })();
}

export async function summarizePaper(
 db: Database.Database,
 owner: number,
 id: number,
 model: SummaryModel,
 signal = AbortSignal.timeout(120000)
) {
 const paper = paperFor(db, owner, id);

 if (paper.status === '已入库')
  throw new KnowledgeError(4009, 'Paper already imported');

 const text = paper.full_text?.trim() || paper.abstract?.trim();

 if (!text)
  throw new KnowledgeError(4009, 'No paper text or manually supplied abstract');

 const token=randomUUID();
 const claimed=db.prepare("UPDATE papers SET summary_run=?,summary_status='running',summary_error=NULL WHERE paper_id=? AND uploader_id=? AND summary_run IS NULL AND revision=? AND status!='已入库'").run(token,id,owner,paper.revision);
 if(!claimed.changes)throw new KnowledgeError(4009,'Summary is already running or paper changed');
 try {
  const content=validateSummary(await model.generate(text,signal));
  signal.throwIfAborted();
  return db.transaction(()=>{
   const current=paperFor(db,owner,id);
   if(current.revision!==paper.revision || current.status==='已入库')throw new KnowledgeError(4009,'Paper changed while summary was running');
   db.prepare("UPDATE papers SET pending_summary=?,revision=revision+1,summary_status='ready',summary_error=NULL,summary_run=NULL WHERE paper_id=? AND uploader_id=? AND summary_run=?").run(JSON.stringify(content),id,owner,token);
   return {paper_id:id,status:current.status,pending_summary:content,summary:content,revision:current.revision+1};
  })();
 }catch(error){
  db.prepare("UPDATE papers SET summary_run=NULL,summary_status='failed',summary_error='Summary generation failed; previous valid summary retained' WHERE paper_id=? AND uploader_id=? AND summary_run=?").run(id,owner,token);
  if(error instanceof SummarySelectionError)throw new KnowledgeError(4009,error.message);
  throw error;
 }
}

/** Public paper view distinguishes original abstract from generated summary. */
export function paperView(db:Database.Database,owner:number,id:number) {
 const {file_path,full_text,summary_run,...paper}=paperFor(db,owner,id);
 const entry=db.prepare("SELECT entry_id,content FROM kb_entries WHERE owner_id=? AND source_type='paper' AND source_id=?").get(owner,id) as {entry_id:number;content:string}|undefined;
 return {...paper,pending_summary:paper.pending_summary?JSON.parse(paper.pending_summary):null,
  summary:paper.pending_summary?JSON.parse(paper.pending_summary):entry?JSON.parse(entry.content):null,
  document_id:entry?.entry_id??null};
}

export function entryFor(db:Database.Database,owner:number,id:number): Record<string,any> {
 const row=db.prepare('SELECT entry_id AS document_id,type,title,user_note,content,source_type,source_id,created_at FROM kb_entries WHERE entry_id=? AND owner_id=?').get(id,ownerId(owner)) as Record<string,unknown>|undefined;
 if(!row) throw new KnowledgeError(4004,'Entry not found');
 const sync=db.prepare('SELECT index_status,graph_status FROM knowledge_sync_events WHERE document_id=? AND owner_id=? ORDER BY entry_revision DESC LIMIT 1').get(id,owner) as Record<string,string>|undefined;
 return {...row,content:JSON.parse(row.content as string),index_status:sync?.index_status??'pending',graph_status:sync?.graph_status??'pending'};
}
/** Owner-scoped paper list for the UC01 workbench; never exposes file paths or full text. */
export function listPapers(db:Database.Database,owner:number,query:URLSearchParams) {
 const limit=Number(query.get('limit')??20), cursor=query.get('cursor');
 if(!Number.isInteger(limit)||limit<1||limit>100||cursor && !/^\d+$/.test(cursor)) throw new KnowledgeError(4001,'Invalid pagination');
 const status=query.get('status'), keyword=query.get('keyword')??'';
 if(status && !['待确认','待补全','已入库'].includes(status)) throw new KnowledgeError(4001,'Invalid status');
 const rows=db.prepare(`SELECT paper_id,title,authors,year,status,summary_status,summary_error,revision,parse_error,created_at FROM papers
  WHERE uploader_id=? AND (? IS NULL OR status=?) AND instr(lower(COALESCE(title,'')),lower(?))>0 AND (? IS NULL OR paper_id<?)
  ORDER BY paper_id DESC LIMIT ?`).all(ownerId(owner),status,status,keyword,cursor,cursor,limit+1) as {paper_id:number}[];
 const more=rows.length>limit; return {papers:rows.slice(0,limit),nextCursor:more?String(rows[limit-1].paper_id):null};
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
