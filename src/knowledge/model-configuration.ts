import type Database from 'better-sqlite3';
import {PurposeModels,type ModelChoice,type ModelSelection,type DshLlm} from '../infrastructure/models.js';
import {dshSummaryModel,type SummaryModel} from './summary-model.js';
import {AppError,ownerId} from '../infrastructure/errors.js';
export interface SummaryConfiguration {
 view(owner:number):unknown;
 directory():unknown;
 models(provider:string):Promise<unknown>;
 configure(owner:number,choice:unknown,expectedRevision:number):Promise<unknown>;
 snapshot(owner:number,choice?:unknown):Promise<SummaryModel>;
}
export function parseModelChoice(value:unknown):ModelChoice {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError(4001,'Invalid model_choice');
 const v=value as Record<string,unknown>;
 const keys=v.mode==='dsh-default'?['mode']:['mode','provider','model','reasoningEffort'];
 if(Object.keys(v).some(k=>!keys.includes(k)))throw new AppError(4001,'Unsupported model configuration field; use DSH settings for credentials');
 if(v.mode==='dsh-default')return {mode:'dsh-default'};
 if(v.mode!=='selected'||typeof v.provider!=='string'||!v.provider.trim()||typeof v.model!=='string'||!v.model.trim()||v.provider.length>200||v.model.length>200)throw new AppError(4001,'Invalid model selection');
 if(v.reasoningEffort!==undefined&&(typeof v.reasoningEffort!=='string'||!v.reasoningEffort.trim()||v.reasoningEffort.length>100))throw new AppError(4001,'Invalid reasoning effort');
 return {mode:'selected',provider:v.provider.trim(),model:v.model.trim(),...(v.reasoningEffort===undefined?{}:{reasoningEffort:v.reasoningEffort as string})};
}
export class KnowledgeModels implements SummaryConfiguration {
 constructor(private db:Database.Database,private service:PurposeModels,private llm:DshLlm){}
 view(owner:number){const r=this.db.prepare('SELECT choice_json,revision FROM knowledge_model_choices WHERE owner_id=?').get(ownerId(owner)) as {choice_json:string;revision:number}|undefined;return {choice:r?JSON.parse(r.choice_json):null,revision:r?.revision??0};}
 directory(){return this.service.directory();}
 async models(provider:string){try{return await this.service.models(provider);}catch{throw new AppError(4009,'DSH model catalog unavailable; configure the provider in DSH settings');}}
 private async resolve(owner:number,choice?:unknown):Promise<Readonly<ModelSelection>> {
  const selected=choice===undefined?this.view(owner).choice:parseModelChoice(choice);
  try {
   const selection=this.service.selection('summary',selected??undefined);
   const available=await this.service.models(selection.provider);
   if(!available.some(m=>m.id===selection.model))throw new Error('unavailable');
   return selection;
  }catch{throw new AppError(4009,'DSH summary model unavailable; check provider and model in DSH settings');}
 }
 async configure(owner:number,choice:unknown,expectedRevision:number){
  const parsed=parseModelChoice(choice);
  await this.resolve(owner,parsed); // No paid request; never store before catalog validation.
  return this.db.transaction(()=>{
   if(this.view(owner).revision!==expectedRevision)throw new AppError(4009,'Model configuration revision conflict');
   this.db.prepare('INSERT INTO knowledge_model_choices(owner_id,choice_json) VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET choice_json=excluded.choice_json,revision=knowledge_model_choices.revision+1').run(owner,JSON.stringify(parsed));
   return this.view(owner);
  })();
 }
 async snapshot(owner:number,choice?:unknown){
  const selection=await this.resolve(owner,choice);
  const adapter=dshSummaryModel(this.llm,'','',{currentSelection:()=>selection});
  return {...adapter,selection};
 }
}
