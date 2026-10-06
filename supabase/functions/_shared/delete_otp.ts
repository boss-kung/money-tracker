type RpcError = { message: string } | null

type OtpRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: RpcError
  }>
}

const OTP_MIN = 100000
const OTP_RANGE = 900000
const UINT32_RANGE = 0x100000000
const ACCEPTED_RANDOM_LIMIT = Math.floor(UINT32_RANGE / OTP_RANGE) * OTP_RANGE

/** Generate a six-digit OTP from Web Crypto rather than Math.random(). */
export function generateDeleteOtp(): string {
  const random = new Uint32Array(1)
  do {
    crypto.getRandomValues(random)
  } while (random[0] >= ACCEPTED_RANDOM_LIMIT)
  return String(OTP_MIN + (random[0] % OTP_RANGE))
}

export async function hashDeleteOtp(otp: string, userId: string): Promise<string> {
  const data = new TextEncoder().encode(`${otp}:${userId}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function issueDeleteOtp(
  client: OtpRpcClient,
  input: { userId: string; otpHash: string; expiresAt: string },
): Promise<boolean> {
  const { data, error } = await client.rpc('mt_issue_delete_otp', {
    p_user_id: input.userId,
    p_otp_hash: input.otpHash,
    p_expires_at: input.expiresAt,
  })
  if (error) throw new Error(error.message)
  return data === true || data === 'true'
}

export async function consumeDeleteOtp(
  client: OtpRpcClient,
  input: { userId: string; otpHash: string },
): Promise<boolean> {
  const { data, error } = await client.rpc('mt_consume_delete_otp', {
    p_user_id: input.userId,
    p_otp_hash: input.otpHash,
  })
  if (error) throw new Error(error.message)
  return data === true || data === 'true'
}
