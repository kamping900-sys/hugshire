# Real-money test plan (owner-funded, small amounts)

Goal: prove every leg with **your own** money, at about $20 total, before anyone else's money
touches the system. Do it on the production deployment with only your own accounts allowlisted.
Write down every transaction hash.

## 0. Preconditions

- `npm run verify:live` is all ✓ (Vault deployed and registered, operator ≠ owner, keys set).
- Settings: `maxDepositMicro=25000000` ($25), `minPayoutMicro=100000` ($0.10),
  `yieldSettlementSeconds=3600`.
- One organisation is approved: yourself, as a test org. Its receiving account is a NEAR account you
  own, with a USDC storage deposit. It is added with `add_recipient` by the owner multisig and
  verified in `/admin`.
- `pauseAutoDelivery=true` until step 5.

## 1. Deposit $10

1. Sign in with Privy (email). Confirm your Base and NEAR wallet addresses in `/settings`.
2. Support the test cause with $10. Complete the Coinbase checkout.
   - ✅ Webhook `onramp.transaction.success` appears in `/admin/transactions`; the deposit becomes
     `onramp_completed` with the purchased amount (≤ $10 after fees).
3. Confirm the bridge transfer prompt (Base USDC → 1Click deposit address).
   - ✅ The deposit becomes `bridging`, then `bridged`; the 1Click status is `SUCCESS`; the NEAR
     wallet holds about $9.99 USDC.
4. Confirm the Vault deposit prompt (`ft_transfer_call` to the Vault).
   - ✅ The deposit becomes `vault_pending`, then `supplied`; principal equals the Vault's `deposit`
     event amount; a helper appears.
   - ✅ `get_principal(<your NEAR account>)` on the Vault matches the portfolio.
5. The operator calls `supply` for the idle amount (worker or by hand).
   - ✅ RHEA `get_account(vault)` shows the supplied USDC.

## 2. Yield

Wait at least 6 hours.

- ✅ `yield_snapshot` job runs show `allocated` with small positive `yieldMicro`; the portfolio's
  "Yield earned" grows; reconciliation is all green.
- ✅ Cross-check: Vault RHEA balance − total principal ≈ the sum of unpaid allocations + pending
  deliveries.

## 3. Manual delivery and payout

1. In the city, carry parcels to the Cause Hall (or press Deliver now).
   - ✅ The delivery is `pending` with the eligible amount; replaying the same request changes
     nothing.
2. Run the batch, submit and confirm jobs (`/admin/payouts`).
   - ✅ A `distribute_yield` transaction is visible on nearblocks; the receiving account got exactly
     the amount; the payout is `confirmed`; deliveries are `paid`.
3. Negative tests:
   - Call `distribute_yield` with the operator for an amount larger than the accrued yield. ✅ The
     transaction resolves `false`, nothing moves.
   - Call it to a non-allowlisted account. ✅ It panics.
   - Reuse a memo. ✅ It panics.

## 4. Withdrawal of $4

1. Request $4 in the portfolio, then confirm the Vault `withdraw` prompt.
   - ✅ Status moves to `pending_protocol_withdrawal`, then `bridging`; the Vault `withdraw` event
     shows paid = 4,000,000; RHEA balance drops by 4.
2. Bridge back (NEAR → Base via 1Click), then cash out via Coinbase Offramp.
   - ✅ Each status is reached; the fees shown match the quotes; the bank or Coinbase receives the
     money.

## 5. Auto mode

Set `pauseAutoDelivery=false`, your rule to "default cause", threshold $0.01, timeout 5 minutes. Stay
idle for more than 5 minutes after yield is eligible.

- ✅ An `auto` delivery appears; it is paid in the next batch.
- ✅ Opening the city shows "Auto mode (you were away)". Tapping returns you to manual.

## 6. Pause drills

- `pauseDeposits` on: ✅ new deposits refused with a clear message.
- Vault `set_paused(true)` by the operator: ✅ distributions fail safely; `set_paused(false)` by the
  operator is refused; the owner can unpause.

## 7. Wind-down

Withdraw the remaining principal. ✅ The Vault `total_principal` returns to 0; the remaining Vault
balance equals undistributed yield only; reconciliation is green.

Record: date, every tx hash, the fees observed per leg, the total time per leg, and any surprises.
Attach this to the launch decision.
