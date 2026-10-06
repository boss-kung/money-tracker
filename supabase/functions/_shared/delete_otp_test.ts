import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { consumeDeleteOtp, generateDeleteOtp, hashDeleteOtp, issueDeleteOtp } from './delete_otp.ts'

Deno.test('delete OTP generation returns a six-digit cryptographic value', () => {
  const otp = generateDeleteOtp()
  assert(/^\d{6}$/.test(otp))
  assert(Number(otp) >= 100000 && Number(otp) <= 999999)
})

Deno.test('delete OTP issue and consume use dedicated RPCs', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return { data: true, error: null }
    },
  }
  const hash = await hashDeleteOtp('123456', 'user-1')
  assertEquals(await issueDeleteOtp(client, {
    userId: 'user-1',
    otpHash: hash,
    expiresAt: '2026-10-06T10:10:00.000Z',
  }), true)
  assertEquals(await consumeDeleteOtp(client, { userId: 'user-1', otpHash: hash }), true)
  assertEquals(calls, [
    {
      name: 'mt_issue_delete_otp',
      args: { p_user_id: 'user-1', p_otp_hash: hash, p_expires_at: '2026-10-06T10:10:00.000Z' },
    },
    { name: 'mt_consume_delete_otp', args: { p_user_id: 'user-1', p_otp_hash: hash } },
  ])
})

Deno.test('delete OTP handles rejected claims and RPC errors', async () => {
  const rejectedClient = {
    async rpc(name: string) {
      return { data: name === 'mt_issue_delete_otp' ? false : null, error: null }
    },
  }
  assertEquals(await issueDeleteOtp(rejectedClient, {
    userId: 'user-1', otpHash: 'hash', expiresAt: '2026-10-06T10:10:00.000Z',
  }), false)
  assertEquals(await consumeDeleteOtp(rejectedClient, { userId: 'user-1', otpHash: 'hash' }), false)

  const errorClient = {
    async rpc() {
      return { data: null, error: { message: 'otp rpc failed' } }
    },
  }
  await assertRejects(
    () => issueDeleteOtp(errorClient, {
      userId: 'user-1', otpHash: 'hash', expiresAt: '2026-10-06T10:10:00.000Z',
    }),
    Error,
    'otp rpc failed',
  )
})
