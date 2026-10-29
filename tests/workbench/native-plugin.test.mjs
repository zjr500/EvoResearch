import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../plugins/dsh/client.js',import.meta.url),'utf8');
test('native slots, shared primitives and lifecycle registration',()=>{
 let plugin;const entries=[],effects=[],dependencies=[];
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load(row){assert.equal(row.id,'dsh-evoresearch');plugin=row.factory(name=>{dependencies.push(name);return name==='react'?{createElement(){},useState(){},useEffect(){},useRef(){}}:{};})}}}});
 const types=[];const ctx={sidebarRightTabs:{register(d){types.push(d)}},sidebarRight:{openTab(){}},effect(fn){effects.push(fn)},slots:{inject(name,fn){fn()},register(options,component){entries.push({options,component})}},uiWorkspace:{startSession(){}}};
 plugin.apply(ctx);
 assert.deepEqual(dependencies,['react','@deepseek-ai/dsh-client-ui-primitives']);
 assert.equal(entries[0].options.name,'sidebar.right.pane.tab');assert.equal(entries[0].options.key,'evoresearch');effects[1]();assert.equal(types[0].keepMounted,true);
 assert.equal(entries[1].options.name,'conversation.header.leading');assert.equal(entries[2].options.name,'sidebar.footer.action');assert.equal(effects.length,3);assert.ok(!entries.some(e=>e.options.name==='main'||e.options.name==='sidebar.panellist'));
 assert.ok(!source.includes("createElement('iframe'"));assert.ok(!source.includes('postMessage'));
});
test('tool schema allows knowledge-enhanced tasks',async()=>{
 const plugin=await import('../../plugins/dsh/tools.mjs');process.env.EVORESEARCH_TOKEN='unit-test-token-1234567890123';const defs=[];
 plugin.apply({tools:{register(d){defs.push(d)}}});
 const task=defs.find(d=>d.name==='evo_start_experiment').parameters.properties.task;
 assert.equal(task.properties.use_history.type,'boolean');assert.equal(task.properties.use_history.const,undefined);
});

function harness(){
 let plugin,component,cursor=0;const state=[],refs=[];
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]},useRef(initial){const i=cursor++;return refs[i]??=( {current:initial})},useEffect(){}};
 const ui=new Proxy({}, {get:(_,name)=>String(name)});
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load(row){plugin=row.factory(name=>name==='react'?react:ui)}}},localStorage:{getItem(){return 'enabled'}},fetch:async()=>({ok:true,json:async()=>[]}),document:{hidden:false}});
 plugin.apply({effect(){},sidebarRightTabs:{register(){}},sidebarRight:{openTab(){}},uiWorkspace:{startSession(){}},slots:{inject(_,fn){fn()},register(o,c){if(o.name==='sidebar.right.pane.tab')component=c}}});
 const run={run_id:'r1',task_id:'task-one',template_id:'regression',status:'completed',ingestion_status:'retrievable',trials:[],task:{metric_key:'rmse',metric_direction:'minimize',budget:{max_trials:2,max_seconds:600},objective:'test',use_history:true}};
 // Workbench state order is explicit to exercise transitions without a browser or network.
 Object.assign(state,{0:true,2:[{project_id:'p1',name:'Project'}],3:'p1',4:'results',5:{runs:[run],papers:[],knowledge:[{record_id:'k1',run_id:'r1',status:'retrievable',body:{source_type:'experiment'},attempts:1}]}});
 const render=()=>{cursor=100;const pane=component({ask(){}});cursor=0;return pane.type(pane.props)};
 const nodes=tree=>[tree,...(tree?.children||[]).flatMap(x=>typeof x==='object'&&x?nodes(x):[])];
 const text=tree=>typeof tree==='string'?tree:(tree?.children||[]).map(text).join('');
 const find=(tree,title)=>nodes(tree).find(n=>n.type==='Button'&&text(n)===title);
 return {render,nodes,text,find};
}
test('two modules, contextual experiment to knowledge round-trip and native icons',async()=>{
 const t=harness();let tree=t.render();
 const nav=t.nodes(tree).find(n=>n.props.label==='科研核心模块');
 assert.deepEqual(Array.from(nav.props.items,x=>x.value),['experiments','library']);
 assert.ok(t.nodes(nav.props.items[0].label).some(n=>n.type==='IconThinkOutlineRegular'));
 await t.find(tree,'打开实验详情').props.onClick();tree=t.render();
 assert.ok(t.nodes(tree).some(n=>n.props.label==='当前实验视图'));
 await t.find(tree,'查看相关知识').props.onClick();tree=t.render();
 assert.equal(t.nodes(tree).find(n=>n.props.label==='科研核心模块').props.value,'library');
 assert.ok(t.text(tree).includes('知识更新动态'));
 await t.find(tree,'返回实验详情').props.onClick();tree=t.render();
 assert.equal(t.nodes(tree).find(n=>n.props.label==='科研核心模块').props.value,'experiments');
 assert.ok(t.text(tree).includes('task-one'));
});
