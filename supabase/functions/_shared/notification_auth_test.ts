import { requireInstallOwnership, requireAuthenticatedUserId, requestErrorStatus } from './supabase.ts'

function equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`${actual} != ${expected}`) }
function database(owner: string | null | undefined, queryError: Error | null = null) {
  return { from(table: string) {
    equal(table, 'mt_notification_devices')
    return { select(field: string) { equal(field, 'user_id'); return this }, eq(field: string, value: string) { equal(field, 'install_id'); equal(value, 'install-a'); return this },
      maybeSingle: async () => ({ data: owner === undefined ? null : { user_id: owner }, error: queryError }) }
  } } as unknown as Parameters<typeof requireInstallOwnership>[0]
}
async function rejects(fn: () => Promise<unknown>, status: number, code: string) {
  try { await fn() } catch (error) { equal(requestErrorStatus(error), status); equal(Reflect.get(error as object, 'code'), code); return }
  throw new Error('Expected rejection')
}

Deno.test('missing device can be identified without weakening ownership enforcement', async () => {
  await rejects(() => requireInstallOwnership(database(undefined), 'install-a', 'user-a'), 403, 'DEVICE_NOT_REGISTERED')
  await requireInstallOwnership(database('user-a'), 'install-a', 'user-a')
  await rejects(() => requireInstallOwnership(database('user-b'), 'install-a', 'user-a'), 403, 'DEVICE_OWNERSHIP_MISMATCH')
})
Deno.test('only explicit registration options permit an absent or anonymous device', async () => {
  await requireInstallOwnership(database(undefined), 'install-a', 'user-a', { allowUnregistered: true })
  await requireInstallOwnership(database(null), 'install-a', 'user-a', { allowClaimAnonymous: true })
  await rejects(() => requireInstallOwnership(database(null), 'install-a', 'user-a'), 403, 'DEVICE_OWNERSHIP_MISMATCH')
  await rejects(() => requireInstallOwnership(database('user-b'), 'install-a', 'user-a', { allowUnregistered: true, allowClaimAnonymous: true }), 403, 'DEVICE_OWNERSHIP_MISMATCH')
})
Deno.test('database failures remain server errors rather than registration signals', async () => {
  const queryError = new Error('Database unavailable')
  try { await requireInstallOwnership(database(undefined, queryError), 'install-a', 'user-a') } catch (error) { equal(error, queryError); equal(requestErrorStatus(error), 500); return }
  throw new Error('Expected query failure')
})
Deno.test('missing user Authorization remains unauthorized', async () => {
  await rejects(() => requireAuthenticatedUserId(new Request('https://test.example')), 401, 'UNAUTHORIZED')
})
