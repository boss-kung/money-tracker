import { deliverClaimedNotification } from './notification_delivery.ts'
function equal(a:unknown,b:unknown){if(a!==b)throw new Error(`${a} != ${b}`)}
function fixture(){let claimed=false,sends=0;return {get sends(){return sends},logStore:{claim:async()=>{if(claimed)return null;claimed=true;return 'token'},finish:async()=>{}},transport:async()=>{sends++},isStillCurrent:async()=>true}}
Deno.test('concurrent cron sends once after atomic claim',async()=>{const f=fixture();await Promise.all([deliverClaimedNotification(f),deliverClaimedNotification(f)]);equal(f.sends,1)})
Deno.test('changed snapshot after claim suppresses obsolete reminder',async()=>{const f=fixture();const r=await deliverClaimedNotification({...f,isStillCurrent:async()=>false});equal(r.sent,false);equal(f.sends,0)})
Deno.test('log write errors must not be reported as successful delivery',async()=>{const f=fixture();let failed=false;try{await deliverClaimedNotification({...f,logStore:{...f.logStore,finish:async()=>{throw new Error('log unavailable')}}})}catch{failed=true}equal(failed,true)})
Deno.test('transport failure releases the claim as error',async()=>{const f=fixture();let status='';const r=await deliverClaimedNotification({...f,transport:async()=>{throw new Error('push error')},logStore:{...f.logStore,finish:async(_token:string,next:string)=>{status=next}}});equal(r.sent,false);equal(status,'error')})
