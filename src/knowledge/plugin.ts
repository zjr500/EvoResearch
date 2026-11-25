import {knowledgePublications} from './publication.js';
import {KnowledgeModels} from './model-configuration.js';
import {PurposeModels} from '../infrastructure/models.js';
import { authenticatedHandler, type DshConnection } from '../infrastructure/http.js';
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage,ServerResponse } from 'node:http';
import type { SharedDatabase } from '../infrastructure/database.js';
import { Operations } from './operations.js';
import { knowledgeApi } from './api.js';
import { dshSummaryModel,type DshLlm,type DefaultModel } from './summary-model.js';
interface Host {
 connection:DshConnection;
 webServer:{register(route:{kind:'prefix';path:string;handler(req:IncomingMessage,res:ServerResponse):Promise<void>}):()=>void};
 llm:DshLlm;
}
export function installKnowledge(scope:Context, store:SharedDatabase) {
  const host=scope as unknown as Host;
  const { db, papersPath } = store;
  const operations=new Operations(db);
  db.prepare("UPDATE papers SET summary_run=NULL,summary_status='failed',summary_error='Interrupted by host restart; explicit retry required' WHERE summary_run IS NOT NULL").run();
  const purposes=scope.get('evoresearchModels') as PurposeModels ?? new PurposeModels(host.llm,{currentSelection:()=>scope.get('agentDefaultModel')?.currentSelection()});
  const models=new KnowledgeModels(db,purposes,host.llm);
  const api=knowledgeApi(db,operations,papersPath,dshSummaryModel(host.llm,process.env.EVORESEARCH_SUMMARY_PROVIDER??'',process.env.EVORESEARCH_SUMMARY_MODEL??'',{currentSelection(){
   const defaults=scope.get('agentDefaultModel') as DefaultModel|undefined;
   if(!defaults) return {provider:'',model:''};
   return defaults.currentSelection();
  }}),models);
  const handler=authenticatedHandler(host.connection,api);
  const disposers=['/papers','/kb','/models'].map(path=>host.webServer.register({kind:'prefix',path,handler}));
  disposers.push(scope.provide('evoresearchKnowledgePublications',{list:(owner:number,after?:number,limit?:number)=>knowledgePublications(db,owner,after,limit)}));
  return async()=>{disposers.forEach(fn=>fn());await operations.drain();};
}
