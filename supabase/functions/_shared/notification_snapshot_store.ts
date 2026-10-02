type RpcClient = { rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}> }
export async function upsertSnapshotIfNewer(client:RpcClient,input:{installId:string;userId:string;schemaVersion:number;revision:number;payload:Record<string,unknown>}) {
 const {data,error}=await client.rpc('mt_upsert_notification_snapshot_v2',{p_install_id:input.installId,p_user_id:input.userId,p_schema_version:input.schemaVersion,p_revision:input.revision,p_payload:input.payload})
 if(error)throw new Error(error.message)
 const result=data as {accepted?:boolean;revision?:number}|null
 if(!result || typeof result.accepted!=='boolean' || !Number.isSafeInteger(Number(result.revision)))throw new Error('Invalid snapshot storage response')
 return {accepted:result.accepted,revision:Number(result.revision)}
}
