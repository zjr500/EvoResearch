import type Database from 'better-sqlite3';
import {AppError,ownerId} from '../infrastructure/errors.js';

export type KnowledgeChannel='index'|'graph';
const CHANNELS:ReadonlySet<string>=new Set(['index','graph']);
/** Failed events may be re-claimed this many times before they stay failed. */
export const MAX_SYNC_ATTEMPTS=5;
function channelOf(value:unknown):KnowledgeChannel {
 if(typeof value!=='string'||!CHANNELS.has(value))throw new AppError(4001,"channel must be 'index' or 'graph'");
 return value as KnowledgeChannel;
}

/** Ordered, durable publication events; does not claim that an index or graph exists. */
export function knowledgePublications(db:Database.Database,owner:number,after=0,limit=100) {
 ownerId(owner);
 if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError(4001,'Invalid publication cursor');
 return db.prepare(`SELECT event_id,document_id,entry_revision,event_type,index_status,graph_status,created_at
 FROM knowledge_sync_events WHERE owner_id=? AND event_id>? ORDER BY event_id LIMIT ?`).all(owner,after,limit);
}

/**
 * Claim pending sync events for one consumer channel ('index' or 'graph').
 * Events that previously failed are claimable again until their per-channel
 * attempt counter reaches MAX_SYNC_ATTEMPTS, so a transient consumer failure
 * no longer strands an event forever. Claiming does not hide the event; a
 * crashed consumer simply leaves it claimable for the next run.
 */
export function claimKnowledgeEvents(db:Database.Database,owner:number,channel:unknown,after=0,limit=100) {
 ownerId(owner);
 const kind=channelOf(channel);
 if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError(4001,'Invalid publication cursor');
 return db.prepare(`SELECT event_id,document_id,entry_revision,event_type,${kind}_attempts AS attempts,created_at
 FROM knowledge_sync_events
 WHERE owner_id=? AND event_id>? AND (${kind}_status='pending' OR (${kind}_status='failed' AND ${kind}_attempts<?))
 ORDER BY event_id LIMIT ?`).all(owner,after,MAX_SYNC_ATTEMPTS,limit);
}

/**
 * Settle one claimed event as 'done' or 'failed'. A 'failed' settlement
 * increments the channel's attempt counter; the event becomes claimable again
 * until the counter reaches MAX_SYNC_ATTEMPTS. The optimistic match on
 * entry_revision and the current status makes concurrent or duplicate
 * settlement an explicit 4009 instead of a silent overwrite.
 */
export function settleKnowledgeEvent(db:Database.Database,owner:number,eventId:unknown,channel:unknown,outcome:unknown,expectedRevision:unknown) {
 ownerId(owner);
 const kind=channelOf(channel);
 if(!Number.isSafeInteger(eventId)||(eventId as number)<1)throw new AppError(4001,'Invalid event ID');
 if(outcome!=='done'&&outcome!=='failed')throw new AppError(4001,"outcome must be 'done' or 'failed'");
 if(!Number.isSafeInteger(expectedRevision)||(expectedRevision as number)<1)throw new AppError(4001,'expected_revision required');
 const result=db.prepare(`UPDATE knowledge_sync_events SET ${kind}_status=?,${kind}_attempts=${kind}_attempts+?
 WHERE event_id=? AND owner_id=? AND entry_revision=? AND (${kind}_status='pending' OR (${kind}_status='failed' AND ${kind}_attempts<?))`)
  .run(outcome,outcome==='failed'?1:0,eventId,owner,expectedRevision,MAX_SYNC_ATTEMPTS);
 if(!result.changes)throw new AppError(4009,'Event already settled, belongs to another owner, attempts exhausted, or entry revision changed');
 return {event_id:eventId as number,channel:kind,status:outcome};
}
