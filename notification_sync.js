;(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MTNotificationSync=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function create({readSnapshot,readScope,transport,scopedStorage,canSync=()=>true,onStatus=()=>{},clock={now:()=>Date.now(),setTimeout,clearTimeout},withLock=(_key,fn)=>fn()}) {
    let inFlight=null,timer=null,disposed=false
    const ownerId=`${Date.now()}:${Math.random()}`
    const key=scope=>`mt_notification_sync_v2:${scope}`
    function load(scope){try{return JSON.parse(scopedStorage.getItem(key(scope))||'{}')}catch{return {}}}
    function save(scope,state){scopedStorage.setItem(key(scope),JSON.stringify(state));onStatus(state)}
    const startingRevisions=new Map()
    // Capture persisted scopes before asynchronous authentication can resolve.
    for(let i=0;i<Number(scopedStorage.length||0);i++) {
      const storedKey=scopedStorage.key(i)
      if(storedKey?.startsWith('mt_notification_sync_v2:')) {
        const scope=storedKey.slice('mt_notification_sync_v2:'.length)
        startingRevisions.set(scope,Number(load(scope).revision)||0)
      }
    }
    const initialScope=readScope()
    if(initialScope)startingRevisions.set(initialScope,Number(load(initialScope).revision)||0)
    function capture(){const scope=readScope();if(!scope)return null;if(!startingRevisions.has(scope))startingRevisions.set(scope,0);const snapshot=readSnapshot();return {scope,snapshot,fingerprint:JSON.stringify(snapshot)}}
    function markDirty(force=false) {
      if(disposed)return
      const c=capture();if(!c)return
      const old=load(c.scope)
      if(force || old.fingerprint!==c.fingerprint)save(c.scope,{...old,ownerId,revision:Math.max(0,Number(old.revision)||0)+1,dirty:true,fingerprint:c.fingerprint})
      if(timer!==null)clock.clearTimeout(timer)
      timer=clock.setTimeout(()=>{timer=null;flush().catch(()=>{})},1000)
    }
    async function sendLoop(force) {
      if(disposed || !canSync())return false
      let c=capture();if(!c)return false
      let result=true
      await withLock(key(c.scope),async()=> {
        for(let attempt=0;attempt<5;attempt++) {
          if(disposed || !canSync() || readScope()!==c.scope)return
          const state=load(c.scope)
          // A different tab owns newer financial state. Refreshing must not replace it.
          if(state.fingerprint && state.fingerprint!==c.fingerprint && state.ownerId!==ownerId && Number(state.revision)>startingRevisions.get(c.scope)){result=false;return}
          if(!force && !state.dirty && state.fingerprint===c.fingerprint && clock.now()-Number(state.lastSuccess||0)<600000)return
          const revision=Math.max(0,Number(state.revision)||0)+1
          save(c.scope,{...state,ownerId,revision,dirty:true,fingerprint:c.fingerprint})
          let response
          try{response=await transport({...c.snapshot,snapshotSchemaVersion:2,snapshotRevision:revision})}
          catch(error){result=false;onStatus({...load(c.scope),error:error.message || 'Sync failed'});throw error}
          if(disposed || readScope()!==c.scope)return
          const current=load(c.scope), latest=capture()
          if(current.ownerId!==ownerId){result=false;return}
          const returnedRevision=Number(response?.revision)
          if(!Number.isSafeInteger(returnedRevision) || returnedRevision<revision || typeof response?.accepted!=='boolean')throw new Error('Invalid snapshot sync response')
          const changed=current.fingerprint!==c.fingerprint || latest.fingerprint!==c.fingerprint
          save(c.scope,{...current,revision:Math.max(revision,returnedRevision),dirty:changed || !response.accepted,fingerprint:latest.fingerprint,lastSuccess:response.accepted?clock.now():current.lastSuccess})
          force=false
          if(response.accepted && !changed)return
          c=latest
        }
        result=false
        markDirty(true)
      })
      return result
    }
    function flush({force=false}={}) {
      if(inFlight)return inFlight
      inFlight=sendLoop(force).finally(()=>{inFlight=null})
      return inFlight
    }
    function resume(){return flush()}
    function dispose(){disposed=true;if(timer!==null)clock.clearTimeout(timer)}
    return {markDirty,flush,resume,dispose}
  }
  return {create}
})
