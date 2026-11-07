# Hugshire financial model

## Principles

1. **Principal is the supporter's.** Hugshire never donates it. It can only go back to its owner.
2. **Only measured yield supports causes.** Yield is the observed growth of the pool. It is never a
   promised rate and never anything gameplay produced.
3. **Gameplay controls timing and destination only.** A delivery request carries no amount.
4. **Every number has a source.** Ledger journals are tied to a business event (deposit, snapshot,
   delivery, payout, withdrawal) and posted exactly once.
5. **No floats.** Money is `bigint` micro-USDC in `numeric(38,0)` columns. Rates are 1e18
   fixed-point bigints.

## Amounts we track

| Quantity | Where |
|---|---|
| Original deposit (requested) | `deposits.requested_micro` |
| Fees taken before supply (Coinbase, bridge) | `deposits.fees_micro` (requested minus what the Vault actually received) |
| Credited principal | `deposits.principal_micro`, plus ledger `user:{id}:principal` |
| Current principal position | ledger balance of `user:{id}:principal` (cached in `support_positions`) |
| Redeemable estimate | `principal × min(1, poolAssets / totalPrincipalOwed)` |
| Accrued yield (lifetime) | sum of `yield_allocations.amount_micro` |
| Settling yield | allocations with `eligible_at > now` |
| Eligible / distributable yield | allocations with `eligible_at ≤ now`, minus `consumed_micro` |
| Pending delivery | `deliveries` in `pending` or `queued`, plus `cause:{id}:yield_pending` |
| Completed delivery | `deliveries` in `paid` and `charity_payouts` in `confirmed` with a tx hash |
| Withdrawn | `withdrawals.redeemed_micro` (from the Vault) and `received_micro` (after cash-out) |
| Failed or reverted | deposit `failed`/`refunded`/`manual_review`, payout `failed`/`manual_review`, withdrawal `failed`/`manual_review` |

## Journals (signed: + debit, − credit)

| Event | Entries |
|---|---|
| Deposit supplied | `pool:lending +P`, `user:u:principal −P` |
| Yield measured | `pool:lending +Y`, `user:uᵢ:yield_available −yᵢ` (Σyᵢ = Y), plus `pool:unallocated_yield` for any remainder |
| Delivery assigned | `user:u:yield_available +A`, `cause:c:yield_pending −A` |
| Payout confirmed on chain | `cause:c:yield_pending +A`, `pool:lending −A` |
| Withdrawal requested | `user:u:principal +W`, `user:u:principal_withdrawing −W` |
| Vault paid the withdrawal | `user:u:principal_withdrawing +W`, `pool:lending −R`, `pool:principal_shortfall −(W−R)` |

Each journal is unique on `(environment, kind, ref_type, ref_id)`. A retried webhook or worker
cannot post the same event twice.

## Yield measurement

Every five minutes (`yield_snapshot` job):

1. Skip if any Vault operation is in flight: a deposit in `vault_pending`, a withdrawal in
   `pending_protocol_withdrawal`, or a payout in `submitted`. Otherwise the chain and the ledger would
   briefly disagree.
2. `observed` = Vault's supplied USDC in RHEA (`get_account`, ÷1e12) + the Vault's idle USDC.
   In sandbox, `observed` is the ledger value plus simple interest at the **live** RHEA supply APR on
   the time-weighted pool balance since the last snapshot.
3. `Y = observed − booked(pool:lending)`.
   - If `Y < 0`: **nothing is allocated**, a critical alert is raised, and the UI warns supporters.
   - If `Y ≥ 0`: split `Y` by principal-seconds since the last snapshot:
     `weight(u) = ∫ principal_u(t) dt`, using the largest-remainder method so parts sum exactly to `Y`.
4. Allocations become eligible after `yieldSettlementSeconds` (default 1 h live, 120 s in the sandbox
   seed).

Principal being withdrawn has already moved to `principal_withdrawing` and stops earning
immediately. Interest earned on not-yet-delivered yield is shared by principal holders. This is
documented behaviour and it compounds into future yield.

## Deliveries

`createDelivery(user, cause, mode, idempotencyKey, cap?)`:

1. Replays return the original delivery (unique `(user, idempotency_key)`).
2. The cause must be approved, its organisation approved, and its receiving account verified
   (`payout_ready_at`, `payout_verified_at`). Otherwise the delivery is refused.
3. In one transaction: lock the user's eligible allocations (`FOR UPDATE`) oldest first, consume up
   to the cap, insert `delivery_allocations`, and post the journal. A database `CHECK (consumed ≤
   amount)` is the final guard against delivering the same yield twice.

Auto mode (`auto_delivery` job, every minute) calls the same function. It runs for a supporter only
when all of their helpers are effectively in auto mode (preference, or idle longer than
`inactivityTimeoutSeconds`, default 3600) and eligible yield has reached `autoThresholdMicro`.
Destinations follow the supporter's rule: last selected, default, favourite, or split by basis
points (largest remainder).

## Payouts

- `batch_payouts`: per cause, pending deliveries totalling at least `minPayoutMicro` become one
  `charity_payout`, and the deliveries move to `queued`.
- `submit_payouts`: claims a `created` payout atomically, then calls
  `Vault.distribute_yield(recipient, amount, memo = payoutId)`. On chain, the Vault refuses
  non-allowlisted recipients, amounts that would dip into principal, and reused memos (no double
  pay on retry).
- `confirm_payouts`: reads the transaction outcome. On `true`, it posts the journal and marks the
  deliveries `paid`. On failure, the deliveries are released to `pending` and the payout is retried;
  after 3 attempts it goes to `manual_review` with a critical alert.

## Withdrawals

`requested → pending_protocol_withdrawal → bridging → available_for_offramp → offramp_processing →
completed`, with `failed` and `manual_review` reachable from the non-terminal states. Illegal
transitions throw.

- Requested: principal moves to `principal_withdrawing` and stops earning.
- Vault paid: the amount comes from the Vault's `withdraw` event `paid`. If the pool held less than
  total principal, the payout is pro-rata and the shortfall is booked explicitly.
- Bridge and cash-out fees reduce `received_micro`. They are shown, never hidden.

## Reconciliation (every 10 minutes)

1. Every journal balances.
2. `support_positions` equals the ledger.
3. Unconsumed allocations equal the sum of `user:*:yield_available`.
4. Pending and queued deliveries equal the sum of `cause:*:yield_pending`.
5. Observed pool ≥ booked pool.
6. Live only: the Vault's `total_principal` equals the ledger's principal owed.
7. Nothing is stuck (deposits > 2 h, withdrawals > 48 h, payouts > 1 h in flight).

Failures raise deduplicated alerts that auto-resolve when the check passes again.
