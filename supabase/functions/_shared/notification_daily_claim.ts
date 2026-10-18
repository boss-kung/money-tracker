type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message: string } | null
  }>
}

type DailyClaimInput = {
  installId: string
  userId: string
  dedupeKey: string
  title: string
  body: string
}

export async function claimDailyNotification(client: RpcClient, input: DailyClaimInput): Promise<string | null> {
  const { data, error } = await client.rpc('mt_claim_daily_notification', {
    p_install_id: input.installId,
    p_user_id: input.userId,
    p_dedupe_key: input.dedupeKey,
    p_title: input.title,
    p_body: input.body,
  })
  if (error) throw new Error(error.message)
  if (data === null || data === undefined) return null
  const token = String(data)
  return token || null
}
