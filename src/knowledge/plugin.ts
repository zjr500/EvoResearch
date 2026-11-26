import {claimKnowledgeEvents, knowledgePublications, settleKnowledgeEvent} from './publication.js';
import {KnowledgeModels} from './model-configuration.js';
import {PurposeModels} from '../infrastructure/models.js';
import { authenticatedHandler, type DshConnection } from '../infrastructure/http.js';
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage,ServerResponse } from 'node:http';
import type { SharedDatabase } from '../infrastructure/database.js';
import { Operations } from './operations.js';
import { knowledgeApi } from './api.js';
import { KnowledgeSearch } from './search.js';
import { configuredEmbeddingProvider } from './embedding.js';
import { publishReport, type ReportPublication } from './report.js';
import { entryFor, listEntries } from './paper-service.js';
import { dshSummaryModel,type DshLlm,type DefaultModel } from './summary-model.js';
interface Host {
 connection:DshConnection;
 webServer:{register(route:{kind:'prefix';path:string;handler(req:IncomingMessage,res:ServerResponse):Promise<void>}):()=>void};
 llm:DshLlm;
}
/** Cross-module public knowledge surface; also provided as 'evoresearchKnowledge'. */
export interface KnowledgeService {
 search(owner:number,query:string,topK?:number):Promise<{query:string;total:number;items:import('./search.js').KnowledgeHit[]}>;
 reindex(owner:number):Promise<number>;
 entries(owner:number,params?:Record<string,string>):unknown;
 entry(owner:number,entryId:number):unknown;
 publishReport(owner:number,input:ReportPublication):{entry_id:number;duplicated:boolean};
 events:{
  list(owner:number,after?:number,limit?:number):unknown[];
  claim(owner:number,channel:'index'|'graph',after?:number,limit?:number):unknown[];
  settle(owner:number,eventId:number,channel:'index'|'graph',outcome:'done'|'failed',expectedRevision:number):{event_id:number;channel:string;status:string};
 };
}
export function installKnowledge(scope:Context, store:SharedDatabase):{knowledge:KnowledgeService;dispose:()=>Promise<void>} {
  const host=scope as unknown as Host;
  const { db, papersPath } = store;
  const operations=new Operations(db);
  db.prepare("UPDATE papers SET summary_run=NULL,summary_status='failed',summary_error='Interrupted by host restart; explicit retry required' WHERE summary_run IS NOT NULL").run();
  const purposes=scope.get('evoresearchModels') as PurposeModels ?? new PurposeModels(host.llm,{currentSelection:()=>scope.get('agentDefaultModel')?.currentSelection()});
  const models=new KnowledgeModels(db,purposes,host.llm);
  let provider=null as ReturnType<typeof configuredEmbeddingProvider>, providerError='';
  try { provider=configuredEmbeddingProvider(); } catch(error) { providerError=error instanceof Error?error.message:String(error); }
  const search=new KnowledgeSearch(db,provider,providerError);
  const api=knowledgeApi(db,operations,papersPath,dshSummaryModel(host.llm,process.env.EVORESEARCH_SUMMARY_PROVIDER??'',process.env.EVORESEARCH_SUMMARY_MODEL??'',{currentSelection(){
   const defaults=scope.get('agentDefaultModel') as DefaultModel|undefined;
   if(!defaults) return {provider:'',model:''};
   return defaults.currentSelection();
  }}),models,search);
  const handler=authenticatedHandler(host.connection,api);
  const disposers=['/papers','/kb','/models'].map(path=>host.webServer.register({kind:'prefix',path,handler}));
  disposers.push(scope.provide('evoresearchKnowledgePublications',{list:(owner:number,after?:number,limit?:number)=>knowledgePublications(db,owner,after,limit)}));
  // Cross-module public knowledge surface: semantic search, entry reads,
  // report publication, and sync-event consumption for indexing/graph workers.
  const knowledge:KnowledgeService={
   search:(owner,query,topK)=>search.search(owner,query,topK),
   reindex:(owner)=>search.reindex(owner),
   entries:(owner,params)=>listEntries(db,owner,new URLSearchParams(params)),
   entry:(owner,entryId)=>entryFor(db,owner,entryId),
   publishReport:(owner,input)=>publishReport(db,owner,input),
   events:{
    list:(owner,after,limit)=>knowledgePublications(db,owner,after,limit),
    claim:(owner,channel,after,limit)=>claimKnowledgeEvents(db,owner,channel,after,limit),
    settle:(owner,eventId,channel,outcome,expectedRevision)=>settleKnowledgeEvent(db,owner,eventId,channel,outcome,expectedRevision),
   },
  };
  disposers.push(scope.provide('evoresearchKnowledge',knowledge));
  return {knowledge,dispose:async()=>{disposers.forEach(fn=>fn());await operations.drain();}};
}
