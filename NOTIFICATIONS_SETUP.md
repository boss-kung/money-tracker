# Money Tracker Notifications Setup

This repo is wired for Firebase Cloud Messaging + Supabase Edge Functions.

## Already deployed

- Supabase project: `bwtoyxxwwmsaoaitihqj`
- Tables: `mt_notification_devices`, `mt_notification_preferences`, `mt_notification_snapshots`, `mt_notification_logs`, `mt_notification_rules`
- Edge Functions:
  - `register-notification-device`
  - `update-notification-preferences`
  - `sync-notification-snapshot`
  - `send-daily-expense-reminders`
  - `sync-notification-rules`
  - `send-custom-notification-rules`
- Cron: every day at `13:30 UTC` (`20:30 Asia/Bangkok`)
- Custom rule cron: every 15 minutes

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

Then redeploy the sender and sync functions:

```bash
supabase functions deploy sync-notification-rules --project-ref bwtoyxxwwmsaoaitihqj
supabase functions deploy send-custom-notification-rules --project-ref bwtoyxxwwmsaoaitihqj
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

## Custom notification rules

Open Money Tracker > More > การแจ้งเตือน > กฎแจ้งเตือนเอง.

Each rule can set:

- Title and description.
- Trigger:
  - daily time
  - weekly days/time
  - one-time date/time
  - no transaction today at a chosen time
  - weekday-only time
  - monthly day/time
  - no transaction streak at a chosen time
  - budget threshold at a chosen time
  - recurring due today at a chosen time
  - upcoming bill due at a chosen time
  - credit card due at a chosen time
  - privilege expiry at a chosen time
  - stale backup at a chosen time
- Action route:
  - dashboard
  - add transaction
  - transactions
  - wallets
  - reports
  - more
  - upcoming bills
  - credit cards
  - goals
- Action button label.

Rules are saved locally and synced to Supabase when Firebase/Supabase config is complete. Supabase calls `send-custom-notification-rules` every 15 minutes.

Future rule ideas that fit the current snapshot/Supabase model:

- Spending spike: notify when today's spending is above the user's daily average or above a configurable amount.
- Category inactivity: notify when a selected category has no transaction for X days, useful for savings or habit goals.
- Wallet low balance: notify when a selected wallet drops below a configured amount.
- Goal progress: notify when a goal reaches X% funded, is behind schedule, or needs a recurring contribution.
- Subscription renewal: notify X days before recurring subscriptions or annual fees.
- Credit utilization: notify when a credit card reaches X% of its limit before the statement closes.

Useful extra config:

- Quiet hours and allowed weekdays per rule.
- Max sends per day/week and cooldown after a rule fires.
- Per-rule amount visibility override.
- Category, wallet, merchant, or payment-channel filters.
- Snooze duration and repeat-until-resolved behavior.
