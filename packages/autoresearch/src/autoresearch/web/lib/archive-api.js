/** Read-only recorded responses; deliberately cannot create/start/control any run. */
export class ArchiveAPI {
  constructor(fetchImpl=globalThis.fetch){this.fetchImpl=fetchImpl.bind(globalThis);this.promise=null;}
  async data(){
    if(!this.promise)this.promise=this.fetchImpl('./handoff/catalog.json',{credentials:'omit'}).then(async r=>{if(!r.ok)throw new Error('交接记录文件不可用，请保留完整前端包。');return r.json();}).catch(error=>{this.promise=null;throw error;});
    return this.promise;
  }
  async templates(){return (await this.data()).templates;}
  async projects(){const data=await this.data();return data.projects.map(p=>({...p,runs:p.run_ids.map(id=>data.runs.find(r=>r.id===id))}));}
  async project(id){const project=(await this.projects()).find(p=>p.id===id);if(!project)throw new Error('交接记录中没有该项目。');return project;}
  async run(id){const run=(await this.data()).runs.find(r=>r.id===id);if(!run)throw new Error('交接记录中没有该运行。');return run;}
  async health(){return {recorded:true,provider:'historical_records',runner:'mixed_cpu_records'};}
  create(){throw new Error('交接记录为只读；如需操作，请连接真实服务或切换样例预演。');}
  start(){return this.create();} stop(){return this.create();} resume(){return this.create();}
  async export(id){const data=await this.data(),run=await this.run(id),project=data.projects.find(p=>p.id===run.project_id);return new Response(JSON.stringify({recorded:true,read_only:true,notice:data.notice,source_commit:data.source_commit,source_environment:project?.source_environment,record_source:project?.record_source,run},null,2),{headers:{'Content-Type':'application/json'}});}
  async report(){const r=await this.fetchImpl('./handoff/report.md',{credentials:'omit'});if(!r.ok)throw new Error('交接报告不可用。');return r;}
}
