export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface DefaultModel { currentSelection(): ModelSelection }
// Safe, fixed messages only: these may be exposed in operation results.
export class ModelSelectionError extends Error {}
export function resolveModelSelection(provider: string, model: string, defaults?: DefaultModel): Readonly<ModelSelection> {
 provider=provider.trim(); model=model.trim();
 if (Boolean(provider)!==Boolean(model)) throw new ModelSelectionError('Set both EVORESEARCH_SUMMARY_PROVIDER and EVORESEARCH_SUMMARY_MODEL, or leave both empty to inherit DSH');
 if (provider && model) return Object.freeze({provider,model});
 if (!defaults) throw new ModelSelectionError('DSH default model service is unavailable; configure a DSH default model');
 const selected=defaults.currentSelection();
 if (!selected || typeof selected.provider!=='string' || !selected.provider.trim() || typeof selected.model!=='string' || !selected.model.trim()) throw new ModelSelectionError('DSH default provider/model is incomplete');
 if (selected.reasoningEffort!==undefined && (typeof selected.reasoningEffort!=='string' || !selected.reasoningEffort.trim())) throw new ModelSelectionError('DSH default reasoningEffort is invalid');
 // Effort identifiers are provider-owned. DSH validates supported values; do not hardcode a DeepSeek-only enum.
 return Object.freeze({provider:selected.provider.trim(),model:selected.model.trim(),...(selected.reasoningEffort===undefined?{}:{reasoningEffort:selected.reasoningEffort})});
}
export interface DshLlm {
 stream(options: {provider:string;model:string;reasoningEffort?:string;system:string;messages:{role:'user';content:{type:'text';text:string}[]}[];signal:AbortSignal;maxTokens:number}): AsyncIterable<{type:string;text?:string;reason?:string}>;
}

export type ModelPurpose='summary'|'experiment';
export type ModelChoice={mode:'dsh-default'}|{mode:'selected';provider:string;model:string;reasoningEffort?:string};
export interface ModelDirectory extends DshLlm {
 listProviders():{id:string;name:string}[];
 listModels(provider:string):Promise<{id:string;name?:string}[]>;
 listConfigurableProviders():{provider:string;displayName:string;settingsNs:string}[];
}
export class PurposeModels {
 constructor(private llm:DshLlm,private defaults?:DefaultModel,private env:Record<string,string|undefined>=process.env){}
 selection(purpose:ModelPurpose,choice?:ModelChoice):Readonly<ModelSelection> {
  if(purpose!=='summary'&&purpose!=='experiment')throw new ModelSelectionError('Unknown model purpose');
  if(choice?.mode==='dsh-default')return resolveModelSelection('','',this.defaults);
  if(choice?.mode==='selected')return resolveModelSelection('','',{currentSelection:()=>choice});
  if(choice)throw new ModelSelectionError('Unknown model choice');
  const prefix=purpose==='summary'?'EVORESEARCH_SUMMARY':'EVORESEARCH_EXPERIMENT';
  const provider=this.env[prefix+'_PROVIDER']??'',model=this.env[prefix+'_MODEL']??'';
  if(Boolean(provider.trim())!==Boolean(model.trim()))throw new ModelSelectionError(`Set both ${prefix}_PROVIDER and ${prefix}_MODEL, or leave both empty to inherit DSH`);
  return resolveModelSelection(provider,model,this.defaults);
 }
 // One immutable selection per call; credentials and adapter dispatch stay in DSH.
 stream(purpose:ModelPurpose,request:Omit<Parameters<DshLlm['stream']>[0],'provider'|'model'|'reasoningEffort'>,choice?:ModelChoice) {
  const selection=this.selection(purpose,choice);return this.llm.stream({...request,...selection});
 }
 directory() {
  const llm=this.llm as Partial<ModelDirectory>;
  return {providers:(llm.listProviders?.()??[]).map(({id,name})=>({id,name})),
   configurable:(llm.listConfigurableProviders?.()??[]).map(({provider,displayName,settingsNs})=>({provider,displayName,settingsNs}))};
 }
 async models(provider:string) {
  const llm=this.llm as Partial<ModelDirectory>;
  if(!llm.listModels)throw new ModelSelectionError('DSH model catalog unavailable');
  return (await llm.listModels(provider)).map(({id,name})=>({id,name}));
 }
}
