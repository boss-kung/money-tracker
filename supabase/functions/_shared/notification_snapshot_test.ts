import { upsertSnapshotIfNewer } from './notification_snapshot_store.ts'
function equal(a:unknown,b:unknown){if(a!==b)throw new Error(`${a} != ${b}`)}
Deno.test('snapshot adapter exposes stale revision rejection and does not hide RPC errors',async()=> {
 const input={installId:'i',userId:'u',schemaVersion:2,revision:11,payload:{credit_due:[]}}
 const stale=await upsertSnapshotIfNewer({rpc:async()=>({data:{accepted:false,revision:12},error:null})},input)
 equal(stale.accepted,false);equal(stale.revision,12)
 let failed=false;try{await upsertSnapshotIfNewer({rpc:async()=>({data:null,error:{message:'not owner'}})},input)}catch{failed=true}equal(failed,true)
})
