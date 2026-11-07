# Hugshire

**Where kindness takes shape.** A cozy top-down world where every cause owns a little town. Supporters
put money to work: it is lent through RHEA on NEAR, and only the real yield it earns goes to the
causes they choose. Each supporter gets an animal helper. Playing decides **when** and **where**
earned yield is delivered, never **how much**.

> Status: a production-grade foundation running in **sandbox (test) mode**. The live money route is
> implemented and verified read-only against the real services, but it is blocked on your accounts
> (Privy, Coinbase, NEAR Intents key, Vault deployment), an audit and legal review. See
> [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Quick start

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

Open http://localhost:3200. Any email works; the 6-digit code is shown on screen. Use
`admin@hugshire.test` for `/admin`.

## What's inside

| Area | Where |
|---|---|
| Pages: home, explore, city, how it works, portfolio, helpers, deliveries, settings | `src/app` |
| Organiser portal: overview, causes, payouts, settings | `src/app/org` |
| Admin: dashboard and search, orgs, causes, transactions, payouts, system health | `src/app/admin` |
| PixiJS world map and city scenes; pure, tested game logic | `src/game` |
| Ledger, yield, deliveries, payouts, withdrawals, reconciliation | `src/server/services` |
| Providers (sandbox and live): Coinbase, 1Click, RHEA/Vault, Privy | `src/server/providers` |
| Job scheduler and worker | `src/server/jobs.ts`, `src/worker` |
| Schema (31 tables) and migrations | `src/server/db/schema.ts`, `drizzle/` |
| Hugshire Vault (Rust, NEAR) | `contracts/vault` |
| Tests | `tests/unit`, `tests/e2e`, `contracts/vault` |

## Scripts

| | |
|---|---|
| `npm run dev` | app on :3200 (sandbox scheduler runs in-process) |
| `npm run worker` | background jobs (live, or when `HUGSHIRE_INPROCESS_WORKER=0`) |
| `npm test` | unit tests (embedded Postgres, no setup) |
| `npm run test:e2e` | Playwright against the running dev server |
| `npm run contract:test` | Vault tests (or use the Docker command in SETUP_GUIDE §5) |
| `npm run verify:live` | read-only checks against RHEA, 1Click, Coinbase, the Vault and Privy |
| `npm run db:seed` | sandbox sample data (refuses in live) |

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): decision, verified route, custody model
- [SETUP_GUIDE.md](docs/SETUP_GUIDE.md): every account, key and command to go live
- [FINANCIAL_MODEL.md](docs/FINANCIAL_MODEL.md): ledger, yield, deliveries, payouts, withdrawals
- [SECURITY.md](docs/SECURITY.md): keys, invariants, controls, open items
- [PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md)
- [REAL_MONEY_TEST_PLAN.md](docs/REAL_MONEY_TEST_PLAN.md)
- [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)

Hugshire is not a bank. Yield is variable. Principal is not guaranteed.
