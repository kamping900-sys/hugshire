# Hugshire: complete project summary (2026-11-11)

**Where kindness takes shape.**

Hugshire is a cozy multiplayer town-building game that is funded by real charitable DeFi yield.
This file covers what the product is, how it works, what is built, what is simulated, and what is
still blocked.

The detailed docs it draws on:
- ARCHITECTURE, FINANCIAL_MODEL, VAULT_V2, SECURITY and WORLD_ENGINE
- V4_GAMEPLAY_ECONOMY (gameplay and economy)
- KNOWN_LIMITATIONS, PRODUCTION_CHECKLIST and REAL_MONEY_TEST_PLAN
- SETUP_GUIDE, and `todo.md` for the working checklist

**Status labels:**
- ✅ built and tested
- 🟡 built, but sandbox, simulated or partial only
- ⛔ blocked on your accounts, approvals or reviews
- 📝 not built yet

---

## 1. Product in one page

1. **Supporters deposit money.** Card or bank payment goes through Coinbase Onramp and becomes USDC
   on Base. NEAR Intents bridges it to NEAR, the Hugshire Vault receives it, and the Vault supplies
   it to **RHEA lending**.
2. **Lending earns real interest (yield).** The principal stays the supporter's and can be withdrawn.
   The yield is committed to charity.
3. **Every supporter gets an animal helper** and a **Heart Tree**. The tree grows fruit that shows,
   to the exact cent, the yield the deposit has really earned.
4. **Players harvest the fruit and deliver Heart Parcels** to approved causes. Automatic delivery
   happens only if the supporter explicitly authorises it.
5. **Each organisation has a shared town.** Players build it together with **Wood** and **Stone**,
   earned in two rhythm mini-games. These resources are virtual and have no money value.
6. **The Community Heart Pool** is a separate charitable treasury. It is funded by a published share
   of *actually received* ad revenue and split **equally** between eligible supporters, who each
   choose which cause receives their share.
7. **Organisations post real-world news** on each town's Notice Board.

**The rule everything follows:** gameplay never changes how much real yield is generated. Play only
changes when yield is delivered and which allowed cause receives it. Wood and Stone can never become
money.

**Hackathon tracks covered:**
- Unstoppable DeFi: the Vault, RHEA and NEAR Intents.
- Social Money: the Community Heart Pool with a Sputnik DAO / Trezu treasury.
- Games with real economies: construction backed by deposits, and yield-backed delivery.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 |
| Data | PostgreSQL via Drizzle ORM. Locally, embedded **PGlite** (no Docker). Migrations run on start. |
| Validation | zod on every API route |
| Game rendering | **PixiJS v8** (one WebGL app per scene) |
| Audio | Web Audio, synthesised at runtime. No recorded or copyrighted sounds. |
| Contracts | Rust / near-sdk 5.30 (`contracts/vault`, plus test mocks of RHEA and USDC) |
| Providers | Coinbase Onramp, NEAR Intents 1Click, RHEA (`contract.main.burrow.near`), Privy (auth and wallets), Sputnik DAO v2 (community treasury) |
| Tests | vitest (unit), Playwright (browser end to end), near-workspaces (contract sandbox) |
| Background jobs | An in-process scheduler in sandbox, or a separate worker (`npm run worker`) in production |

**Modes:**
- **Sandbox** (the default) uses labelled fake providers, and no money moves.
- **Live** refuses to start unless every required credential is set.

---

## 3. Money system (domain A: personal charitable yield) ✅ / 🟡 / ⛔

### 3.1 Flow

```
Supporter ─card/bank─► Coinbase Onramp ─USDC on Base─► supporter wallet
          ─NEAR Intents 1Click─► USDC on NEAR ─ft_transfer_call─► Hugshire Vault ─supply─► RHEA
RHEA interest ─► Vault share value grows ─► yield = value − principal
yield ─► donate (manual) / auto_deliver (keeper, only within the supporter's grant) ─► cause accounts
principal ─► withdraw ─► 1Click back ─► Offramp
```

### 3.2 What is built

- **Double-entry ledger** ✅
  - Money is stored as integers in micro-USDC (`numeric(38,0)`), never floats.
  - Each business event creates exactly one journal (unique on environment, kind and reference).
- **Server flows** ✅
  - Deposits, yield snapshots, deliveries, payout batching, submission and confirmation, and
    withdrawals.
  - Each is a state machine with idempotency keys.
