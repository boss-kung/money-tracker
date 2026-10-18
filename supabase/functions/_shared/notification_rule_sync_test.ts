import { replaceNotificationRules } from './notification_rule_sync.ts'

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
  }
}

Deno.test('rule replacement uses one transactional RPC and returns its count', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const result = await replaceNotificationRules({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return { data: { synced: 2 }, error: null }
    },
  }, { installId:'install-a', userId:'user-a', rows:[{ rule_id:'r1' }, { rule_id:'r2' }] })

  equal(result, { synced:2 })
  equal(calls.length, 1)
  equal(calls[0].name, 'mt_replace_notification_rules')
  equal(calls[0].args.p_install_id, 'install-a')
  equal(calls[0].args.p_user_id, 'user-a')
})

Deno.test('rule replacement surfaces RPC errors without reporting success', async () => {
  let failed = false
  try {
    await replaceNotificationRules({
      rpc: async () => ({ data:null, error:{ message:'insert failed' } }),
    }, { installId:'install-a', userId:'user-a', rows:[] })
  } catch (error) {
    failed = error instanceof Error && error.message === 'insert failed'
  }
  equal(failed, true)
})
