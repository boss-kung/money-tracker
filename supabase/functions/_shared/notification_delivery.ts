type DeliveryDeps = {
  logStore: { claim:()=>Promise<string|null>; finish:(token:string,status:string,error?:string)=>Promise<void> }
  transport:()=>Promise<void>
  isStillCurrent:()=>Promise<boolean>
}
export async function deliverClaimedNotification({logStore,transport,isStillCurrent}:DeliveryDeps) {
  const token=await logStore.claim()
  if(!token)return {sent:false,reason:'already-claimed'}
  if(!await isStillCurrent()){await logStore.finish(token,'error','Snapshot no longer matches');return {sent:false,reason:'changed-snapshot'}}
  try{await transport()}catch(error){await logStore.finish(token,'error',error instanceof Error?error.message:String(error));return {sent:false,reason:'transport-error'}}
  await logStore.finish(token,'sent')
  return {sent:true,reason:'sent'}
}
