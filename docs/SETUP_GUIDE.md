# Hugshire setup guide

This guide goes from a fresh checkout to a live deployment that moves real money. Do the steps in
order. Run `npm run verify:live` after each one: it is read-only and tells you what is still
missing.

> **Before any real money:** read [SECURITY.md](SECURITY.md) and
> [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md). The Vault contract is **not audited**, and
> taking deposits from the public needs legal review. Live mode exists so you can run the
> small-amount test plan in [REAL_MONEY_TEST_PLAN.md](REAL_MONEY_TEST_PLAN.md) with your own money.

---

## 0. Run locally (sandbox, about 2 minutes)

Requirements: Node 22+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:3200. Sign in with any email; the 6-digit code appears on the page and in the
server log. Sign in as `admin@hugshire.test` to see `/admin`.

- `DATABASE_URL=pglite:.data/hugshire` is an embedded Postgres. Only one process can open it, so
  stop `npm run dev` before running `npm run db:seed` or `npm run worker`.
- To use a real local Postgres instead, run `docker compose up -d` and set
  `DATABASE_URL=postgres://hugshire:hugshire_local_only@localhost:5433/hugshire`.
- In sandbox mode the job scheduler runs inside `npm run dev`. Set `HUGSHIRE_INPROCESS_WORKER=0` to
  run `npm run worker` separately instead.

