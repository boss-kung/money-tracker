import { claimDailyNotification } from './notification_daily_claim.ts'

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${actual} != ${expected}`)
}

Deno.test('daily claim returns one token when concurrent callers share an atomic RPC', async () => {
  let claimed = false
  const client = {
    rpc: async (_name: string, _args: Record<string, unknown>) => {
      if (claimed) return { data:null, error:null }
      claimed = true
      await new Promise(resolve => setTimeout(resolve, 1))
      return { data:'token-a', error:null }
    },
  }
  const results = await Promise.all([
    claimDailyNotification(client, { installId:'install-a', userId:'user-a', dedupeKey:'daily-expense:2026-10-06', title:'t', body:'b' }),
    claimDailyNotification(client, { installId:'install-a', userId:'user-a', dedupeKey:'daily-expense:2026-10-06', title:'t', body:'b' }),
  ])
  equal(results.filter(Boolean).length, 1)
})

Deno.test('daily claim surfaces RPC errors and accepts a null claim', async () => {
  equal(await claimDailyNotification({ rpc:async () => ({ data:null, error:null }) }, {
    installId:'install-a', userId:'user-a', dedupeKey:'d', title:'t', body:'b',
  }), null)
  let failed = false
  try {
    await claimDailyNotification({ rpc:async () => ({ data:null, error:{ message:'db down' } }) }, {
      installId:'install-a', userId:'user-a', dedupeKey:'d', title:'t', body:'b',
    })
  } catch (error) {
    failed = error instanceof Error && error.message === 'db down'
  }
  equal(failed, true)
})
