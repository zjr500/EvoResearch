import type { Context } from '@deepseek-ai/cordis';
import { openDatabase } from './infrastructure/database.js';
import { installKnowledge } from './knowledge/plugin.js';
import {OperationService} from './infrastructure/operations.js';
import {operationApi} from './infrastructure/operation-api.js';
import {authenticatedHandler} from './infrastructure/http.js';
import {PurposeModels} from './infrastructure/models.js';
import {LocalExecution,type LocalServices} from './infrastructure/local-execution.js';
import {DockerExecution} from './experiment/docker-execution.js';
import {CertificationService} from './experiment/certification.js';
import {ExperimentAgentService} from './experiment/agent-launch.js';
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
  let dockerExecution:DockerExecution|undefined;
  let certification:CertificationService|undefined;
  let experimentAgents:ExperimentAgentService|undefined;
  const disposers:(()=>void)[]=[];
  try {
   const operations=new OperationService(store.db);
   const models=new PurposeModels(host.llm,{currentSelection:()=>scope.get('agentDefaultModel')?.currentSelection()});
   disposers.push(scope.provide('evoresearchModels',models));
   disposers.push(scope.provide('evoresearchOperations',operations));
   const experimentWorkspace=resolve(dirname(store.databasePath),'experiments');
   dockerExecution=new DockerExecution(store.db,{workspaceRoot:experimentWorkspace});
   const execution=dockerExecution;
   disposers.push(scope.provide('evoresearchExperimentExecution',execution));
   // Trusted certification base: frozen candidates and hidden test sets live
   // in a separate root that training containers never mount. Host-driven
   // only — the experiment preset never receives this service.
   certification=new CertificationService(store.db,{certificationRoot:resolve(dirname(store.databasePath),'certification'),execution});
   disposers.push(scope.provide('evoresearchCertification',certification));
   // Experiment agents run under the restricted preset declared in
   // cordis.patch.yml; tools reach the agent scope only through that preset.
   experimentAgents=new ExperimentAgentService(scope as unknown as Context,models,dockerExecution);
   disposers.push(scope.provide('evoresearchExperimentAgents',experimentAgents));
   // Reconcile rows left 'running' by a host restart against real containers.
   void dockerExecution.recover().catch(()=>undefined);
   void certification.recover().catch(()=>undefined);
   scope.inject(['tools','systemPrompt'],toolScope=>{
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
   try{
    await experimentAgents?.dispose();
    await dockerExecution?.dispose();
    await certification?.dispose();
    await local?.dispose();
    await disposeKnowledge?.();
   }finally{store.close();}
  });
 });
}
