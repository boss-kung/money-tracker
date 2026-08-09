# Money Tracker

Money Tracker is a local-first personal finance context. Its core model records financial events, derives wallet balances from a Ledger, and optionally copies an encrypted Vault to the cloud.

## Language

**Transaction**:
A dated financial event that can affect one or more Wallets. Its stored amount may differ from its Ledger Amount.
_Avoid_: Entry, record, movement

**Wallet**:
A place whose cash balance, debt balance, or investment units are tracked by the Ledger.
_Avoid_: Account, pocket

**Ledger**:
The source of truth that derives Wallet cash flows and investment-unit flows from Posted Transactions, Loan activity, and opening baselines.
_Avoid_: Balance calculator, wallet updater

**Ledger Amount**:
The effective amount a Transaction contributes to the Ledger after applicable discounts or payment-specific rules.
_Avoid_: Net amount, adjusted amount

**Posted Transaction**:
A Transaction that has taken effect and must contribute to current Wallet balances.
_Avoid_: Completed transaction, real transaction

**Scheduled Transaction**:
A future Transaction that must not contribute to current Wallet balances until its date arrives.
_Avoid_: Pending transaction, planned transaction

**Wallet Baseline**:
The opening cash balance or investment units combined with Ledger flows to derive a Wallet's current state.
_Avoid_: Starting value, initial balance

**Vault**:
An encrypted cloud copy of the local financial state, owned by one authenticated user.
_Avoid_: Cloud database, backup row

**Notification Rule**:
A user-owned condition that can produce a scheduled notification from a Notification Snapshot.
_Avoid_: Alert job, reminder trigger

**Notification Snapshot**:
A privacy-limited projection of local financial state used by scheduled notification delivery.
_Avoid_: Cloud state, notification cache
