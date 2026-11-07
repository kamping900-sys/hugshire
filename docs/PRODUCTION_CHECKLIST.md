# Production checklist

Tick every item before accepting money from anyone other than yourself.

## Legal and compliance (blockers)

- [ ] Lawyer review of the model: pooled lending of user funds via a contract you deploy, yield
      routed to charities. Questions to answer: money-transmitter status (FinCEN/state MTLs),
      securities analysis of the Vault position, charitable-solicitation registration in the states
      where you operate, and the tax treatment of yield delivered on a user's behalf (who is the donor
      of record, and who issues receipts).
- [ ] Terms of service, privacy policy and risk disclosures reviewed by counsel; consent captured
      (`user_profiles.risk_acknowledged_at` already records the in-app acknowledgement).
- [ ] Organisation KYB: legal entity, EIN, 501(c)(3) determination letter where claimed, bank and
      wallet ownership proof. Keep the evidence outside the app.
- [ ] Sanctions screening of organisations and their receiving accounts.
- [ ] Coinbase Onramp production approval (KYB) and Offramp enablement.
- [ ] NEAR Intents partner key and terms accepted.

## Smart contract

- [ ] Independent audit of `contracts/vault`; findings fixed and re-reviewed.
- [ ] Reproducible build (`cargo near build`); deployed code hash recorded in the repository.
- [ ] Owner is a multisig; operator is a function-call key; owner ≠ operator (`verify:live` checks).
- [ ] Vault storage registered with USDC and RHEA (`verify:live` checks).
- [ ] Per-deposit and total-principal caps decided (consider adding an on-chain TVL cap before launch).

## Application

- [ ] `HUGSHIRE_MODE=live` boots with no config errors; `npm run verify:live` is all ✓.
- [ ] Privy client integration finished and tested (see KNOWN_LIMITATIONS §1).
- [ ] User NEAR gas solved (funded implicit accounts or a meta-transaction relayer).
- [ ] Coinbase webhook subscription live and delivering (check `/admin/transactions` → Webhooks).
- [ ] CSP header added and tested with PixiJS.
- [ ] Alerts fan out to a channel you watch; on-call phone notifications for `critical`.
- [ ] Sentry on web and worker.
- [ ] Database backups with point-in-time recovery; restore tested once.
- [ ] Separate staging (sandbox) and production projects, databases and secrets.
- [ ] Cloudflare proxy on, WAF rate limit on `/api/*`, "Always HTTPS".
- [ ] `ADMIN_EMAILS` set to real admins only; admin accounts use Google with 2FA via Privy.
- [ ] Settings reviewed in `/admin/health`: settlement window ≥ 1 h, minimum payout ≥ $1, deposit
      limits.

## Operations

- [ ] [REAL_MONEY_TEST_PLAN.md](REAL_MONEY_TEST_PLAN.md) completed end to end with your own funds,
      with results written down.
- [ ] Runbooks written: pause everything, a RHEA incident, a stuck payout, a stuck withdrawal, a
      reconciliation failure, a leaked operator key (owner calls `set_operator` to a new key, then the
      old key is deleted).
- [ ] Support inbox and response-time promise published.
- [ ] Monthly: export the ledger, reconcile against on-chain Vault totals and payouts, and archive.
