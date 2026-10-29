import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {ResearchAPI} from '../../../packages/autoresearch/src/autoresearch/web/lib/api.js';

test('HTTP401保留状态码，供页面区分待认证与空项目',async()=>{
  const api=new ResearchAPI({fetchImpl:async()=>({ok:false,status:401,json:async()=>({detail:'Invalid team token'})})});
  await assert.rejects(api.projects(),error=>error.status===401&&/HTTP 401/.test(error.message));
});

test('重开标签缺少认证时不显示零项目，重新连接后找回原项目；已认证空列表仍正常展示',async t=>{
  const nodes=new Map(),events=new Map(),storage=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:false});return nodes.get(id);};
  const document={getElementById:node,activeElement:null,hidden:false,addEventListener:(type,handler)=>events.set(type,handler)};
  const location=new URL('http://localhost/?mode=live#/projects');
  const window={AUTORESEARCH_CONFIG:{},addEventListener(){},scrollTo(){}};
  const localStorage={getItem:()=>null,setItem(){}};
  const sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  let projects=[{id:'project_existing',goal:'原项目及结果保留',template_id:'digits-mlp-v1',budget:{rounds:2},runs:[]}];
  const fetch=async(url,options)=>{
    const authorized=options.headers.Authorization==='Bearer test-only-token';
    const data=url==='/health'?{provider:'openai_compatible',runner:'local_trusted'}:url==='/api/templates'?[]:projects;
    return {ok:authorized||url==='/health',status:authorized?200:401,json:async()=>authorized||url==='/health'?data:{detail:'Invalid team token'}};
  };
  for(const [key,value] of Object.entries({document,location,window,localStorage,sessionStorage,fetch})){
    const old=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
    t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
  }
  t.mock.method(globalThis,'setInterval',()=>0);
  await import('../../../packages/autoresearch/src/autoresearch/web/app.js?auth-reopen-test');
  const settle=async()=>{for(let i=0;i<10;i++)await setImmediate();};
  const refresh=async()=>{
    events.get('click')({target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'refresh'}}:null}});
    await settle();
  };
  await settle();
  assert.match(node('main').innerHTML,/请重新连接研究服务/);
  assert.doesNotMatch(node('main').innerHTML,/这里还没有研究项目|个项目|暂无运行记录/);
  assert.match(node('connection-button').innerHTML,/需要重新认证/);
  location.hash='/runs';await refresh();
  assert.match(node('main').innerHTML,/请重新连接研究服务/);
  assert.doesNotMatch(node('main').innerHTML,/暂无运行记录/);
  storage.set('ar-local-token','test-only-token');location.hash='/projects';await refresh();
  assert.match(node('main').innerHTML,/原项目及结果保留/);
  assert.doesNotMatch(node('main').innerHTML,/请重新连接研究服务/);
  projects=[];await refresh();
  assert.match(node('main').innerHTML,/这里还没有研究项目/);
});
