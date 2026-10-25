# Shortcut profile wizard verification

Date: 2026-10-25  
Release: `2026.10.25-shortcut-profiles-r154`

## Automated verification

- `node --test tests/*.test.js` — **558 passed, 0 failed**.
- Focused release/profile suites — **28 passed, 0 failed**:
  - `tests/feature_loader.test.js`
  - `tests/shortcut_capture_ui.test.js`
  - `tests/release_manifest.test.js`
  - `tests/shortcut_profiles_ui.test.js`
  - `tests/shortcut_profile_ui_static.test.js`
- `node --check shortcut_profile_core.js` — passed.
- `node --check shortcut_profiles.js` — passed.
- `git diff --check` — passed.

Coverage includes local-only sample handling, candidate safety checks, explicit direction, the three-step flow, conflict metadata, dark-mode tokens, safe-area footer spacing, 16px controls, touch targets, reduced-motion behavior, production/demo cache-key parity, and deferred feature ordering.

## Browser smoke check

Tested the local demo at `http://127.0.0.1:8765/demo/` without real bank notifications, tokens, raw samples, or decrypted payloads.

1. Navigated **เพิ่มเติม → ตั้งค่า**.
2. Confirmed the visible **รูปแบบแจ้งเตือนธนาคาร** entry and its helper copy for adding UCHOOSE/other apps.
3. Opened the profile screen. The local demo has no authenticated profile backend, so the list showed the intentional retry/error state instead of creating a profile. The state rendered with the redesigned header, bounded content card, accessible retry button, and no visible horizontal overflow.
4. The browser viewport was the available local QA viewport; exact 320×568, 375×812, 390×844, and 430×932 overrides were not available through this browser connector. Those breakpoint behaviors are covered by the scoped CSS/static assertions and the mobile media query.

## Privacy and release notes

- Notification samples remain in the wizard draft and are not persisted or sent.
- Only the compiled rule and profile metadata are sent on activation.
- Production and demo HTML now use release `r154` for CSS/JS cache keys.
- The backend profile functions still need to be deployed/configured before the live list can load; this verification intentionally does not perform a Supabase deployment.
