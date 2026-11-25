import type { Context } from '@deepseek-ai/cordis';
import { openDatabase } from './infrastructure/database.js';
import { installKnowledge } from './knowledge/plugin.js';
import {OperationService} from './infrastructure/operations.js';
import {operationApi} from './infrastructure/operation-api.js';
import {authenticatedHandler} from './infrastructure/http.js';
import {PurposeModels} from './infrastructure/models.js';
import {LocalExecution,type LocalServices} from './infrastructure/local-execution.js';

/** Public backend services only; no new training workflow or remote execution. */
export function installRuntime(ctx: Context) {
 return ctx.inject(['connection','webServer','llm'],scope=>{
  const host=scope as any;
  const store=openDatabase();
  let disposeKnowledge:(()=>Promise<void>)|undefined;
  let local:LocalExecution|undefined;
  const disposers:(()=>void)[]=[];
  try {
   const operations=new OperationService(store.db);
   const models=new PurposeModels(host.llm,{currentSelection:()=>scope.get('agentDefaultModel')?.currentSelection()});
   disposers.push(scope.provide('evoresearchModels',models));
   disposers.push(scope.provide('evoresearchOperations',operations));
   disposers.push(host.webServer.register({kind:'prefix',path:'/operations',handler:authenticatedHandler(host.connection,operationApi(operations))}));
   disposeKnowledge=installKnowledge(scope,store);
   scope.inject(['subprocess','sandbox','jobs','fs'],nativeScope=>{
    local=new LocalExecution(store.db,nativeScope as unknown as LocalServices);
    const current=local;nativeScope.provide('evoresearchLocalExecution',current);
    nativeScope.effect(()=>()=>current.dispose());
   });
  }catch(error){disposers.reverse().forEach(fn=>fn());store.close();throw error;}
  scope.effect(()=>async()=>{
   disposers.reverse().forEach(fn=>fn());
   try{await local?.dispose();await disposeKnowledge?.();}finally{store.close();}
  });
 });
}
