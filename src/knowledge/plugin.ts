import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrateKnowledge } from './database.js';
import { Operations } from './operations.js';
import { knowledgeApi } from './api.js';
import { dshSummaryModel,type DshLlm,type DefaultModel } from './summary-model.js';
interface Host {
 connection:{admit(request:{headers:IncomingMessage['headers']}):{rejection:401|403}|{peer:{principal:{kind:string}}}};
 webServer:{register(route:{kind:'prefix';path:string;handler(req:IncomingMessage,res:ServerResponse):Promise<void>}):()=>void};
 llm:DshLlm;
}
export function installKnowledge(ctx:Context) {
 ctx.inject(['connection','webServer','llm'], scope=>{
  const host=scope as unknown as Host;
  const databasePath=resolve(process.env.EVORESEARCH_DB_PATH??'data/evoresearch.sqlite');
  mkdirSync(dirname(databasePath),{recursive:true});
  const db=new Database(databasePath); migrateKnowledge(db);
  const operations=new Operations(db);
  const api=knowledgeApi(db,operations,resolve(dirname(databasePath),'papers'),dshSummaryModel(host.llm,process.env.EVORESEARCH_SUMMARY_PROVIDER??'',process.env.EVORESEARCH_SUMMARY_MODEL??'',{currentSelection(){
   const defaults=scope.get('agentDefaultModel') as DefaultModel|undefined;
   if(!defaults) return {provider:'',model:''};
   return defaults.currentSelection();
  }}));
  const handler=async(req:IncomingMessage,res:ServerResponse)=>{
   const admission=host.connection.admit(req);
   if('rejection' in admission || admission.peer.principal.kind!=='owner') {res.writeHead('rejection' in admission?admission.rejection:403);res.end();return;}
   // DSH 0.2.1's browser identity is the single local Host owner, not a client-provided user ID.
   const chunks:Buffer[]=[]; let size=0;
   try {
    for await(const chunk of req) {const b=Buffer.from(chunk);size+=b.length;if(size>28*1024*1024){res.writeHead(413);res.end();return;}chunks.push(b);}
    const request=new Request('http://localhost'+req.url,{method:req.method,headers:{'content-type':'application/json'},body:['GET','HEAD'].includes(req.method??'GET')?undefined:Buffer.concat(chunks)});
    const response=await api(request,1);
    res.writeHead(response.status,{'content-type':'application/json; charset=utf-8'});res.end(await response.text());
   }catch {if(!res.headersSent)res.writeHead(500);res.end();}
  };
  const disposers=['/papers','/kb'].map(path=>host.webServer.register({kind:'prefix',path,handler}));
  scope.effect(()=>async()=>{disposers.forEach(fn=>fn());await operations.drain();db.close();});
 });
}
