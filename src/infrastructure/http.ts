import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, ownerId } from './errors.js';
export const MAX_BODY_BYTES=28*1024*1024;
export interface DshConnection {
 admit(request:{headers:IncomingMessage['headers']}):{rejection:401|403}|{peer:{principal:{kind:string}}};
}
export function authenticatedOwner(connection:DshConnection,request:IncomingMessage):number {
 const admission=connection.admit(request);
 if('rejection' in admission) throw new AppError(4001,'DSH authentication required',null,admission.rejection);
 if(admission.peer.principal.kind!=='owner') throw new AppError(4001,'DSH owner access required',null,403);
 // DSH 0.2.1 exposes a local host owner, not a tenant user ID. Preserve existing ownership.
 return 1;
}
export function success(data:unknown,message='ok',status=200) {return Response.json({code:0,message,data},{status});}
export function failure(error:unknown) {
 const known=error instanceof AppError;
 return Response.json({code:known?error.code:5000,message:known?error.message:'Internal operation error',data:known?error.data:null},
  {status:known?(error.httpStatus??(error.code===4004?404:400)):500});
}
export function resourceId(text:string):number {
 const value=Number(text);
 if(!/^\d+$/.test(text)||!Number.isSafeInteger(value)||value<1)throw new AppError(4001,'Invalid resource ID');
 return value;
}
export async function objectBody(request:Request):Promise<Record<string,unknown>> {
 const raw=await request.text();
 if(Buffer.byteLength(raw)>MAX_BODY_BYTES)throw new AppError(4001,'Request too large',null,413);
 let body:unknown;
 try {body=JSON.parse(raw);}catch{throw new AppError(4001,'Invalid JSON');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError(4001,'Expected object');
 if(['owner_id','uploader_id','userId','owner','user_id'].some(k=>k in body))throw new AppError(4001,'Ownership is supplied by DSH');
 return body as Record<string,unknown>;
}
export function authenticatedHandler(connection:DshConnection,api:(request:Request,owner:number)=>Promise<Response>,maxBytes=MAX_BODY_BYTES) {
 return async(req:IncomingMessage,res:ServerResponse)=>{
  let response:Response;
  try {
   const owner=authenticatedOwner(connection,req);ownerId(owner);
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of req.iterator({destroyOnReturn:false})){const b=Buffer.from(chunk);size+=b.length;if(size>maxBytes)throw new AppError(4001,'Request too large',null,413);chunks.push(b);}
   const headers=new Headers();const contentType=req.headers['content-type'];if(contentType)headers.set('content-type',contentType);
   response=await api(new Request('http://localhost'+req.url,{method:req.method,headers,
    body:['GET','HEAD'].includes(req.method??'GET')?undefined:Buffer.concat(chunks)}),owner);
  }catch(error){req.resume();response=failure(error);}
  if(!res.headersSent){
   const contentType=response.headers.get('content-type')??'application/json; charset=utf-8';
   if(contentType.includes('application/json')){res.writeHead(response.status,{'content-type':contentType});res.end(await response.text());}
   else{const body=Buffer.from(await response.arrayBuffer());res.writeHead(response.status,{'content-type':contentType,'content-length':body.length});res.end(body);}
  }
 };
}
