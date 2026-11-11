# Hugshire security model

**Status: not ready for public real-money use.** The design limits damage, but the Vault contract
has not been audited, and several operational controls listed below are still TODO. Use live mode
only for the owner-funded small-amount test plan until the production checklist is complete.

## Custody

| Asset | Who controls it |
|---|---|
| USDC on Base after Coinbase checkout | the user (Privy embedded EVM wallet) |
| USDC on NEAR after the bridge | the user (Privy NEAR implicit account) |
| USDC inside the Vault / RHEA | the Vault contract. Principal is recorded per owner and withdrawable only by that owner, to that owner |
| Yield above total principal | the Vault. The operator can send it only to allowlisted recipients |
| Organisation receiving accounts | the organisation |

Hugshire's servers never hold user private keys. Privy keys are user-controlled; Privy's own model
applies (https://docs.privy.io/security).

## Keys and roles

- **Vault owner** (allowlist, operator, unpause, emergency withdrawal pause, ownership transfer):
  must be a multisig or hardware-held account. It is never on a server. Ownership transfer is
  two-step (`propose_owner` / `accept_owner`).
- **Operator** (hot key on the worker): a function-call access key. On the Vault it can only call
  `supply`, `distribute_yield` and `set_paused(true)`. If compromised, the attacker can at worst send
  already-accrued yield to already-approved causes, or pause. They cannot touch principal, add
  recipients, or unpause.
- **Session secret, CDP secret, 1Click key, Privy key, R2 keys:** host secret store only, never in
  the repository (`.gitignore` excludes `.env*`). Rotate on staff changes.

## On-chain invariants (contracts/vault, v2)

The full design, worked examples and v1 audit are in [VAULT_V2.md](VAULT_V2.md).

- **Shares, not pooled principal.** Each supporter's yield is `value(shares) − principal` on chain.
  Donating burns the donor's shares at the current price, so no supporter's donation can reduce
  another's value. Mint and redeem round down, burn rounds up, and a virtual-share offset blocks the
  inflation attack.
- **Principal only to its owner.** `withdraw` requires the supporter's full-access key (1 yocto) and
  pays only that supporter, up to `min(principal, value)`.
- **Yield only where the supporter said.**
  - Full-key `donate` may go to any approved cause.
  - A session key (function-call key, which cannot attach a deposit) may only donate to causes in the
    supporter's own policy, within its daily cap.
  - The keeper's `auto_deliver` works only for supporters with an unexpired grant. The contract
    computes the amount (eligible yield, capped) and the split (the supporter's policy), and enforces
    a minimum interval.
- **Atomic pricing.** A vault lock spans each RHEA balance read and its final callback, so prices
  never come from stale reads. Shares are debited before tokens move and restored exactly on any
  failure. Donations are recorded only after the transfer succeeds. Payout ids are contract-generated
  and move `Pending → Completed | Partial | Failed | Stale` once.
- **Owner limits.** The owner cannot move funds. The withdrawal pause lasts at most 72 hours, with a
  24-hour cooldown. Deposits start closed (allowlist only).
- Only the configured USDC contract can call `ft_on_transfer`; stray transfers are not counted. Cross-contract results
  are read with `promise_result_checked` (64 KB cap). Locked operations require ≥ 290 TGas so they always reach their
  final callback.
- **Open items for the audit:**
  - deployed RHEA v0.16.2 behaviour, since its source is not public;
  - the gas budget of the multi-cause payout chain;
  - the griefing lock: holders can briefly block others (rate-limited to once a minute per user);
  - stale-lock handling;
  - storage paid by the vault for new members;
  - no upgrade path (intentional).

## Application controls

| Control | Where |
|---|---|
| Environment separation | `HUGSHIRE_MODE`; live refuses to boot without credentials, refuses dev auth and PGlite; every financial row carries `environment` |
| Role-based access | `users.role` (admin), `organization_members.role` (owner/editor); checked in `route()` and in services |
| CSRF | mutating requests must come from `APP_URL`'s origin; session cookie `SameSite=Lax`, `HttpOnly`, `Secure` on HTTPS |
| Sessions | random 256-bit tokens, stored only as SHA-256, 14-day expiry, deleted on logout |
| Dev sign-in | 6-digit codes hashed at rest, 10-minute expiry, 5 attempts, single use; disabled in live |
| Validation | zod on every route body; amounts parsed as strings into bigint |
| Idempotency | unique keys on deposits, deliveries and withdrawals per user; unique journals; unique webhook event ids; unique payout batch keys; single-use Vault memos |
| Webhooks | HMAC-SHA256 `X-Webhook-Signature`, timing-safe compare, 5-minute replay window, raw body, store-once |
| Rate limiting | in-process token bucket per route+IP (plus Cloudflare WAF in production) |
| Uploads | magic-byte sniffing (PNG/JPEG/WebP only, so no SVG), 2 MB, random names, no user-controlled paths |
| Audit | `audit_logs` for every money and admin action; `admin_actions` with reasons |
| Pause | admin pauses for deposits, withdrawals, payouts and auto-delivery; on-chain Vault pause |
| Headers | HSTS, nosniff, frame-deny, referrer policy, permissions policy |
| Privacy | other supporters see only helper animal and nickname; organisations never see supporter identities |

## TODO before public launch

- Independent audit of `contracts/vault`, plus a review of the RHEA integration assumptions.
- Content-Security-Policy header (PixiJS needs `blob:` workers, so it must be tuned and tested).
- Shared rate limiter (Redis or Postgres) if running more than one web instance.
- Alert fan-out to Slack/Discord/email (`ALERT_WEBHOOK_URL`) and on-call.
- Operator key in a KMS or HSM-backed signer instead of an env var.
- Wallet-screening (sanctions) for receiving accounts; KYB records for organisations.
- Bug bounty and an incident response runbook.

## V4: three separate accounting domains

1. **Personal vault** (deposits, shares, principal, yield, deliveries, withdrawals). Unchanged.
2. **Community Heart Pool:**
   - It has its own `pool:*` ledger namespace and its own tables and treasury.
   - It is funded only by finalized, received ad revenue × the published share.
   - Simulated revenue is refused in live mode.
   - Cycle steps are a strict state machine and every step is audited.
   - Payouts are `unique(cycle, cause)` and booked once, then reconciled.
   - The treasury is a Sputnik DAO with multi-party approval. Hugshire's key can only *propose*.
   - The sandbox stand-in is labelled "not decentralized".
3. **Virtual construction** (Wood and Stone):
   - There are no money accounts. The only input is the verified ledger principal, used for scaling.
   - The server owns sessions, the resource choice, the secret chart, judging, hearts, combo, caps,
     cooldowns and the single commit.
   - Client-sent scores or rewards are ignored.
   - One open session per user. Rounds can't be submitted faster than real time, and replays are
     refused by an optimistic lock.

**Auto-delivery:** it moves money, so it needs a recorded authorisation (`auto_authorized_at`).
Authorising and revoking are both audited. Inactivity alone (7-day fallback) never authorises
anything.

**Notice Board:** links must be https and are opened with `noopener noreferrer nofollow`. Posts can
be reported and hidden by admins, with an audit log.
