type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message: string } | null
  }>
}

type RuleSyncInput = {
  installId: string
  userId: string
  rows: Array<Record<string, unknown>>
}

export async function replaceNotificationRules(client: RpcClient, input: RuleSyncInput) {
  const { data, error } = await client.rpc('mt_replace_notification_rules', {
    p_install_id: input.installId,
    p_user_id: input.userId,
    p_rules: input.rows,
  })
  if (error) throw new Error(error.message)
  const synced = Number((data as { synced?: unknown } | null)?.synced)
  if (!Number.isSafeInteger(synced) || synced < 0) throw new Error('Invalid rule replacement response')
  return { synced }
}
