# Hugshire Vault v2: audit, design and migration

Status (2026-11-08): **implemented and tested in a local sandbox. Not audited. Not deployed. Public
deposits stay disabled.** Passing tests is not a security review.

Test status:
- 42 contract unit tests: share math including every worked example, a 3,000-step randomised
  invariant test, authorisation rules, keeper limits, locking, and every callback success and
  failure path.
- 7 NEAR-sandbox integration tests (`near-workspaces`) against a standard NEP-141 token and the
  RHEA mock:
  - deposits at different times
  - donation isolation and records
  - principal-only withdrawals and shared losses
  - failed transfers and a RHEA withdrawal freeze restoring exact state
  - keeper bounded by grants, including revocation and a malicious owner
  - a real function-call session key, limited by both the protocol and the contract
  - private callbacks, unique payout ids, and stray transfers not inflating value
- Every run checks that Σshares, Σprincipal and the vault's token balance reconcile.

Run them with `docker run --rm -v "$PWD/contracts:/work" -w /work rust:1 sh run-tests.sh`.

**Build note:** contracts must be compiled with `--cfg near`, which is what `cargo near build` sets
(`contracts/.cargo/config.toml`). Without it, near-sdk 5.30 silently builds non-chain fallbacks.
The v1 wasm reported earlier was built without it and should not be used.

---

## 1. Audit of v1 (`contracts/vault`, commit `ede4453`)

### What v1 enforces on chain
- Principal is recorded per owner (`principal: LookupMap`). Only the owner can call `withdraw`, and
  the payout goes only to the owner.
- `distribute_yield` requires the operator role, a recipient on the allowlist, a single-use memo, and
  `assets − pending − amount ≥ total_principal`.
- The operator can pause but cannot unpause. Ownership transfer is two-step.

### Trust assumptions in v1

| Actor | Can do without any user's authorisation |
|---|---|
| **Operator (hot key)** | Send *all accrued yield of all users* to *any allowlisted cause*, in any split, at any time. User destination choices exist only in Postgres. |
| **Owner (multisig)** | Add any account to the allowlist (including one they control), then let the operator drain all accrued yield there. Freeze withdrawals **indefinitely** (`set_withdrawals_paused`). Replace the operator. |
| **Backend database** | It is the only place per-user yield, per-user destinations, manual deliveries and auto-delivery rules exist. A compromised backend can attribute or redirect yield arbitrarily, within the operator's power above. |
| **RHEA DAO** (`burrow.sputnik-dao.near`) | Changes RHEA config, pauses deposits or withdrawals, upgrades the contract. This is outside our control in every design. |

### Defects found

1. **Critical: principal can be paid out as "yield" during an in-flight withdrawal.** `withdraw`
   reduces `total_principal` *before* RHEA has released the tokens. A `distribute_yield` priced in
   that window sees `assets − total_principal` inflated by the withdrawing amount and can pay it out.
   If the withdrawal then fails, principal is restored on paper but the tokens are gone, and the
   vault is insolvent.
   - Example: principal 100, assets 100. Alice withdraws 100, so total_principal becomes 0. The
     operator's distribution callback reads assets 100 and pays 100 "yield".
2. **High: stale reads in concurrent withdrawals.** The callback prices with a RHEA balance read that
   can predate another withdrawal that has already completed. During a loss this lets earlier
   withdrawers take more than their pro-rata share (an unfair bank run).
3. **High: no per-user yield on chain.** Fair attribution between users who deposit at different
   times is done off chain. On chain you cannot prove whose yield went where.
4. **Medium: unbounded withdrawal freeze** by the owner.
5. **Medium:** distributions always withdraw from RHEA, even when idle USDC would cover them.
   `used_memos` grows without bound.
6. **Test gap:** the 9 tests cover pure math and access control only. No callback, failure or
   concurrency path is tested, and nothing runs against a contract that behaves like RHEA.

v1 never held funds. **v2 replaces it as a new deployment; there is no state migration.**

---

## 2. RHEA, verified on mainnet (2026-11-08)

