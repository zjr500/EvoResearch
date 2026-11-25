import type Database from 'better-sqlite3';
import {AppError,ownerId} from '../infrastructure/errors.js';
/** Ordered, durable publication events; does not claim that an index or graph exists. */
export function knowledgePublications(db:Database.Database,owner:number,after=0,limit=100) {
 ownerId(owner);
 if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError(4001,'Invalid publication cursor');
 return db.prepare(`SELECT event_id,document_id,entry_revision,event_type,index_status,graph_status,created_at
 FROM knowledge_sync_events WHERE owner_id=? AND event_id>? ORDER BY event_id LIMIT ?`).all(owner,after,limit);
}
