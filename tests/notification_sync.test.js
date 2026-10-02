const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
function fixture(transport) {
 assert.ok(fs.existsSync(require('node:path').join(__dirname,'../notification_sync.js')),'sync queue exists')
 const store=new Map();let scope='u:i',online=true,value={snapshotDate:'2026-06-03',creditDue:[{daysLeft:1}]},sent=[]
 const Q=require('../notification_sync.js').create({readScope:()=>scope,readSnapshot:()=>value,transport:transport || (async(s)=>{sent.push(s);return {accepted:true,revision:s.snapshotRevision}}),scopedStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},canSync:()=>online,clock:{now:()=>100000,setTimeout:()=>0,clearTimeout(){}},onStatus(){}})
 return {Q,store,sent,set value(v){value=v},get value(){return value},set scope(v){scope=v},set online(v){online=v}}
}
test('successful payment commit bypasses snapshot TTL and sends changed debt',async()=> {
 const f=fixture();await f.Q.flush();f.value={...f.value,creditDue:[]};f.Q.markDirty();await f.Q.flush();assert.equal(f.sent.length,2);assert.deepEqual(f.sent[1].creditDue,[])
 f.Q.markDirty();await f.Q.flush();assert.equal(f.sent.length,2)
})
test('in-flight response cannot clear a new committed snapshot',async()=> {
 let release;const sent=[];const f=fixture(async(s)=>{sent.push(s);if(sent.length===1)await new Promise(r=>release=r);return {accepted:true,revision:s.snapshotRevision}})
 const p=f.Q.flush();await new Promise(r=>setImmediate(r));f.value={...f.value,creditDue:[]};f.Q.markDirty();release();await p
 assert.equal(sent.length,2);assert.deepEqual(sent[1].creditDue,[])
})
test('offline dirty state persists and flushes on resume',async()=> {
 const f=fixture();f.online=false;f.Q.markDirty();assert.equal(await f.Q.flush(),false);assert.ok([...f.store.values()].some(v=>JSON.parse(v).dirty));f.online=true;await f.Q.resume();assert.equal(f.sent.length,1)
})
test('stale revisions retry above server revision and sign-out cannot send new user state',async()=> {
 let n=0;const f=fixture(async(s)=>({accepted:++n>1,revision:n===1?12:s.snapshotRevision}));await f.Q.flush();assert.equal(n,2)
 f.scope='';f.value={...f.value,creditDue:[]};f.Q.markDirty();await f.Q.flush();assert.equal(n,2)
})
test('Bangkok day change refreshes an otherwise identical snapshot',async()=> {
 const f=fixture();await f.Q.flush();f.value={snapshotDate:'2026-06-04',creditDue:[{daysLeft:0}]};await f.Q.resume();assert.equal(f.sent.length,2)
})
