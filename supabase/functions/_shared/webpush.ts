// @deno-types="npm:@types/web-push@3"
import webpush from 'npm:web-push@3.6.7'

export type WebPushSubscription = {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export type PushPayload = {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  renotify?: boolean
  data?: Record<string, unknown>
  actions?: Array<{ action: string; title: string }>
}

export async function sendWebPush(subscription: WebPushSubscription, payload: PushPayload): Promise<void> {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error('Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY secrets')
  }
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('Invalid push subscription')
  }

  const appLink = Deno.env.get('MT_APP_LINK') || ''
  let subject = 'mailto:admin@money-tracker.app'
  try {
    if (appLink) subject = new URL(appLink).origin
  } catch (_) {}

  webpush.setVapidDetails(subject, vapidPublicKey, vapidPrivateKey)
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(payload),
      { TTL: 86400 },
    )
  } catch (err: unknown) {
    const code = (err as { statusCode?: number }).statusCode
    const body = (err as { body?: string }).body
    throw new Error(`WebPush ${code ?? '?'}: ${body || (err instanceof Error ? err.message : String(err))}`)
  }
}
