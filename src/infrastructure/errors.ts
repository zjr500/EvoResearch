export class AppError extends Error {
 constructor(public code:number,message:string,public data:unknown=null,public httpStatus?:number) { super(message); }
}
export function ownerId(value:number):number {
 if(!Number.isSafeInteger(value)||value<1) throw new AppError(4001,'Authenticated owner required');
 return value;
}