- **Reconciliation** ✅ runs every 10 minutes and compares the ledger with what the pool and chain
  report. It raises an alert on any mismatch.
- **Vault v2 contract** ✅ (tested, **not deployed, not audited**)
  - **Accounting:**
    - Shares with a virtual offset; `yield = value − principal`;
      `withdrawable = min(principal, value)`, so pool losses are shared.
    - The vault is locked around each RHEA read and its callbacks. Deposits are queued and priced
      against a fresh balance.
  - **Supporter control:**
    - Supporters set their own **policy** (which causes are allowed).
    - Session keys can only donate to those causes, up to a daily cap.
    - The keeper's `auto_deliver` is limited by the supporter's signed grant: min, max, interval and
      expiry.
  - **Payouts and safety controls:**
    - Every payout has an id and a status (Pending, Completed, Partial, Failed or Stale) and emits
      events.
    - Withdrawals can be paused for at most 72 hours, with a 24-hour cooldown between pauses.
    - Deposits are closed by default. Ownership changes in two steps.
  - **Tests:** 42 unit tests and 7 NEAR-sandbox integration tests.
- **Live providers** 🟡⛔
  - The code is written and the read-only checks pass: RHEA APR about 8.96%, and a 1Click quote
    of 10 USDC returning 9.998 USDC.
  - **Blocked on:** Coinbase KYB and keys, a Privy app (its client UI isn't built yet), NEAR
    operator accounts, an audit, and a deployment.
  - The live app still reads balances from the ledger cache, not from the Vault's `get_member`.

### 3.3 Delivery rules (V4)

- **Manual delivery:** you can only deliver yield that is real and has settled. The client never
  chooses an amount; it can only cap it to the fruit it harvested.
- **Auto delivery is OFF by default.** It runs only after an explicit, audited authorisation, in one
  of two modes:
  - **Inactivity:** only after **7 days** without play. This is a floor that older settings can't
    shorten.
  - **Schedule:** every N days, without waiting for inactivity.
- **Inactivity alone never moves money.**

---

## 4. Game world

### 4.1 Level 1: the road (side-scrolling world map) 🟡 (built; final art pending)

`/worldmap`, built with `src/game/v4/RoadWorld.ts` and `src/components/worldmap/RoadWorldMap.tsx`.

- **The road:** one long road. The player **drives a van left and right**.
  - Normal top speed is about 1,100 px/s, about 1,900 with boost, with fast acceleration and
    braking.
  - Towns are 1,100 px apart.
- **Controls:**
  - A/D or the arrow keys to drive, and Shift or Space to boost.
  - ↑ or E to enter a town.
  - On phones: ◀ ▶ pedals and a BOOST button.
- **Along the road:**
  - Hugshire Square at the start, then every approved organisation town, then two labelled sample
    stops.
  - Each town has a gate sign, buildings chosen by its category, scaffolding while something is
    being built, and its built count.
- **Bottom strip:** shows every town. Tap one to **auto-drive** there; the van brakes and stops at
  the gate.
- **Returning from a town** puts the van back at that town's gate.
- **Art:**
  - The treeline, lamps and bushes already use the painted sprites.
  - The sky, clouds, mountains, hills, road, foreground, van and gate are **drop-in slots**
    (`public/game/sprites/road/*.png`) waiting for the ChatGPT images. Until then they are drawn in
    code.
- **The old grid overworld** is kept at `/worldmap/classic`. It is an endless tile-streamed world
  with level-of-detail rendering and a minimap.

### 4.2 Level 2: the town (area map) ✅

`/worldmap/town/[slug]`, built with `src/game/v4/TownGame.ts` and `src/components/town/TownView.tsx`.

- **Layout:** a 60×42-cell town with roads, **16 predefined plots** (small, medium and large), a
  fountain, a pond, trees, flowers and lamps.
- **Places to visit:**
  - the **Notice Board**, with a "!" for new posts;
  - your **Heart Tree**;
  - six background buildings (see §5.2).
- **Movement:** walk with WASD or the arrow keys, or click. E interacts, and the mouse wheel zooms.
- **Shared state:** buildings are stored on the server and every visitor sees the same state, polled
  every 2 seconds.
- **Multiplayer presence** 🟡: you see other players' animals and nicknames move around, with
  anonymous keys (never user ids). Presence is held in memory, so it only works on one web instance.
- **Wandering town animals** add ambient life.
- **The HUD shows:**
  - your active deposit and your reward per Hit;
  - the Wood and Stone status;
  - your ripe fruit;
  - your own building;
  - the estimated auto-worker rate.
- **Guests** can walk around and look. Signing in is needed to build or play.

---

## 5. Construction economy (domain C: virtual) ✅

### 5.1 Rules

- **Plots:**
  - Buildings can only go on predefined plots, and the blueprint size must match the plot.
  - Roads always stay clear (tested).
- **Projects:**
  - A supporter can **start one unfinished project at a time**, but can help on any number of
    others. The database enforces this, so it is race-safe.
  - **One open project per plot.**
  - A reservation with no work on it expires after 24 hours. Once work has started, the building
    stays completable even if its creator leaves.
- **Stages:** empty plot → groundwork → frame or scaffolding → nearly done → complete.
  - Today these are drawn in code: a foundation, a building "rising" behind a mask, and
    scaffolding.
  - Real four-stage sprites are being generated (prompts given; slot:
    `art/sheets/stages/<key>.png`).
- **Contributions:** each is applied exactly once, clamped to what the building still needs, and
  completes the building when both requirements are met.
- **Wood and Stone** cannot be withdrawn, traded or converted. There is no code path for it.

### 5.2 MVP blueprint set (owner decision)

**Players can build:**

| Kind | Plot | Blueprint | Wood | Stone |
|---|---|---|---|---|
| House | Small | Cozy Cottage | 300 | 150 |
| House | Small | Family House | 400 | 200 |
| Building | Medium | Bookshop | 2,000 | 1,000 |
| Building | Medium | Big Barn | 2,200 | 700 |
| Building | Large | School | 12,000 | 6,000 |
| Building | Large | Town Hall | 50,000 | 20,000 |

- **Scenery only (cannot be built):** Windmill, Gazebo, Lighthouse, Greenhouse, Clinic and Art
  Studio, placed around the town edges.
- **Retired:** the Market Tent. The server refuses to start it, but a tent already started can still
  be finished.

### 5.3 Deposit-scaled production

```
base reward per Hit = principal × 0.001 per $1          ($1 … $1,000, linear)
                    = 1 × √(principal ÷ $1,000)          (above $1,000, diminishing)
reward              = base × quality (Hit 1, Perfect 2) × combo (1.00 → 2.00)
```

- **Examples:** $10 → 0.01 per Hit, $300 → 0.3, $1,000 → 1, $100,000 → 10.
- **Free play (no deposit):** anyone signed in can play. They earn 0.01 per Hit, capped at **10 per
  rolling 24 hours** (Wood and Stone combined). The server clamps each session to what is left, ending
  it as "daily_limit". Free players can help build but cannot start buildings, and they get no auto
  workers.
- **Where the principal comes from:** the server reads it from the **ledger**; the client never
  sends it. It is the supporter's total, so splitting money between several deposits or helpers
  doesn't increase output.
- **Precision:** integer µ-resources (1 = 1,000,000 µ), so decimals display exactly.

### 5.4 Auto workers

- They contribute once an hour (idempotently) with **no Perfect or combo bonus**. That works out at
  **about 25× slower** than baseline manual play; the spec allows 10–50×.
- They run in the server job, never on browser timers.
- They stop when the deposit stops, and pause while the player has a game open.

---

## 6. Mini-games ✅

**How a session works:**
1. Walk to an unfinished building and press **Work**.
2. The **server picks Wood or Stone**, opens a session, and reveals only round 0 of a secret chart.
3. Each round, the client sends **raw input timings only**.
4. The server judges them, updates hearts, combo and reward, and reveals the next round.
5. At the end, the result is **committed to the building once**.

### 6.1 Wood: Rhythm Chopping (player-driven, no memorisation)

- **Scene:** a side-scrolling forest with parallax hills and trees, a cottage with chimney smoke, a
  stump and a wood pile.
  - Your animal holds an axe, raised over the shoulder and swung onto the stump.
  - A different animal NPC presents the logs.
- **Kinds of log:** normal, fast, delayed (the NPC holds it longer) and consecutive bursts.
- **Fake-outs:**
  - The NPC lifts a log, then pulls it back.
  - This is signalled by a visible wobble, a "?", a rising "hm?" sound, and the timing bar greying
    out with "✋ Hold!".
  - **Holding back keeps your combo and earns nothing.** Swinging is a Miss.
  - The first fake-out appears in round 3, with a hint.
- **Timing bars:** one active bar, with the next one previewed beneath it.
  - The yellow (Hit) and green (Perfect) zones vary in position and size; the cursor speed varies
    at higher tiers.
  - Neighbouring windows never overlap (tested).
- **Feedback:** Perfect gives a big split, wood chips, screen shake and a chime. Hit is a normal
  split. A Miss is a dropped log or a stumble, a buzz, and a lost heart.
- **Tiers:** Early, Medium, Hard and Extreme. Tempo rises and windows narrow; fakes get later and
  more frequent.

### 6.2 Stone: Rhythm Memory Mining (call and response)

- **Scene:** a mining yard with cliffs, a stone house, lanterns and a mine cart.
  - Your animal with a pickaxe is on the left, and the hard-hatted NPC miner is on the right.
  - Up to four coloured rocks are played with **D F J K**, 1–4, the arrow keys, or big on-screen
    buttons.
- **Each round:**
  1. The NPC demonstrates a rhythm. Each rock has its own pitch, and dots appear on a memory lane
     that fades away.
  2. A "Ready · Set · Go" count-in.
  3. You repeat it. **The right rock and the right timing** are both required.
- **Progression:** 1 button, then 2, then 3, up to a **maximum of 4**, with longer sequences and
  faster tempo.

### 6.3 Shared rules

| Rule | Value |
|---|---|
| Hearts | 3; a Miss costs 1; 0 ends the game |
| Perfect / Hit | 2× / 1× the base reward |
| Combo | +5% per success in a row, capped at 2× |
| Session cap | 1,000 resources (Perfect and combo bonuses count toward it) |
| Cooldown | **Off** (owner decision). The admin setting `gameCooldownSeconds` can turn it back on. |
| Daily safeguard | 10,000 per resource per 24 hours |
| Max session length | 6 minutes |
| Kept on game over | Everything earned so far |
| Building need | A reward never exceeds what the building still needs |

### 6.4 Anti-cheat

- **The server owns:**
  - session creation, with **one open session per user** (a second tab resumes it);
  - the resource choice and the secret seed;
  - the timing windows, hearts, combo and rewards;
  - the caps;
  - the commit, exactly once.
- **The server rejects:**
  - a round submitted faster than it could be played;
  - a replayed round (an optimistic lock on the round number);
  - inhumanly consistent timing (that round is zeroed and flagged, and two flags end the session);
  - any score or reward sent by the client (it is ignored; tested).
- **Honest limit:** a browser can't prove a human pressed the keys. The stakes are capped, virtual
  resources only.

---

## 7. Heart Tree ✅

- **Red fruit, "From your deposit":**
  - Real settled yield, split **exactly** into 1–12 fruits, about one per $0.05.
  - There is no fixed $0.01 per fruit: $0.003 shows as one honest fruit.
  - Yield that is still settling appears as small buds.
- **States:**
  - **Accruing:** in the settlement window.
  - **Ripe:** eligible to deliver.
  - **Pending:** a delivery exists but the payout isn't confirmed.
  - **Delivered:** the payout is **confirmed**.
- **Harvesting:** pick single fruits, or all of them, into a Heart Parcel and deliver it to any
  approved cause. The amount sent is exactly the fruit you picked. You can also leave the fruit to
  keep growing.
- **Golden fruit, "From our community":**
  - It appears only after a Community Pool month is finalized and funded.
  - You choose which causes receive it (up to 3, with a split).
  - Its accounting is completely separate from your deposit.

---

## 8. Community Heart Pool (domain B: social money) 🟡

**Status:** works end to end in sandbox with simulated revenue. Live mode needs:
- a DAO;
- an ad network;
- a uniqueness provider.

### 8.1 The monthly cycle

```
revenue_reported → revenue_finalized → budget_transferred → treasury_funded → snapshot_finalized
→ allocations_calculated → choosing → payouts_prepared → awaiting_approval → executed → reconciled
```

- **Revenue:**
  - Only provider statements **marked as received** count. Estimates never count.
  - Simulated revenue is refused in live mode and labelled SIMULATED everywhere.
- **Charity share:**
  - Admins set it, and it is shown publicly.
  - **It starts as "not set"**, and finalizing is refused until it is set. No percentage is assumed.
- **Equal split:**
  - `per_tree = floor((budget + carry_in) ÷ eligible)` in integer micro-USDC, with the remainder
    carried into the next month.
  - It is independent of deposit size, Wood, Stone, games, ads, combos, wallets and workers.
- **Who is eligible:**
  - An active account.
  - A minimum account age.
  - A minimum deposit **held for the whole holding period**, checked against ledger history, so a
    withdrawal part-way through disqualifies.
  - A verified **uniqueness attestation**, stored only as a salted hash. It is unique per person and
    again per cycle.
- **Appeals:** admin overrides are allowed before the snapshot and are logged, but they can never
  bypass uniqueness.
- **Choosing causes:**
  - Supporters have 14 days to choose.
  - **Disclosed default if they don't:** their default cause, else the cause they chose most
    recently, else their helper's home town, else the allocation is carried forward.
- **Public audit:**
  - The snapshot is published under per-cycle pseudonyms, together with its sha256 hash.
  - `/api/pool/cycles/[id]` recomputes the hash and lists every payout with its proposal and
    transaction.
- **Payouts:**
  - One per cause per cycle, booked once. Failed or rejected payouts can be proposed again.
  - Reconciliation checks every total.
- **Ledger:** the `pool:*` namespace never touches supporters' principal or yield. This is tested.

### 8.2 Treasury: Sputnik DAO / Trezu

- **What Trezu is:** a non-custodial multisig treasury app built on the **Sputnik DAO v2** contracts.
- **`SputnikTreasury` (live):**
  - Hugshire's key has **only the proposer role**. It creates `Transfer` proposals for USDC.
  - Council members **approve in Trezu**, and Sputnik executes the payment when the vote threshold
    is reached.
  - Funding is a real USDC transfer into the DAO, checked against the DAO's balance.
  - Written, but **not yet run on mainnet**.
- **`SandboxDaoTreasury`:** a labelled stand-in that requires N council approvals and holds test
  assets only. It is never presented as decentralized.
- **Trust assumptions:**
  - Allocations are computed off chain.
  - Anyone can verify the published snapshot, its hash, the formula, the per-cause totals, and each
    on-chain proposal.

### 8.3 Optional ads 🟡 (simulated only)

- **The prompt:** after a mini-game, a "Help Hugshire Grow ❤️" card offers **Watch Ad** or
  **Maybe Later**.
- **No reward, ever:** watching gives nothing (no resources, lives, cooldown, yield, allocation or
  votes), and skipping costs nothing.
- **Frequency limits:** at most one ad every 3 minutes and 10 per day.
- **Provider:** only a simulated ad exists, labelled "SIMULATED AD · NO ADVERTISER · NO REVENUE".
- **Real ads** stay disabled until a network and its policies are approved.

---

## 9. Notice Board, organisers and admins

- **Notice Board** ✅
  - Organisations post news, stories, progress reports or impact evidence, with optional https
    photo, video and read-more links.
  - Posts are labelled "Reported by the organisation" unless Hugshire has verified the evidence.
  - Players can report posts, and admins can hide or restore them (audited).
  - The UI states that a finished virtual building is **not** proof of real-world impact.
- **Organiser portal (`/org`)** ✅: organisation profile and KYB status, causes (create, edit, submit
  for review), cover images, Notice Board posts, and payouts.
- **Admin portal (`/admin`)** ✅:
  - Dashboard and search.
  - Approving organisations and causes, and verifying payout accounts.
  - Transactions and payouts.
  - System health: pause switches and every setting, including the pool, ads and game cooldown.
  - **Community Pool** operations, including running cycles, council approvals and moderation.
- **Public pages:**
  - home, how-it-works, explore and support (deposit);
  - portfolio, helpers, deliveries and settings;
  - the pool page with its rules and audit links.

---

## 10. Security and safety (summary)

- **Three separate accounting domains:** personal vault, community pool, and virtual construction.
  Virtual resources have no money accounts at all.
- **Money handling:**
  - Integer money only and a double-entry ledger.
  - Every business event happens once (idempotent), state machines refuse illegal transitions, and
    reconciliation runs with alerts.
- **App security:**
  - A same-origin check on every write, rate limiting, zod validation on every input, and audit
    logs for admin and money actions.
  - Live mode refuses to start without its credentials, and dev sign-in is impossible in live mode.
- **Contract safety:**
  - Users authorise where their yield goes.
  - The keeper is limited by the supporter's grant.
  - Withdrawal pauses are capped, deposits are closed by default, and ownership changes in two
    steps.
- **Not yet production-ready:**
  - no audit;
  - no Content-Security-Policy;
  - an in-process rate limiter;
  - the operator key in an env var rather than a KMS;
  - in-memory presence;
  - legal review still needed (money transmission, securities, charitable solicitation, and the
    pool and ad wording).

---

## 11. Workflows

### 11.1 Supporter (sandbox demo)

1. Sign in at `/login`. Test mode shows the 6-digit code on screen.
2. Support a cause: pick an animal and an amount, accept the risk notice, then complete the test
   payment. The deposit reaches "Earning on RHEA".
3. On `/worldmap`, drive the van to the town and press ↑.
4. Start a building on a free plot, or walk to an unfinished one and press **Work**. Play Wood or
   Stone, and the resources go straight into the building.
5. Visit the Heart Tree: harvest ripe fruit and deliver the parcel. It shows as Pending, then
   Delivered once the payout is confirmed.
6. Optionally watch a simulated ad.
7. Read the Notice Board.
8. When a pool month is finalized, choose a cause for your golden fruit.

**Demo account:** `sample-fay@hugshire.test` (Yuzu), with a $300 deposit, in Fernhollow.

### 11.2 Organisation

Register an organisation, then admin approves it. Set a payout account, then admin verifies it.
Create a cause, then admin approves it. Its town then appears on the road. Post updates to the
Notice Board.

### 11.3 Admin: running a pool month

1. Set the charity share.
2. Record the revenue statement and mark it received.
3. Finalize, then transfer the budget and confirm funding.
4. Finalize the eligibility snapshot, then calculate allocations.
5. Let the choice window run, then prepare payouts.
6. Create treasury proposals. The council approves them (in Trezu when live).
7. Sync, then reconcile.

---

## 12. Testing status

| Suite | Result |
|---|---|
| App unit tests (vitest) | 84 passed at the V4 commit. The mini-game file (27 tests) passes after the later changes (cooldown off, MVP blueprints). |
| Browser end to end (Playwright) | The V4 town file passes (5 passed, 1 mobile duplicate skipped). The earlier critical-flow tests passed; one checkout step flaked once in a full parallel run. |
| Contract unit tests | 42 passed |
| Contract sandbox integration tests | 7 passed |
| Manual in-app run | **Wood:** 5 Perfect, +3.3 Wood (server-confirmed). **Stone:** 5 rounds all Perfect, ×18 combo, 1 → 2 buttons. **Heart Tree:** a harvested parcel went pending, then delivered. **Pool:** a full simulated month was reconciled with its hash verified. **Road:** auto-drive stopped at the town gate. |

---

## 13. Art pipeline

- **Existing art:** 177 sprites listed in `public/game/sprites/manifest.json`. They cover buildings,
  houses, props, ground textures, a truck, sheep, and 8 mascots with front, side and back poses and
  4-frame walk cycles.
- **Process:** ChatGPT-generated sheets are kept in `art/sheets/`. They are sliced by
  `scripts/slice-sheet.cjs` and `slice-walk.cjs`, then the manifest is rebuilt with
  `scripts/build-manifest.cjs`. Missing art falls back to shapes drawn in code.
- **Requested (prompts given):**
  - **Road world:** sky, clouds, mountains, hills, treeline, road, foreground, van and gate. These
    go in `public/game/sprites/road/` and are picked up automatically.
  - **Construction stages:** 4-stage sheets for the 6 MVP buildings, saved to
    `art/sheets/stages/<key>.png`. They then need slicing and wiring in.
- **Planned:** restyle the road HUD to look like wooden or paper signs instead of website cards.

---

## 14. Where the code lives

| Area | Path |
|---|---|
| Database schema (43 tables) and migrations | `src/server/db/schema.ts`, `drizzle/` |
| Ledger, settings, audit and alerts | `src/server/core.ts` |
| Money services | `src/server/services/{deposits,yield,deliveries,payouts,withdrawals,reconcile,processor,live-steps}.ts` |
| Game services | `src/server/services/{game,heartTree,towns,stories}.ts` |
| Community Pool | `src/server/services/pool.ts`, `src/server/providers/treasury.ts`, `src/server/providers/ads.ts` |
| Providers | `src/server/providers/{live,sandbox,near,index}.ts` |
| Jobs | `src/server/jobs.ts`, `src/worker/index.ts` |
| Shared game rules | `src/game/v4/rules.ts`, `src/game/v4/town.ts` |
| Scenes | `src/game/v4/{RoadWorld,TownGame,scenes,sfx}.ts`, `src/game/world/*` (classic grid world) |
| UI | `src/components/{worldmap,town}/*`, `src/app/*` |
| Contracts | `contracts/{vault,mock-ft,mock-rhea,integration}` |
| Tests | `tests/unit/*`, `tests/e2e/*`, `contracts/**/tests` |

---

## 15. Commits

| Commit | What |
|---|---|
| `0148f9e` | The sandbox foundation: ledger, providers, portals, cities |
| `ded1211` | The full-screen grid world with generated art |
| `5fe5c59` | Cozier look: real streets and natural water |
| `ede4453` | 4-frame walk cycles for all 8 animals |
| `614f7f3` | Vault v2: share-based charitable-yield vault with user-authorised donations |
| `f34779e` | V4: shared towns, Wood/Stone rhythm games, Heart Tree, Community Heart Pool |
| *(not committed yet)* | The side-scrolling road world map, the game cooldown turned off, and the MVP blueprint set (2 houses + 4 buildings, the rest as scenery) |

---

## 16. What's left

**Blocked on you** (also in `todo.md`):
- Accounts: Coinbase CDP and KYB, a Privy app, a NEAR Intents partner key, an RPC provider.
- NEAR accounts and the Vault: a multisig owner, the Vault account, the operator account, an audit,
  and a reproducible deployment.
- The community treasury: a Sputnik DAO in Trezu, its council, and Hugshire's proposer role.
- A decision on the charity share; an ad network with a policy review; a uniqueness provider.
- Legal and compliance review; hosting, databases and monitoring.

**Code still to do:**
- 📝 The Privy client: login UI and signing prompts.
- 📝 A keeper job for the Vault.
- 📝 Reading balances live from the Vault.
- 📝 The Offramp return leg.
- 📝 Wiring in the four-stage building sprites and the road art when they arrive.
- 📝 A cozy restyle of the road HUD.
- 📝 Redis or WebSocket presence before running more than one web instance.
- 📝 A Content-Security-Policy header, KMS for keys, and Sentry error tracking.

**Strategy:**
- Keep real money honest and auditable first.
- Make the game rewarding without inventing money.
- Use community funding (ads into the pool, split equally) to give play a real charitable purpose.
- Ship the MVP with a small, polished building set, then expand.


---

## Update (2026-11-12): Wood timing bar, Stone removed

The owner replaced both rhythm games. This section overrides the Wood and Stone sections above.

- **Stone is removed.** Wood is the only building material and the only mini-game.
  - Buildable blueprints need 0 Stone.
  - Migration `0002` reduced the Stone requirement of unfinished buildings to what they already had.
  - Migration `0003` closed unfinished buildings on plots removed from the smaller town map.
- **Wood is one timing bar with one button** (Space, click or tap).
  - An indicator moves across the bar. Stopping it in the green zone is a Perfect (2×), in the yellow zone a Hit (1×), anywhere else a Miss.
  - Taking longer than 8 seconds is also a Miss.
- **Difficulty rises with chops attempted** (never with deposit size): Easy, then Medium (from chop 9), Hard (from chop 21), Extreme (from chop 36).
  - Zones shrink and move, and the indicator speed varies and accelerates.
  - Zones never get narrower than 12% (yellow) or 4% (green) of the bar.
  - Every value is configurable in `BAR_TIERS` (`src/game/v4/rules.ts`).
- **Combo:** `min(1 + floor(combo / 5) × 0.05, 1.5)`.
  - Reward = base(deposit) × (2 for a Perfect, 1 for a Hit) × combo.
  - 3 hearts, a 1,000-Wood session cap, and the same free-play limits as before.
- **Server-authoritative play:**
  - Each round reveals 5 attempts generated from a secret seed.
  - The client sends only raw stop times. The server recomputes the bar and judges each stop.
  - A round cannot be submitted sooner than the stop times it claims add up to, and a round can only be submitted once.
- **Optional art slots:** `public/game/sprites/wood/` (background, clouds, stump, log, log_left, log_right, axe). Anything missing is drawn in code.
