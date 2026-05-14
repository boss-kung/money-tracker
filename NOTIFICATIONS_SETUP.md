# Money Tracker Notifications Setup

This repo is wired for Firebase Cloud Messaging + Supabase Edge Functions.

## Already deployed

- Supabase project: `bwtoyxxwwmsaoaitihqj`
- Tables: `mt_notification_devices`, `mt_notification_preferences`, `mt_notification_snapshots`, `mt_notification_logs`
- Edge Functions:
  - `register-notification-device`
  - `update-notification-preferences`
  - `sync-notification-snapshot`
  - `send-daily-expense-reminders`
- Cron: every day at `13:30 UTC` (`20:30 Asia/Bangkok`)

## Firebase steps

1. Create or open a Firebase project.
2. Add a Web app.
3. Open Project settings > Cloud Messaging.
4. Generate a Web Push certificate and copy the VAPID key.
5. Create a service account private key JSON.

## Frontend config

Fill these values in `notification_config.js`:

```js
globalThis.MT_FCM_VAPID_KEY = '...'
globalThis.MT_FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: '...',
  projectId: '...',
  storageBucket: '...',
  messagingSenderId: '...',
  appId: '...',
}
```

Keep Firebase service account private keys out of frontend files.

## Supabase secrets

Set these secrets from the Firebase service account JSON:

```bash
supabase secrets set FIREBASE_PROJECT_ID='your-firebase-project-id'
supabase secrets set FIREBASE_CLIENT_EMAIL='firebase-adminsdk-...@your-project.iam.gserviceaccount.com'
supabase secrets set FIREBASE_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n'
supabase secrets set MT_APP_LINK='https://your-deployed-money-tracker-url/'
```

Then redeploy the sender function:

```bash
supabase functions deploy send-daily-expense-reminders
```

## Testing

1. Serve the app over HTTPS or localhost.
2. Open More > การแจ้งเตือน.
3. Tap เปิดการแจ้งเตือน.
4. Tap ทดสอบในเครื่อง.
5. Run the sender manually:

Use the Supabase dashboard function tester, or call the endpoint with `curl`.
Include the Supabase anon key as both `apikey` and `Authorization: Bearer ...`.
