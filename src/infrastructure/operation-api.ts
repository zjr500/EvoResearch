import type {OperationService} from './operations.js';
import {AppError} from './errors.js';
import {resourceId,success,failure} from './http.js';
export function operationApi(operations:OperationService) {
 return async(request:Request,owner:number)=>{
  try {
   const match=new URL(request.url).pathname.match(/^\/operations\/(\d+)$/);
   if(request.method!=='GET'||!match)throw new AppError(4004,'Route not found');
   return success(operations.getPublic(owner,resourceId(match[1])));
  }catch(e){return failure(e);}
 };
}