| Fact | How it was verified |
|---|---|
| Lending contract `contract.main.burrow.near`, **version 0.16.2**, code hash `6Nek1MZ8cwJJ2xMQAUWup9V5AToYS9rkTxJfwo6BCpFa`, owner `burrow.sputnik-dao.near` | `get_version`, `view_account`, `get_config` |
| Exports `ft_on_transfer`, `execute`, `simple_withdraw`, `get_account`, `get_asset`, `storage_deposit`, `storage_balance_of`, `storage_balance_bounds`, `storage_withdraw`, `after_ft_transfer` | Listed from the **deployed wasm** (`view_code`), not from GitHub |
| USDC `17208628…33a1` (6 decimals): `can_deposit` and `can_withdraw` true, `extra_decimals` 12, supply APR 11.15% today, supply limit 60M | `get_asset`, `ft_metadata` |
| Supply positions are **shares** in a pool: `balance = shares × pool.balance / pool.shares` in 18-decimal inner units. The share price rises as interest accrues (today about 1.157). | `get_asset.supplied` |
| Views accrue interest to the current block (`internal_get_asset` calls `asset.update()` on load), so `get_account` returns a live balance | Source |
| Storage registration is required before depositing: minimum **0.1 NEAR**. An unregistered sender's `ft_on_transfer` panics and the tokens are refunded. | `storage_balance_bounds`, source |
| Supply: `usdc.ft_transfer_call(rhea, amount, msg: "")` credits the **sender's** supplied balance. A third party cannot credit the vault's position. | Source |
| Withdraw: `simple_withdraw(token_id, amount_with_inner_decimal, recipient_id)` with 1 yocto. It debits the position, `ft_transfer`s to the recipient, and `after_ft_transfer` **re-credits the position if the transfer fails**. It resolves to `true` or `false`. | Source; deployed export present |

**Important gap:** the public source on GitHub is **v0.15.7**, but mainnet runs **v0.16.2**. The
deployed behaviour of `simple_withdraw` and `after_ft_transfer` cannot be read from public source.
So:

- (a) the mock in our tests reproduces the v0.15.7 semantics above, and is labelled as such;
- (b) a controlled small-value mainnet test (§8) must confirm the deployed behaviour, including a
  deliberately failing transfer, before any user money;
- (c) ask RHEA for the v0.16.x source.

---

## 3. v2 ownership model: vault shares

Each supporter owns **shares** of the vault. The vault's assets are its RHEA position plus the idle
USDC it tracks.

```
A   = managed assets  = rhea_supplied + idle            (pending deposits excluded)
S   = total shares
VS  = 1,000,000 virtual shares,  VA = 1 virtual µUSDC   (inflation-attack guard)

mint for a deposit x     : shares = floor(x · (S+VS) / (A+VA))
value of s shares        : floor(s · (A+VA) / (S+VS))
shares to burn for x out : ceil (x · (S+VS) / (A+VA))

per user u:
  value_u        = value(shares_u)
  principal_u    = cost basis (sum of deposits, reduced on withdrawal)
  yield_u        = max(0, value_u − principal_u)       ← the only thing that can be donated
  withdrawable_u = min(principal_u, value_u)           ← the only thing the user can withdraw
```

Why this is fair:

- **Different deposit times.** A deposit buys shares at the current price, so a late depositor
  never shares in yield earned before they arrived (Example 1).
- **One user's donation cannot hurt another.** Donating burns the donor's shares *at the current
  price*, so assets and shares fall in proportion and everyone else's value is unchanged
  (Example 2).
- **Partial withdrawals.** In profit, withdrawing `x` reduces principal by exactly `x`, so the yield
  stays committed to charity (Example 3). In a loss, the basis falls pro-rata,
  `x · principal_u / value_u`, so the loss is shared fairly (Example 4).
- **Losses.** `yield_u = 0` whenever `value_u ≤ principal_u`. Nothing can be donated until that
  user's position has recovered (Example 4).
- **Rounding.** Mint and redeem round down; burn rounds up. Dust always stays in the vault, never
  leaves it (Example 5).
- **Fees.** v2 charges no vault fee. RHEA's reserve share is already netted out of its supply rate.
  Bridge and onramp fees happen before the deposit reaches the vault. Any future platform fee must
  be taken explicitly from donated yield, and appear in the event.
