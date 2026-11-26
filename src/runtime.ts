import type { Context } from '@deepseek-ai/cordis';
import { openDatabase } from './infrastructure/database.js';
import { installKnowledge } from './knowledge/plugin.js';
import {OperationService} from './infrastructure/operations.js';
import {operationApi} from './infrastructure/operation-api.js';
import {authenticatedHandler} from './infrastructure/http.js';
import {PurposeModels} from './infrastructure/models.js';
import {LocalExecution,type LocalServices} from './infrastructure/local-execution.js';
import {DockerExecution} from './experiment/docker-execution.js';
import {registerExperimentTools} from './experiment/agent-tools.js';
import {installCitation} from './dialogue/citation-integration.js';
import type {KnowledgeService} from './knowledge/plugin.js';
import {dirname,resolve} from 'node:path';

/** Public backend services only; no new training workflow or remote execution. */
export function installRuntime(ctx: Context) {
 return ctx.inject(['connection','webServer','llm'],scope=>{
  const host=scope as any;
  const store=openDatabase();
  let knowledge:KnowledgeService|undefined;
  let disposeKnowledge:(()=>Promise<void>)|undefined;
  let local:LocalExecution|undefined;
  const disposers:(()=>void)[]=[];
  try {
   const operations=new OperationService(store.db);
   const models=new PurposeModels(host.llm,{currentSelection:()=>scope.get('agentDefaultModel')?.currentSelection()});
   disposers.push(scope.provide('evoresearchModels',models));
   disposers.push(scope.provide('evoresearchOperations',operations));
   const experimentWorkspace=resolve(dirname(store.databasePath),'experiments');
   const dockerExecution=new DockerExecution(store.db,{workspaceRoot:experimentWorkspace});
   disposers.push(scope.provide('evoresearchExperimentExecution',dockerExecution));
   // Experiment agent tools: the model drives experiments only through these
   // restricted tools; owner is the local DSH host owner (see http.ts).
   scope.inject(['tools','systemPrompt'],toolScope=>{
    toolScope.effect(()=>registerExperimentTools(toolScope as unknown as Context,dockerExecution,experimentWorkspace,1));
    // Dialogue citation tools query the unified knowledge service in process.
    if(knowledge)toolScope.effect(()=>installCitation(toolScope as unknown as Context,knowledge!,1));
   });
   disposers.push(host.webServer.register({kind:'prefix',path:'/operations',handler:authenticatedHandler(host.connection,operationApi(operations))}));
   const installed=installKnowledge(scope,store);
   knowledge=installed.knowledge;
   disposeKnowledge=installed.dispose;
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
