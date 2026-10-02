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

test('stale tab cannot resurrect paid debt by resume or forced refresh',async()=> {
 const store=new Map(),sent=[];let aValue={snapshotDate:'2026-06-03',creditDue:[{daysLeft:1}]}
 const oldValue=aValue
 const make=readSnapshot=>require('../notification_sync.js').create({readScope:()=> 'u:i',readSnapshot,transport:async s=>{sent.push(s);return {accepted:true,revision:s.snapshotRevision}},scopedStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},clock:{now:()=>100000,setTimeout:()=>0,clearTimeout(){}}})
 const a=make(()=>aValue),b=make(()=>oldValue)
 await a.flush();aValue={...aValue,creditDue:[]};a.markDirty();await a.flush()
 await b.resume();await b.flush({force:true})
 assert.equal(sent.length,2)
 assert.deepEqual(sent.at(-1).creditDue,[])
})

test('a newly hydrated tab can refresh the Bangkok date after reload',async()=> {
 const f=fixture();await f.Q.flush()
 const sent=[]
 const q=require('../notification_sync.js').create({readScope:()=> 'u:i',readSnapshot:()=>({snapshotDate:'2026-06-04',creditDue:[{daysLeft:0}]}),scopedStorage:{getItem:k=>f.store.get(k)||null,setItem:(k,v)=>f.store.set(k,v)},transport:async s=>{sent.push(s);return {accepted:true,revision:s.snapshotRevision}},clock:{now:()=>100000,setTimeout:()=>0,clearTimeout(){}}})
 await q.flush({force:true});assert.equal(sent.length,1);assert.equal(sent[0].snapshotDate,'2026-06-04')
})

test('committed dirty generation blocks a stale tab before debounce uploads',async()=> {
 const store=new Map(),sent=[];let value={snapshotDate:'2026-06-03',creditDue:[{daysLeft:1}]}
 const original=value
 const make=readSnapshot=>require('../notification_sync.js').create({readScope:()=> 'u:i',readSnapshot,transport:async s=>{sent.push(s);return {accepted:true,revision:s.snapshotRevision}},scopedStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},clock:{now:()=>100000,setTimeout:()=>0,clearTimeout(){}}})
 await make(()=>original).flush()
 const a=make(()=>value),b=make(()=>original)
 value={...value,creditDue:[]};a.markDirty();await b.resume();await a.flush()
 assert.equal(sent.length,2);assert.deepEqual(sent.at(-1).creditDue,[])
})

test('late authentication cannot adopt a revision written after tab initialization',async()=> {
 const store=new Map(),sent=[];let value={snapshotDate:'2026-06-03',creditDue:[{daysLeft:1}]},scope=''
 const original=value,storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),get length(){return store.size},key:i=>[...store.keys()][i]}
 const make=(readScope,readSnapshot)=>require('../notification_sync.js').create({readScope,readSnapshot,transport:async s=>{sent.push(s);return {accepted:true,revision:s.snapshotRevision}},scopedStorage:storage,clock:{now:()=>100000,setTimeout:()=>0,clearTimeout(){}}})
 const a=make(()=> 'u:i',()=>value),b=make(()=>scope,()=>original)
 await a.flush();value={...value,creditDue:[]};a.markDirty();await a.flush();scope='u:i';await b.resume()
 assert.equal(sent.length,2);assert.deepEqual(sent.at(-1).creditDue,[])
})