Tests:

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run contract:test
```

`test:e2e` needs `npm run dev` running. On Windows, `contract:test` needs a working Rust
toolchain; the Docker command in §5 always works.

---

## 1. Database (managed PostgreSQL)

Pick one: **Railway Postgres** (simplest if you host on Railway), **Neon**, or **Supabase**. Use
Postgres 15 or newer.

1. Create two separate databases: `hugshire_staging` (sandbox) and `hugshire_live`. Never point a
   sandbox deployment at the live database.
2. Set `DATABASE_URL` to the connection string, with `?sslmode=require` if your provider needs it.
3. Migrations run automatically on boot. To run them by hand, use `npm run db:migrate`.
4. Turn on daily backups with point-in-time recovery. The ledger is the record of who owns what.

## 2. Hosting

Recommended for a solo operator: **Railway** for the app, the worker and Postgres in one project,
with **Cloudflare** in front.

1. Create a Railway project from the repository, with two services from the same repo:
   - **web**: build `npm ci && npm run build`, start `npm start`, health check `/api/health`.
   - **worker**: start `npm run worker`. Exactly one replica is enough; more are safe because jobs
     are claimed per time bucket.
2. Put the same env vars on both services (see §8). On the web service, set
   `HUGSHIRE_INPROCESS_WORKER=0`.
3. Domain: add `hugshire.yourdomain` in Railway, then a CNAME in Cloudflare with the proxy on. Turn on
   "Always use HTTPS", and add a WAF rate-limit rule on `/api/*` (for example 300 requests/min per IP).
4. Set `APP_URL=https://hugshire.yourdomain`. It is used for CSRF origin checks and Coinbase
   redirect URLs.

Image uploads: create a **Cloudflare R2** bucket with a public custom domain (for example
`img.hugshire.yourdomain`), then set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`
(`https://<account>.r2.cloudflarestorage.com`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` and `S3_PUBLIC_BASE_URL`.

## 3. Privy (sign-in and user wallets)

Privy gives each user email or Google sign-in plus wallets they control: EVM for Base and a NEAR
implicit account. It was chosen because Coinbase CDP embedded wallets do not support NEAR (checked
2026-11-07).

1. Create an app at https://dashboard.privy.io. Enable login methods **Email** and **Google**.
2. Under Embedded wallets, enable **Ethereum** (create on login) and enable **NEAR** (a Tier-2 chain:
   Privy signs, the app broadcasts).
3. Copy the **App ID** into `PRIVY_APP_ID`. Copy the **Verification key** (ES256 public key, PEM)
   into `PRIVY_VERIFICATION_KEY` with newlines escaped as `\n`. Add an **App secret** too; the next
   step needs it as `PRIVY_APP_SECRET`.
4. Add your domain to the allowed origins.
5. Set `AUTH_PROVIDER=privy`.

**Still to build (blocked on your Privy app):** the client half.

- Install `@privy-io/react-auth`. It currently conflicts with an optional peer of
  `@coinbase/cdp-sdk` (`ox`), so install with `--legacy-peer-deps` or pin `ox`.
- Wrap the app in `PrivyProvider`, and on login POST `{accessToken, identityToken}` to
  `/api/auth/privy` (already implemented and verified server-side).
- Implement `PrivyWallets.getUserWallets` in `src/server/providers/live.ts` with Privy's REST user
  lookup.
- Add the three signing prompts that call `/api/live`: send Base USDC to the 1Click deposit address,
  `ft_transfer_call` USDC into the Vault, and `vault.withdraw`.

Every server endpoint for these steps already exists and verifies on chain. See
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

Gas for user NEAR transactions: new implicit accounts hold 0 NEAR. Before shipping, choose one:

- (a) the operator sends about 0.05 NEAR to each user's implicit account when it is created, plus a
  USDC `storage_deposit`; or
- (b) run a NEP-366 meta-transaction relayer.

(a) is simpler.

## 4. Coinbase Onramp and Offramp

1. Create a project at https://portal.cdp.coinbase.com.
2. **API keys → Create Secret API key.** Put the key name/ID in `CDP_API_KEY_ID` and the private key
   in `CDP_API_KEY_SECRET`. Client keys do not work for these APIs.
3. **Payments → Onramp & Offramp:** add your domain to the **domain allowlist**. Redirects to
   unlisted domains are silently ignored.
4. You start in **trial mode**. Apply for full access at https://support.cdp.coinbase.com/onramp-onboarding.
   Expect a KYB review: company details, use case, and expected volume. Describe the flow honestly:
   USDC to the user's own self-custodial wallet on Base.
5. Webhooks: create a subscription for `onramp.transaction.*` and `offramp.transaction.*` pointing at
   `https://hugshire.yourdomain/api/webhooks/coinbase`. Use the CDP CLI or portal. Copy the returned
   `secret` into `CDP_WEBHOOK_SECRET`. Signatures are verified as HMAC-SHA256 over `${t}.${body}`
   with a 5-minute window.
6. Run `npm run verify:live`. It should report "Onramp session token created".

Notes verified on 2026-11-07:

- NEAR is not a Coinbase network, so USDC lands on **Base**.
- The Coinbase-hosted **guest checkout** (card or Apple Pay without a Coinbase account) was scheduled
  for deprecation on 2026-06-30. Check its current status. Users may need a Coinbase account, or you
  may need the Headless Onramp API (US users with a real US phone; it needs separate enablement).
- The URL parameters `defaultNetwork`, `defaultAsset`, `presetFiatAmount` and `fiatCurrency` are
  sent but were not confirmed in the docs that were read. Confirm them on the "Generating an Onramp
  URL" page.
- Weekly card limit: about $2,500. `maxDepositMicro` defaults to that.

## 5. NEAR: accounts, Vault deploy, RHEA registration

You need three NEAR mainnet accounts:

| Account | Role | Key handling |
|---|---|---|
| `hugshire-owner.near` | Vault owner: allowlist, operator, pause, unpause | **Multisig** (for example a NEAR multisig contract or a hardware-wallet-held account); never on a server |
| `hugshire-vault.near` | the Vault contract | full-access key deleted after deploy (or kept offline) |
| `hugshire-operator.near` | worker hot key: `supply`, `distribute_yield`, `set_paused(true)` | function-call access key limited to the Vault; in your host's secret store |

Build and test the contract. Docker works everywhere:

```bash
docker run --rm -v "$PWD/contracts/vault:/work" -w /work rust:1 sh -c "cargo test"
```

```bash
docker run --rm -v "$PWD/contracts/vault:/work" -w /work rust:1 sh -c "rustup target add wasm32-unknown-unknown && RUSTFLAGS='-C link-arg=-s -C target-cpu=mvp' cargo build --target wasm32-unknown-unknown --release"
```

For production, prefer a reproducible build with `cargo near build` (https://github.com/near/cargo-near).

Deploy and initialise (with near-cli-rs):

```bash
near contract deploy hugshire-vault.near use-file target/wasm32-unknown-unknown/release/hugshire_vault.wasm with-init-call new json-args '{"owner_id":"hugshire-owner.near","operator_id":"hugshire-operator.near","usdc":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","rhea":"contract.main.burrow.near"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
```

Register the Vault with USDC and RHEA (storage). RHEA's minimum is 0.1 NEAR:

```bash
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 storage_deposit json-args '{"account_id":"hugshire-vault.near"}' prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as hugshire-owner.near network-config mainnet sign-with-keychain send
```

```bash
near contract call-function as-transaction contract.main.burrow.near storage_deposit json-args '{"account_id":"hugshire-vault.near"}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as hugshire-owner.near network-config mainnet sign-with-keychain send
```

Give the operator a **function-call-only** key on its own account. Then set
`NEAR_VAULT_CONTRACT`, `NEAR_OPERATOR_ACCOUNT` and `NEAR_OPERATOR_PRIVATE_KEY` (`ed25519:...`).

Allowlisting a cause's receiving account is an **owner** action. Do it only after verifying the
organisation out of band, then click "Verify receiving account" in `/admin/organizations`:

```bash
near contract call-function as-transaction hugshire-vault.near add_recipient json-args '{"account_id":"theorg.near"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as hugshire-owner.near network-config mainnet sign-with-keychain send
```

The receiving account must also have a USDC `storage_deposit`. If it doesn't, RHEA's transfer
fails and the payout is retried and then flagged.

## 6. NEAR Intents 1Click

1. Apply for a partner key at https://partners.near-intents.org and put it in `ONECLICK_API_KEY`.
   Without a key, every quote carries an extra 0.25% fee. With a key, USDC↔USDC costs 0.01%.
2. Nothing else is needed: the base URL is public. `verify:live` makes a dry Base→NEAR quote. On
   2026-11-07, 10 USDC quoted 9.998 USDC in about 35 seconds.

## 7. RHEA

Nothing to sign up for. Hugshire reads `get_asset` and `get_account` and the Vault calls
`ft_transfer_call` and `simple_withdraw`. Watch RHEA's announcements and incident page
(https://guide.rhea.finance) and subscribe to their channels. If RHEA pauses USDC
(`can_withdraw: false`), pause Hugshire withdrawals and payouts in `/admin/health`.

## 8. Environment variables

See `.env.example` for every variable with a comment. For live mode, all of these are required, and
the app refuses to start without them:

`HUGSHIRE_MODE=live`, `APP_URL`, `DATABASE_URL` (Postgres), `SESSION_SECRET` (64 random hex),
`AUTH_PROVIDER=privy`, `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY`, `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`, `CDP_WEBHOOK_SECRET`, `ONECLICK_API_KEY`, `NEAR_VAULT_CONTRACT`,
`NEAR_OPERATOR_ACCOUNT`, `NEAR_OPERATOR_PRIVATE_KEY`, `WORKER_SECRET`.

Use a paid RPC for `NEAR_RPC_URL` in production (for example FastNEAR or Lava). The public endpoint
is rate-limited.

## 9. Monitoring

- **Uptime:** point Better Stack or UptimeRobot at `/api/health` (returns 503 if the database is
  unreachable).
- **Errors:** add Sentry (`@sentry/nextjs`) to both services.
- **Alerts:** critical reconciliation failures and payouts in manual review appear in `/admin` and
  in `system_alerts`. Set `ALERT_WEBHOOK_URL` to a Slack or Discord webhook and wire `raiseAlert` to
  post to it. This is a short TODO noted in KNOWN_LIMITATIONS.
- **Daily:** look at `/admin/health` (jobs, configuration) and `/admin` (open alerts).

## Sources verified

- Coinbase Onramp/Offramp: docs.cdp.coinbase.com/onramp (quickstart, offramp guide, headless
  overview, webhooks/onramp, webhooks/verify-signatures, security requirements)
- Coinbase wallets: docs.cdp.coinbase.com/wallets/non-custodial-wallets/overview (EVM and Solana only)
- NEAR Intents 1Click: docs.near-intents.org/integration/distribution-channels/1click-api, the
  OpenAPI at 1click.chaindefuser.com/docs/v0/openapi.yaml, and the fees page
- RHEA: guide.rhea.finance/developers/contracts, the source at github.com/ref-finance/burrowland
  (`fungible_token.rs`, `actions.rs`, `storage.rs`), and live `get_asset` on mainnet
- Privy: docs.privy.io/wallets/overview/chains (NEAR Tier 2), the login methods for email and OAuth
