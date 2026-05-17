/* notification_config.example.js — template for local development
   ─────────────────────────────────────────────────────────────────
   1. Copy this file to notification_config.js  (gitignored)
   2. Fill in your credentials from Firebase Console and Supabase Dashboard
   3. Never commit notification_config.js — it stays local only

   On the deployed GitHub Pages site, the real notification_config.js
   is generated automatically from GitHub Secrets by CI (see .github/workflows/deploy.yml).
*/
globalThis.MT_SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
globalThis.MT_SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
globalThis.MT_FCM_VAPID_KEY = 'YOUR_FCM_VAPID_PUBLIC_KEY';
globalThis.MT_FIREBASE_CONFIG = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};
