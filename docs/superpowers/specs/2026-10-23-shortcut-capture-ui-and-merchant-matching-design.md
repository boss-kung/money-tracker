# Shortcut Capture UI and Merchant Matching Design

## Follow-up correction: actual Shortcut Inbox flow (r148)

The original implementation renamed the Quick Capture launcher but still opened
the voice/free-text flow. Its merchant matcher was not called by
`MTShortcutCapture.openDraft`, which maps server captures directly to transactions.

The floating launcher now belongs to `shortcut_capture.js`, uses an icon-only inbox
tray above Add Transaction, and opens Shortcut Inbox directly. Remove the old
Quick Capture screen and speech actions, including the duplicate Inbox header button.
Expose the existing matcher as a pure suggestion and resolve against the current
merchant catalog before mapping a capture or suggesting its wallet/category.

The r147 Add Transaction viewport-width rule is already present. Add a non-shrinking
sheet constraint and a 16px search-input focus guard. Verify the actual Inbox → review
flow at 320px, 390px, and 440px in both themes; record measured edges rather than
assuming that static CSS tests prove behavior on physical iOS hardware. The demo
also needs the existing shared UI stylesheet for Shortcut Inbox styling.

Regression coverage must invoke `openDraft` with the real suggestion module and
assert canonical merchant names, including array-order independence and ambiguous
fallback. Verify that the launcher actually opens Inbox and has no visible text.

## Intent

Make the Shortcut capture flow feel like a first-class transaction entry path: the launcher is explicit, the transaction detail drawer always fills the iPhone viewport width, and imported merchant text resolves to the most specific existing merchant without creating avoidable duplicates.

## Scope

- Replace the floating microphone icon above Add Transaction with a text button labelled `รายการจาก Shortcut`.
- Keep the microphone inside the Shortcut capture input; only the dashboard launcher changes.
- Make the Add Transaction drawer opened from Shortcut fill the viewport width.
- Prevent iOS form focus from zooming the page and leaving a blank strip beside the drawer.
- Improve matching against `S.merchants` while keeping the existing parser and saved canonical merchant names.

## Chosen approach

Use a scoped UI fix plus a deterministic ranked matcher.

The UI fix targets only `#overlay-add-tx` and `#sheet-add-tx`, so other sheets keep their current presentation. Form controls use a computed font size of at least 16px to prevent Safari's automatic focus zoom. The launcher becomes a compact pill using existing design tokens.

The merchant matcher normalizes punctuation, spacing, legal suffixes, and common location/company noise, then ranks candidates by confidence and specificity. Exact normalized matches win first. Component and containment matches prefer the longest valid merchant, so `SHOPEE*SHOPEEFOOD` resolves to `SHOPEEFOOD`, while the exact input `SHOPEE` still resolves to `SHOPEE`. Corporate text such as `GoWabi (Thailand) Co., Ltd.` resolves to the canonical `Gowabi`. Low-confidence or near-tied fuzzy matches are left unchanged instead of being guessed.

## Alternatives considered

1. Make every sheet globally fixed and full-width. Rejected because it changes unrelated drawers and increases regression risk.
2. Refactor all overlays into a new root-level portal. Rejected because the existing overlay already lives under `body`; it does not address the iOS auto-zoom trigger and is unnecessarily broad.
3. Add a third-party fuzzy matching dependency. Rejected because the dataset is small, deterministic domain rules are clearer, and a dependency would make tuning and offline behavior harder.

## Matching rules

1. Normalize Unicode, case, punctuation, and repeated whitespace.
2. Remove company/legal suffixes and parenthetical location noise for comparison only; retain the stored canonical merchant name as output.
3. Prefer exact normalized or compact matches.
4. For multi-component bank descriptions, prefer the longest exact merchant component.
5. Allow safe containment only for meaningful names, with length and coverage guards.
6. Use token similarity and edit similarity only above conservative thresholds.
7. Break equal-confidence matches by specificity, then stable lexical order—not array order.
8. Reject ambiguous fuzzy results when the best candidate is not clearly better than the runner-up.

## Validation

- Unit tests cover both merchant array orders, corporate suffix cleanup, exact-name precedence, similar spelling, and ambiguous fallback.
- Static UI tests cover the text launcher, scoped full-width drawer, and the 16px iOS zoom guard.
- Run the complete Node test suite.
- Inspect the flow in a narrow mobile viewport in light and dark themes.
