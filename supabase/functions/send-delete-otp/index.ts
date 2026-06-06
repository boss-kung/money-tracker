import { adminClient, getAuthenticatedUserId } from '../_shared/supabase.ts'
import { handleOptions, jsonResponse } from '../_shared/cors.ts'

const OTP_EXPIRY_MINUTES = 10

async function hashOtp(otp: string, userId: string): Promise<string> {
  const data = new TextEncoder().encode(`${otp}:${userId}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async req => {
  const options = handleOptions(req)
  if (options) return options
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, req)

  try {
    const userId = await getAuthenticatedUserId(req)
    if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401, req)

    const supabase = adminClient()

    // Get user email via admin API
    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(userId)
    if (userErr || !user?.email) return jsonResponse({ error: 'User not found' }, 404, req)

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000))
    const otpHash = await hashOtp(otp, userId)
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString()

    // Upsert — one active OTP per user at a time
    const { error: dbErr } = await supabase
      .from('mt_delete_otps')
      .upsert({ user_id: userId, otp_hash: otpHash, expires_at: expiresAt }, { onConflict: 'user_id' })
    if (dbErr) throw dbErr

    // Send via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) throw new Error('RESEND_API_KEY not configured')

    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Financial Tracker <onboarding@resend.dev>'

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [user.email],
        subject: 'รหัสยืนยันการลบบัญชี — Financial Tracker',
        html: buildEmailHtml(otp),
      }),
    })

    if (!emailResp.ok) {
      const err = await emailResp.json().catch(() => ({}))
      throw new Error(`Email send failed: ${(err as Record<string, string>).message ?? emailResp.status}`)
    }

    return jsonResponse({ ok: true }, 200, req)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, req)
  }
})

function buildEmailHtml(otp: string): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
  <div style="background:#1e293b;padding:24px 32px;text-align:center">
    <div style="font-size:32px;margin-bottom:8px">💰</div>
    <div style="color:#fff;font-size:16px;font-weight:600;letter-spacing:0.5px">Financial Tracker</div>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0f172a">ยืนยันการลบบัญชี</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6">
      เราได้รับคำขอ<strong>ลบบัญชี Financial Tracker</strong> ของคุณ<br>
      กรุณาใช้รหัสด้านล่างในแอปเพื่อยืนยัน
    </p>
    <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;padding:20px;text-align:center;margin:0 0 24px">
      <div style="font-size:12px;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:1.5px;font-weight:600">รหัสยืนยัน</div>
      <div style="font-size:38px;font-weight:800;letter-spacing:10px;color:#0f172a;font-family:'Courier New',monospace">${otp}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:10px">หมดอายุใน 10 นาที · ใช้ได้ครั้งเดียว</div>
    </div>
    <div style="background:#fff5f5;border-left:3px solid #ef4444;border-radius:4px;padding:12px 16px;margin:0 0 24px">
      <div style="font-size:13px;color:#dc2626;font-weight:600;margin-bottom:3px">⚠️ การดำเนินการนี้ไม่สามารถย้อนกลับได้</div>
      <div style="font-size:13px;color:#7f1d1d;line-height:1.5">ข้อมูลการเงินและบัญชีของคุณจะถูกลบถาวร</div>
    </div>
    <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6">
      หากคุณไม่ได้ส่งคำขอนี้ ไม่ต้องทำอะไร — บัญชียังปลอดภัย รหัสนี้จะหมดอายุโดยอัตโนมัติ
    </p>
  </div>
  <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
    <div style="font-size:12px;color:#94a3b8">Financial Tracker · ข้อมูลของคุณ เป็นส่วนตัวเสมอ</div>
  </div>
</div>`
}