- **Inflation attack.** Direct `ft_transfer`s to the vault are **not** counted (`idle` is tracked
  internally), and third parties cannot credit the vault's RHEA position. The virtual offset makes
  the classic attack unprofitable anyway (Example 6).

**Product decision, flagged for legal review:** yield is committed to charity. A supporter can
withdraw up to their principal but cannot withdraw yield. This matches the original brief
("principal remains withdrawable; yield funds causes") and must be stated in the deposit terms the
user signs.

### Worked examples

These come from the exact integer model in `contracts/vault/model/examples.cjs`, which uses the same
formulas as the contract. All values are USDC (6 decimals).

**1. Unequal deposit times.**
- Alice deposits 1,000 and receives 1,000,000,000,000,000 shares.
- The pool earns 10%: A = 1,100.
- Bob deposits 1,000 and receives 909,090,909,173,553 shares, because the price is now higher.
- The pool earns 5%: A = 2,205.
- Alice is worth **1,154.999999** (yield 154.999999). Bob is worth **1,049.999999** (yield 49.999999).
- Σshares = S, and Σvalue = A − 2 µ of rounding dust.

**2. Donation isolation.** Alice donates her 154.999999 of yield to `shelter.near`.
- Her shares fall to 865,800,866,651,423 and her value to 1,000.000000.
- Bob is worth 1,049.999999 **before and after**.

**3. Partial withdrawal in profit.** Bob withdraws 400.
- His principal goes from 1,000 to 600 and his value from 1,049.999999 to 649.999999.
- His yield stays at 49.999999.

**4. A 20% RHEA loss.**
- Alice is worth 800 (principal 1,000) and Bob 520 (principal 600). Both yields are 0.
- Bob's attempt to donate 0.000001 is **refused**.
- Alice withdraws her full 800. Her basis drops to 0 (she bears her 20% loss) and Bob's 520 is
  untouched.

**5. Rounding.** With deposits of 3 µ and 7 µ, burning shares worth 1 µ costs 1,000,000 shares,
which redeem for 1 µ. Nothing leaks out.

**6. Inflation attack.**
- The attacker deposits 1 µ, then pushes 1,000 USDC into the price (this is impossible in the real
  contract, but assumed here).
- The victim deposits 999 and is worth 998.999750 (−0.00025).
- The attacker gave up about 500 USDC to do it.

---

## 4. Authorisation model

| Action | Who | How the contract enforces it |
|---|---|---|
| Deposit | anyone, for themselves (or `owner` in msg) | `ft_on_transfer` from the USDC contract only. It joins a **pending queue**; shares are minted at the next priced batch. |
| Cancel a pending deposit | the depositor | full-access key (**1 yocto** attached) |
| Withdraw principal | the owner only, paid to the owner | full-access key (1 yocto) |
| Set policy (destinations and splits, automatic-delivery grant) | the owner only | full-access key (1 yocto) |
| Donate manually, any approved cause | the owner | full-access key (1 yocto) |
| Donate manually from the game | the owner via a **session key** | function-call access key, which cannot attach a deposit. The contract then restricts the call to causes in the user's own policy, an amount ≤ yield_u, and the policy's daily cap. |
| Automatic delivery | **keeper** role | only users with an unexpired grant. The amount is computed by the contract (eligible yield, capped by `max_per_delivery`, at least `min_amount`), the split comes from the user's policy, and `min_interval` is enforced per user. The keeper never chooses an amount or a recipient. |
| Approve or retire a cause | owner (multisig) | Retired causes receive nothing; their share stays with the user. |
| Pause deposits or donations | owner, or operator (pause only) | |
| Pause withdrawals | owner | **At most 72 hours**, then 24 hours of cooldown before another pause. |
| Supply idle USDC to RHEA, process the deposit queue | keeper | Value-neutral. |

Why it works for a Web2 wallet: with Privy, the user's NEAR key is theirs. Once, at onboarding, the
app asks them to sign two things: their policy, and the addition of a **function-call access key**
(receiver = vault, methods = `["donate"]`) that the browser keeps for the game. NEAR forbids
function-call keys from attaching deposits, which is how the contract tells a session key (limited
mode) apart from the user's full key. Inactivity is observed by the app. On chain the keeper can
only deliver what the user's grant already allows.

