# Hugshire to-do

Details for each step are in `docs/SETUP_GUIDE.md`. After each setup step, run `npm run verify:live` to see what is still missing.

## Accounts and keys
- [ ] Create a Privy app: turn on Email and Google login, plus Ethereum and NEAR embedded wallets. Copy the App ID, verification key and app secret.
- [ ] Create a Coinbase Developer Platform project with a Secret API key, and add your domain to the Onramp allowlist.
- [ ] Apply for Coinbase Onramp production access (KYB) and ask about Offramp.
- [ ] Find out whether Coinbase guest checkout still exists. It was scheduled to end on 2026-06-30.
- [ ] Create a Coinbase webhook subscription for `onramp.*` and `offramp.*` events, and copy its secret.
- [ ] Apply for a NEAR Intents partner key at partners.near-intents.org.
- [ ] Choose a paid NEAR RPC provider (for example FastNEAR or Lava).

## NEAR and the Vault
- [ ] Create a multisig owner account, a Vault account and an operator account on NEAR mainnet.
- [ ] Get an independent audit of `contracts/vault`, and fix what it finds.
- [ ] Do a reproducible build (`cargo near build`), deploy, and record the code hash.
- [ ] Pay the Vault's storage deposits to USDC (0.00125 NEAR) and RHEA (0.1 NEAR).
- [ ] Give the operator a function-call-only key restricted to the Vault.
- [ ] Decide on an on-chain cap on total deposits.

## Code still to build
- [ ] Privy client: login UI, wallet lookup (`PrivyWallets.getUserWallets`) and the three signing prompts. Resolve the `ox` dependency conflict first.
- [ ] NEAR gas for users: either fund each new account with a little NEAR or run a meta-transaction relayer.
- [ ] A job that calls the Vault's `supply` for idle USDC.
- [ ] The withdrawal leg that bridges NEAR back to Base, plus the Offramp webhook that marks withdrawals completed.
- [ ] Send alerts to Slack, Discord or email (`ALERT_WEBHOOK_URL`).
- [ ] Add a Content-Security-Policy header and test it with PixiJS.
- [ ] Use a shared rate limiter if more than one web instance will run.
- [ ] Move the operator key into a KMS.
- [ ] Add Sentry error tracking to the web app and the worker.
- [ ] Replace the placeholder animal art with the final mascot assets.

## Hosting
- [ ] Create separate staging and live Postgres databases, with backups and point-in-time recovery.
- [ ] Deploy on Railway as two services (web and worker), with Cloudflare DNS and WAF in front.
- [ ] Set up a Cloudflare R2 bucket for uploads.
- [ ] Set every live environment variable listed in `.env.example`.
- [ ] Add uptime monitoring on `/api/health`.

## Legal and compliance
- [ ] Get a lawyer's view on money-transmitter, securities, charitable-solicitation and tax questions.
- [ ] Have terms, a privacy policy and the risk disclosures reviewed.
- [ ] Set up a KYB process for organisations and sanctions screening for their receiving accounts.

## Before launch
- [ ] Complete `docs/REAL_MONEY_TEST_PLAN.md` with about $20 of your own money.
- [ ] Tick off everything in `docs/PRODUCTION_CHECKLIST.md`.
- [ ] Write runbooks: pause everything, RHEA incident, stuck payout, stuck withdrawal, leaked key.

## My to-do
- [ ] 
