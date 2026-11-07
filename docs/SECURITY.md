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

## On-chain invariants (contracts/vault)

- `distribute_yield` requires: operator caller, not paused, an allowlisted recipient, a fresh memo,
  and `assets − pending − amount ≥ total_principal`, checked against a fresh RHEA `get_account`
  read in the callback. `pending_distribution` prevents two concurrent distributions from both
  passing the check.
- `withdraw` debits principal before the async calls and restores it if any step fails. It pays
  `min(1, available / total_principal)` pro-rata.
- Only the configured USDC contract can call `ft_on_transfer`.
- Cross-contract results are read with `promise_result_checked` (64 KB cap) so an oversized response
  cannot exhaust gas.
- **Known contract risks to review in audit:** RHEA `simple_withdraw` semantics when the recipient
  lacks storage; behaviour if RHEA changes `extra_decimals`; rounding on `amount × 1e12`; gas limits
  of the callback chains; the storage cost of `used_memos` growing forever; the absence of an upgrade
  path (intentional; redeploying means migrating).

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