What a compromised operator or keeper can still do: deliver a granted user's eligible yield to that
user's own chosen causes **earlier** than they would have, and pause deposits or donations. It
cannot touch principal, change destinations or amounts, or reach users without a grant.

What a compromised owner can do: approve a bad cause (no user's policy points at it unless the user
adds it), pause withdrawals for at most 72 hours at a time, and replace the keeper. It cannot move
user funds.

---

## 5. Concurrency and asynchronous safety

Every operation that depends on the price (process deposits, withdraw, donate, auto-deliver,
supply) takes a **vault lock** before reading RHEA and releases it in the final callback, on every
path:

- Prices are never computed from a stale read. This fixes v1 defects 1 and 2.
- Shares and principal are debited in the pricing callback, *before* tokens move, so nothing can be
  spent twice.
- If RHEA's `simple_withdraw` or the outgoing `ft_transfer` fails, the exact shares and principal
  are restored. The lock guarantees the price has not moved in between.
- A donation is recorded as completed (per-user and per-cause totals, `donation` event) **only in
  the success callback**. Payout ids come from a contract counter and are unique; each payout moves
  `pending → completed | failed` exactly once.
- Calls made while the vault is locked fail fast ("vault busy, retry"). Deposits never wait: they
  queue. A lock older than 1 hour can be cleared by anyone. That only happens if a callback ran out
  of gas, which the fixed gas budgets are sized to prevent; the stuck payout is flagged for review.

Residual risk: anyone holding shares can call `withdraw`/`donate` to briefly lock the vault, which
is a griefing vector. It is rate-limited to one locking call per user per minute.

---

## 6. Invariants (checked in tests)

1. `Σ shares_u == S`
2. `Σ principal_u == total_principal`
3. `Σ value_u ≤ A` (the difference is rounding dust, owned by no one)
4. For every donation: `amount ≤ yield_u` at execution, and price-per-share is non-decreasing across
   the donation (rounding favours the vault)
5. Price-per-share never falls because of deposit, withdraw or donate; only RHEA losses lower it
6. `Σ donated_by_cause == Σ donated_by_user == total_donated == Σ completed payouts`
7. When unlocked: `rhea_supplied + idle + pending_deposits == the vault's real token position`
   (reconciled off chain against RHEA and the USDC contract)
8. A payout id is never reused; a failed payout restores exactly the shares it burned

---

## 7. Migration plan

1. **Contract v2** (this change): shares, policy, session-key mode, keeper grants, lock, payouts
   ledger, events, time-boxed pause. Unit tests for the math and every authorisation rule.
2. **Mocks and integration tests:** a mock USDC (NEP-141 with storage, `ft_transfer_call` and
   resolve) and a mock RHEA that follows the v0.15.7 semantics above (pooled shares with 18-decimal
   inner units, storage requirement, `simple_withdraw` → `after_ft_transfer` restore, interest and
   loss controls, a forced-failure switch). Tests run in a NEAR sandbox via `near-workspaces`.
3. **App:** in live mode the ledger becomes a **mirror** of the chain. Deposits, shares, yield and
   donations are read from views and events. Game deliveries call `donate` with the session key. The
   worker's keeper calls `auto_deliver` for users the app sees as idle. Sandbox mode keeps its
   simulation.
4. **Before any user funds:** an independent audit; the §8 mainnet test; legal review of "yield is
   committed to charity"; deposits enabled with a TVL cap.

## 8. Controlled mainnet test (owner funds only, about 10 USDC)

Deploy v2 to a fresh account with deposits restricted to an allowlist containing only the team.
Then:

1. Deposit 5 USDC, process the batch, and supply.
2. Wait for interest and check the share price.
3. Donate 0.01 to a team-owned approved cause.
4. Withdraw 1.
5. Force a failure by withdrawing to an account with no USDC storage. Confirm RHEA re-credits the
   position and the vault restores the shares.
6. Withdraw everything.

Compare every view with the RHEA position after each step.
