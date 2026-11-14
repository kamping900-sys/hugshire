# Hugshire architecture

Last verified against official sources: 2026-11-07. Sources are listed in
[SETUP_GUIDE.md](SETUP_GUIDE.md#sources-verified). Re-check them before going live.

> **Current state (November 2026):** the Vault and the deposit → lending → donation → withdrawal flow
> run on **NEAR testnet** with test USDC and a RHEA-compatible lending contract
> ([ONCHAIN_TESTNET.md](ONCHAIN_TESTNET.md)). The mainnet route below is integrated and awaits launch.
> The full current design is in [HUGSHIRE_SYSTEM.md](HUGSHIRE_SYSTEM.md).

## 1. Decision in one paragraph

Hugshire is one Next.js app (UI plus API routes) with one background worker, one
PostgreSQL database and one small NEAR smart contract (the **Hugshire Vault**).
Users sign in with email or Google through **Privy**, which gives each user their
own embedded wallets: an EVM wallet on Base and a NEAR implicit account. Money
enters through **Coinbase Onramp** as USDC on Base in the user's own wallet,
crosses to NEAR through **NEAR Intents 1Click**, and is deposited by the user into
the Vault. The Vault supplies USDC to **RHEA Lending** (`contract.main.burrow.near`).
The Vault enforces on chain that principal can only return to the depositor, and
that the operator can only send *yield* (vault value above total principal) to
admin-approved cause accounts. The database keeps a double-entry ledger that
attributes yield to each supporter, and gameplay only decides *when* and
*to which approved cause* a supporter's already-earned yield is sent.

## 2. Verified live route

| Step | Provider | What was verified (2026-11-07) |
|---|---|---|
| Card / Apple Pay to USDC on Base | Coinbase Onramp | `POST https://api.developer.coinbase.com/onramp/v1/token` (Secret API key, single-use token, 5 min); hosted URL `https://pay.coinbase.com/buy/select-asset?sessionToken=…`. Webhooks `onramp.transaction.*`, header `X-Webhook-Signature`, HMAC-SHA256. NEAR is **not** a listed Coinbase network, so Base is the landing chain. Guest checkout in the hosted widget was scheduled for deprecation on 2026-06-30, so users may need a Coinbase account. |
| Base USDC to NEAR USDC | NEAR Intents 1Click | `https://1click.chaindefuser.com/v0/tokens` lists `nep141:base-0x8335…2913.omft.near` and `nep141:17208628…33a1` (both 6 decimals). `POST /v0/quote`, `GET /v0/status`; statuses `PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, SUCCESS, INCOMPLETE_DEPOSIT, REFUNDED, FAILED`. No API key means an extra 0.25% fee; with a key, stablecoin pairs cost 0.01%. |
| Supply and withdraw | RHEA Lending | Live `get_asset` on USDC: `supply_apr ≈ 0.0897`, `can_deposit` and `can_withdraw` both true, `extra_decimals = 12`. Source ([ref-finance/burrowland](https://github.com/ref-finance/burrowland)): supply = `ft_transfer_call(contract.main.burrow.near, amount, msg: "")`; withdraw = `execute({actions:[{Withdraw:{token_id, max_amount}}]})` with 1 yoctoNEAR, and no oracle is needed for supply-only accounts. Storage minimum is 0.1 NEAR. |
| Back to the bank | NEAR to Base via 1Click, then Coinbase Offramp | Offramp URL `https://pay.coinbase.com/v3/sell/input?sessionToken=…&partnerUserRef=…&redirectUrl=…`. The user sends USDC from their own Base wallet to the Coinbase `to_address` returned by Offramp transaction status. The transaction times out after 30 minutes. |
| Identity and wallets | Privy | Email OTP and Google OAuth. NEAR is a Tier-2 chain (Privy raw-signs; the app builds and broadcasts). Coinbase CDP embedded wallets do **not** support NEAR, which is why Privy was chosen. |

## 3. Why this custody model

Three options were considered:

1. **Hugshire holds everyone's money in an operator account.** This is the simplest
   option, and it makes Hugshire a custodian and very likely a money transmitter.
   One leaked key loses everything. **Rejected.**
2. **Every user supplies to RHEA from their own NEAR account.** This is fully
   non-custodial, but every yield delivery would need the user's signature, or a
   delegated key that could also withdraw principal. Auto mode would then be
   either impossible or unsafe. **Rejected.**
3. **A small pooled Vault contract with on-chain limits (chosen).** Users deposit
   from their own wallet, and the Vault records principal per owner account.
   - `withdraw` can only be called by the owner and only pays the owner.
   - `distribute_yield` can only be called by the operator role. It only pays
     accounts on the admin allowlist, and only up to
     `total_assets - total_principal`.
   - The owner role (multisig in production) is separate from the operator role (a
     hot key), and pause is available.

   A compromised operator key can, at worst, send *already-accrued yield* to an
   *already-approved cause*. It cannot touch principal.

   What remains is **contract risk** (it needs an audit), **RHEA protocol risk** and
   **legal review**. See [SECURITY.md](SECURITY.md) and
   [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md).

Per-user yield attribution lives off chain, because a time-weighted pro-rata split
across thousands of users is cheap in SQL and expensive on chain. The chain enforces
the aggregate invariant (yield paid out ≤ yield earned, principal untouchable). The
ledger enforces the per-user split, and reconciliation compares the two every run.

## 4. System layout

```
Browser
  ├─ Next.js pages (React, Tailwind)        - marketing, portfolio, portals
  ├─ PixiJS scenes (src/game)               - world map, city, helpers (presentation only)
  └─ Privy SDK (live mode)                  - login, user-signed Base + NEAR transactions
Next.js server (src/app/api, src/server)
  ├─ auth / rbac / rate limit / validation (zod)
  ├─ services: causes, helpers, deposits, deliveries, withdrawals, payouts, admin
  ├─ ledger (double-entry, bigint micro-USDC)
  └─ providers: onramp | bridge | lending | payout | wallet   (sandbox | live)
Worker (src/worker)                          - Postgres job queue (SKIP LOCKED)
  ├─ poll provider status (onramp, 1Click, vault)
  ├─ yield snapshot + time-weighted allocation
  ├─ auto-delivery for inactive players
  ├─ payout batching
  └─ reconciliation + alerts
PostgreSQL                                   - all authoritative records
NEAR mainnet
  ├─ hugshire-vault (contracts/vault)        - principal per owner, yield-only distribution
  └─ contract.main.burrow.near (RHEA)        - lending
```

There is no Redis. The job queue is a Postgres table that workers claim with
`FOR UPDATE SKIP LOCKED`, which means one fewer service for a solo operator. The
rate limiter is in-process, which is enough for one web instance. See
KNOWN_LIMITATIONS before scaling out.

## 5. Modes

`HUGSHIRE_MODE=sandbox` (the default) runs every provider as a **labelled test
provider**. No money moves, every record is stamped `environment = 'sandbox'`, and
the UI shows a permanent "Test mode" banner. Sandbox yield uses the **live RHEA
USDC supply APR** read from mainnet, applied to test principal. It is labelled as
a simulation.

`HUGSHIRE_MODE=live` runs the real providers. On boot, live mode refuses to start
unless the required credentials are present. It also refuses dev sign-in, and it
never reads or writes sandbox records.

## 6. Game and finance separation

| Financial truth (server, ledger, chain) | Presentation (client, PixiJS) |
|---|---|
| deposits, principal, withdrawals | helper walking, chopping Wood |
| yield snapshots and allocations | "heart parcels" in the reward pool |
| eligible yield, deliveries, payouts | carrying a parcel to a cause sign |
| fees, failures, reversals | buildings rising through construction stages |

- The client never sends an amount. A delivery request carries only `causeId`,
  `helperId` and an idempotency key. The server takes the supporter's eligible
  yield, locks it to the cause, and records `delivery_allocations` rows that point
  at specific `yield_allocations`.
- The number of parcels on screen is derived from the server's eligible amount,
  using `PARCEL_SIZE_MICRO` per parcel. Collecting parcels changes nothing on the
  server.
- Auto mode is decided by the server from `last_player_action_at` and the user's
  timeout (default 3600 s). The worker performs auto-delivery using the same
  service and validation as a manual delivery.
- City stage comes from the cause's real delivered-yield total against its goal.
  The page states that this is symbolic unless the organisation has posted a
  verified real-world update.

## 7. Money representation

All amounts are `bigint` micro-USDC (6 decimals, the native USDC unit on both Base
and NEAR) stored in `numeric(38,0)` columns. RHEA's internal balances use 18
decimals (6 + `extra_decimals` 12) and are converted at the provider edge only.
Floats are never used for money. APR is kept as a decimal string, and interest
maths uses scaled bigint (1e18 fixed point). Allocation splits use the
largest-remainder method, so the parts always add up exactly to the total.

## 8. Data model (main tables)

45 tables, grouped by area in [HUGSHIRE_SYSTEM.md §10](HUGSHIRE_SYSTEM.md#10-data-model-45-tables): accounts,
organisations and causes, helpers, deposits and providers, yield and delivery, ledger and operations,
construction, Community Pool, and the onchain mirror (`chain_txs`).

See `src/server/db/schema.ts`.

## 9. Ledger accounts

| Account | Meaning |
|---|---|
| `external:onramp` | money arriving from outside |
| `user:{id}:principal` | earning principal (credit-normal) |
| `user:{id}:principal_withdrawing` | principal mid-withdrawal (not earning) |
| `user:{id}:yield_available` | yield earned, not yet assigned |
| `cause:{id}:yield_pending` | yield assigned to a cause, awaiting payout |
| `cause:{id}:yield_paid` | yield paid on chain |
| `pool:lending` | asset side: what sits in the Vault/RHEA |
| `pool:yield_income` | income side of accrual |
| `fees:{provider}` | provider fees borne by the user |
| `external:withdrawn` | money returned to the user |

Every journal sums to zero, which is enforced in code and tested.

## V4 additions (2026-11-11)

**Two-level world.**
- Level 1, the overworld (`/worldmap`): one tile per town.
- Level 2, a detailed shared town (`/worldmap/town/[slug]`), rendered by `src/game/v4/TownGame.ts`.

**Mini-games.** Standalone Pixi scenes in `src/game/v4/scenes.ts`, judged on the server by `src/server/services/game.ts`. Charts and judges in `src/game/v4/rules.ts` are shared between client and server.

**Three separate economies:**
- Personal vault (unchanged).
- Community Heart Pool: `services/pool.ts`, with a Sputnik DAO or sandbox treasury in `providers/treasury.ts`.
- Virtual construction: Wood and Stone, with no money accounts.

The full map, rules and constants are in **V4_GAMEPLAY_ECONOMY.md**.

**Running more than one Pixi application.** A page can host several at once, for example a town with a mini-game on top. They must be destroyed with `app.destroy({ removeView: true }, ...)`, never `destroy(true)`, because `true` releases Pixi global resources and breaks the other live applications.
