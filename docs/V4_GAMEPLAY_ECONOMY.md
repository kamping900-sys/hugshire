# Hugshire V4: gameplay, economy and social money (2026-11-11)

This is the implementation record for the V4 specification. Where it conflicts with earlier gameplay
docs, this one wins. The Hugs/Sparks idea in PROJECT_OVERVIEW §6 is **retired** (it was never built).

Status labels: ✅ built and tested · 🟡 built, sandbox only · ⛔ blocked on an external account, review or approval.

---

## 1. Three separate economies

| Domain | What | Where it lives | Can money leak in or out? |
|---|---|---|---|
| **A. Personal charitable yield** | Deposits, Vault v2 shares, principal, real RHEA yield, deliveries to causes, withdrawals | Unchanged: `contracts/vault`, `services/{deposits,yield,deliveries,payouts,withdrawals}`, ledger accounts `user:*`, `cause:*`, `pool:lending` | — |
| **B. Community Heart Pool** | Finalized ad revenue × published share → separate treasury → equal allocation → supporter-chosen causes | `services/pool.ts`, `providers/treasury.ts`, tables `pool_*`, `ad_revenue_reports`, `treasury_proposals`, ledger accounts `pool:*` (own namespace) | Never touches A. Tested: principals are identical before and after a full cycle. |
| **C. Virtual construction** | Wood, Stone, mini-game sessions, auto workers, buildings | `services/game.ts`, `game/v4/*`, tables `construction_projects`, `game_sessions`, `resource_contributions` | No money accounts at all. The only input from A is the *verified principal* used to scale production. |

Gameplay never changes RHEA yield. Wood and Stone are not tokens: there is no transfer, withdraw or
convert path in the code.

---

## 2. Implementation map (what changed)

**Reused unchanged:** Vault v2, ledger, providers, deposits, yield, payouts, withdrawals, reconciliation,
the overworld engine (tile streaming, LOD, minimap, camera), sprites and texture bank.

**Changed:**
- `services/deliveries.ts`: the auto-delivery fallback is now **7 days** and needs a **recorded
  authorisation** (`auto_authorized_at`). An optional authorised **schedule** mode delivers on an
  interval without the inactivity wait. Inactivity alone never moves money.
- `/api/preferences` + `/deliveries` form: explicit "I authorise automatic delivery" (off by default),
  schedule choice, audit events for authorise and revoke.
- `/api/deliveries`: optional `capMicro`, so a harvested parcel delivers exactly the picked fruit. The
  cap can never exceed eligible yield.
- `/worldmap` (level 1): real towns from `/api/world` in the first slots, with "Enter town". The
  remaining tiles are labelled samples. The browser-only demo parcels and money were removed.
- Notice Board: `cause_updates` gained category, media, link and moderation fields. The organiser form
  is in `/org/causes/[id]`, the report and hide flow in `/admin/pool`.

**New:**

| Area | Files |
|---|---|
| Shared rules (client + server) | `src/game/v4/rules.ts` (fixed-point rewards, chart generators, judges), `src/game/v4/town.ts` (plots, blueprints, layout) |
| Level 2 town | `src/game/v4/TownGame.ts`, `src/components/town/TownView.tsx`, `/worldmap/town/[slug]` |
| Mini-games | `src/game/v4/scenes.ts` (WoodScene, StoneScene), `src/game/v4/sfx.ts` (synthesised audio), `src/components/town/MiniGameOverlay.tsx` |
| Server | `services/game.ts`, `services/heartTree.ts`, `services/pool.ts`, `services/stories.ts`, `services/towns.ts`, `providers/treasury.ts`, `providers/ads.ts` |
| API | `/api/world`, `/api/town/[slug]` (+ `/presence`), `/api/construction`, `/api/minigame/start`, `/api/minigame/[id]`, `/api/heart-tree`, `/api/pool` (+ `/choice`, `/attest`, `/cycles/[id]`), `/api/admin/pool`, `/api/ads`, `/api/stories/[id]/report`, `/api/admin/stories` |
| Pages | `/pool` (public rules and audit trail), `/admin/pool` (operations) |
| Jobs | `expire_game_sessions` (30 s), `expire_plot_reservations` (10 min), `auto_workers` (10 min, hourly-idempotent), `pool_cycle` (2 min) |
| Schema | migration `drizzle/0001_v4_game_pool.sql`: 13 new tables plus new columns |

---

## 3. World

- **Level 1, overworld** ✅: one continuous grid; each tile is a whole area. Real towns show their
  stage (from completed buildings) and a construction summary, and can be entered.
- **Level 2, detailed town** ✅: 60×42 cells (1920×1344 px). It has:
  - roads, 16 predefined plots (S/M/L), a fountain, a pond and trees;
  - the Notice Board, with a "!" for new posts;
  - your Heart Tree;
  - wandering town folk.

  Static scenery is drawn once and only characters update per frame. Movement uses grid collision.
- **Shared and persistent** ✅: construction state is in Postgres. Every visitor polls the same
  authoritative state every 2 s (presence heartbeat).
- **Multiplayer presence** 🟡: kept in memory on one web instance. Clients see an anonymous key, the
  animal and the nickname, never user ids. Multi-instance needs Redis or WebSockets.

## 4. Construction ✅

- Buildings only go on predefined plots, and the blueprint size must match the plot. Roads stay
  clear: the plots are validated in `tests/unit/v4.test.ts`.
- **One unfinished project per initiator:** a partial unique index (race-safe), plus a friendly check.
  A player can still help on any other building.
- **One open project per plot:** also a partial unique index.
- **Reservations:** a reservation with no contributions expires after 24 h. Once work has started,
  the building never expires, so it stays completable if the creator disappears.
- **Stages:** empty plot → foundation → scaffolding (the building rises from the ground as resources
  arrive) → nearly done → completed.
- **Blueprints (configurable, whole resources):**

  | Size | Blueprint | Wood | Stone |
  |---|---|---|---|
  | S | Cottage | 300 | 150 |
  | S | Gazebo | 250 | 80 |
  | S | Market Tent | 180 | 40 |
  | M | Bookshop | 2,000 | 1,000 |
  | M | Clinic | 2,500 | 1,500 |
  | M | Greenhouse | 1,800 | 800 |
  | M | Art Studio | 2,000 | 900 |
  | M | Barn | 2,200 | 700 |
  | L | School | 12,000 | 6,000 |
  | L | Windmill | 8,000 | 3,000 |
  | L | Lighthouse | 10,000 | 8,000 |
  | L | Town Hall | 50,000 | 20,000 |

- **Contributions:** applied exactly once (unique source + ref key) and clamped to what the building
  still needs. CHECK constraints keep `contributed ≤ required`.

## 5. Mini-games ✅

**Flow:**
1. Walk to an unfinished building and press **Work**.
2. The **server** picks Wood or Stone, opens a session and reveals round 0.
3. Each round, the client sends only **raw input timings**.
4. The server judges them against the secret chart and reveals the next round.
5. At the end, the result is committed once, straight into the building.

### Wood: rhythm chopping (player-driven, no memorisation)

- **Scene:** a forest with parallax hills and trees, a cottage with chimney smoke, a stump and a wood
  pile. Your animal holds an axe; a different animal NPC presents logs.
- **Logs:** normal, fast, delayed (the NPC holds the log longer) and consecutive (burst).
- **Fake-outs:**
  - The NPC lifts a log toward the stump, then pulls it back.
  - The tell is a visible wobble, a "?" and a rising "hm?" sound, at a configurable fraction of the
    approach. The timing bar also greys out with "✋ Hold!".
  - Holding back is a **read**: it keeps the combo and earns nothing.
  - Swinging during a fake is a **Miss**.
  - The first fake appears in round 3, gently telegraphed and announced with a hint.
- **Timing bars:** one active challenge, with the next one previewed beneath it. The yellow (Hit) and
  green (Perfect) zones vary in position and size; the cursor speed varies at higher tiers.
- **Fairness:** neighbouring timing windows never overlap (tested).
- **Feedback:** Perfect = big split, wood chips, screen shake and a chime. Hit = normal split.
  Miss = dropped log or stumble, a buzz and a heart lost.

### Stone: rhythm memory mining (call and response)

- **Scene:** a mining yard with cliffs, a stone house, lanterns and a mine cart. Your animal with a
  pickaxe is on the left; the hard-hatted NPC miner is on the right. Up to four coloured rocks
  (D F J K, 1–4, arrows, or on-screen buttons on mobile).
- **The NPC's turn:** the NPC strikes a pattern. Each rock has its own pitch. Dots appear on a memory
  lane and fade before your turn.
- **Your turn:** a "Ready · Set · Go" count-in, then you repeat the pattern. The right rock and the
  right time are both required.
- **Progression:** 1 button (Early), 2 (Medium), 2–3 (Hard), 3–4 (Extreme). **Never more than 4**
  (tested).

### Shared rules

| Rule | Value | Where |
|---|---|---|
| Hearts | 3; a Miss costs 1; 0 = game over | `RULES.hearts` |
| Perfect / Hit | 2× / 1× base | `RULES.perfectQuality` |
| Combo | +5% per consecutive success, capped at 2× | `comboBps` |
| Session cap | 1,000 resources (Perfect and combo count) | `RULES.sessionCapMicro` |
| Cooldown | **Off by default** (owner decision, 2026-11-11). Admin setting `gameCooldownSeconds` (per resource, applies after quit too) can turn it back on | `gameCooldownSeconds` |
| Max session | 6 min, then the server ends it | `RULES.sessionMaxSeconds` |
| Daily safeguard | 10,000 per resource per rolling 24 h | `RULES.dailyCapMicro` |
| Precision | integer µresources (1 = 1,000,000 µ); decimals are shown | `RES_UNIT` |

Rewards never exceed what the building still needs. Resources earned before game over are kept.

### Deposit scaling (`baseReward`)

```
base(p) = p × 0.001 resource per $1                 when $1 ≤ p ≤ $1,000
base(p) = 1 × √(p / $1,000)                         when p > $1,000
reward  = base × quality (1 or 2) × combo (1.00 … 2.00), clamped to the session budget
```

| Verified principal | Base per Hit |
|---|---|
| $10 | 0.01 (the spec example) |
| $300 | 0.3 |
| $1,000 | 1 |
| $4,000 | 2 |
| $100,000 | 10 |
| below $1 (no deposit) | **free play: 0.01 per Hit, at most 10 per rolling 24 h (Wood + Stone combined)** |

- The principal comes from the **double-entry ledger** (`user:*:principal`). The client never sends
  it. Pending withdrawals are excluded automatically.
- Base is computed per **supporter, on total principal**, so splitting funds between deposits or
  helpers never increases output.
- Splitting across separate accounts gains nothing below the $1,000 knee, where rewards are linear.
  Above it, a gain is possible, but it is bounded by per-account caps and cooldowns and needs real
  play time on every account. Wood and Stone have no money value, so there is nothing to cash out.

### Auto workers

- Hourly per supporter, idempotent on `auto:{user}:{hour}`.
- Production = `base × 25` per hour, with no Perfect or combo bonuses.
- The documented manual baseline is: Hit quality, average combo ×1.5, 60 actions per session, about
  8.5 minutes per session including the cooldown, which gives about 635 base per hour. Auto is
  therefore about **25× slower**, inside the required 10–50×.
- Skips supporters with an open session and stops when the deposit stops.
- Target: the supporter's own building, else the building they last contributed to, else the oldest
  active building in their helper's home town. Runs in the server job, never in browser timers.

### Anti-cheat (server-authoritative)

What the server controls:
- session creation, with one open session per user across tabs and devices (a second tab resumes the
  same session);
- resource choice;
- the secret seed; the chart is revealed one round at a time;
- timing windows, hearts, combo and reward;
- the caps and cooldowns;
- the commit, exactly once.

What it rejects:
- a round submitted faster than it can be played (`too_fast`);
- a replayed or duplicate round, caught by an optimistic lock on the round number;
- inhumanly consistent timing (standard deviation under 2.5 ms over at least 8 hits): that round is
  zeroed and flagged, and a second flag ends the session with nothing committed;
- client-supplied rewards: they are ignored (e2e test).

**Documented limitation:** a browser rhythm game cannot prove a human pressed the keys. A determined
bot that reads each revealed round and adds human-like jitter can play well. The defences are the
caps, cooldowns, daily limits, deposit scaling and per-account rate limits. The stakes are virtual
building progress only.

## 6. Heart Tree ✅

- **Red fruit, "From your deposit":** real, settled yield (`yield_allocations`), split exactly into
  1–12 fruits (about one per $0.05). There is **no fixed $0.01**: a $0.003217 balance is one honest
  fruit. Settling yield shows as small buds.
- **States:**
  - **Accruing:** snapshotted, in the settlement window.
  - **Ripe:** eligible now.
  - **Pending:** delivery created, payout not confirmed.
  - **Delivered:** payout **confirmed**.
- **Harvest:** pick single fruits or all of them into a Heart Parcel, then deliver it to any approved
  cause. The amount sent is exactly the harvested fruit (`capMicro`). Or leave the fruit invested.
- **Auto delivery:** only after explicit authorisation. Either after 7 days without play, or on the
  supporter's authorised schedule. It respects the destination rule and threshold. On chain, the
  Vault v2 grant (policy causes, min/max, interval, expiry) still applies.
- **Golden fruit, "From our community":** appears only when the supporter's pool allocation exists,
  meaning the cycle is finalized and funded. Choosing a cause is a separate API with its own
  accounting.

## 7. Community Heart Pool 🟡 (sandbox complete; live needs a DAO, a revenue source and a uniqueness provider)

**Cycle** (a state machine that refuses skipped steps, every step audited):

`revenue_reported → revenue_finalized → budget_transferred → treasury_funded → snapshot_finalized →
allocations_calculated → choosing → payouts_prepared → awaiting_approval → executed → reconciled`

- **Revenue:**
  - Only provider statements that are marked **received** can be finalized. Estimates never count.
  - `simulated` reports are refused in live mode and labelled SIMULATED everywhere.
  - A report can be reversed before finalization. After it, an adjustment reduces a later cycle's
    budget, never anyone's principal.
- **Charity share:** an admin setting, shown publicly. **Default 0 = not set**, and finalization is
  refused until it is set. No percentage is assumed.
- **Equal allocation:** `per_tree = floor((budget + carry_in) / eligible_count)` in integer
  micro-USDC. The remainder carries forward.
  - It is independent of deposit size, Wood, Stone, games, ads, combos, wallets and workers (tested:
    a $20 depositor and a $520 depositor get identical shares).
- **Eligibility** (separate from resource eligibility):
  - an active account;
  - an account of at least N days (default 30);
  - a **minimum principal held over the whole holding period**, default $10 for 30 days, computed
    from ledger history, so a withdrawal mid-period disqualifies;
  - a verified **uniqueness attestation**, stored only as a salted hash. It is unique per provider
    subject, and unique again per cycle.
  - Admin overrides (appeals and corrections) are allowed before the snapshot, are logged, and can
    never bypass uniqueness.
- **Snapshot:**
  - The eligible list is published as per-cycle pseudonyms: `sha256("hugshire-pool:{cycle}:{user}")`.
  - A canonical JSON document is published with its sha256 hash.
  - `/api/pool/cycles/[id]` recomputes the hash and lists every payout with its proposal id and
    transaction.
- **Choices:**
  - Up to 3 causes with a split, within 14 days.
  - **Disclosed default rule:** the supporter's default cause, else their most recently chosen cause,
    else their helper's home town. If none of those can receive funds, the allocation is carried
    forward into the next month's equal split.
- **Payouts:**
  - One proposal per cause per cycle (`unique(cycle, cause)`).
  - Executed payments are booked once (journal idempotency).
  - A failed or rejected proposal can be re-proposed under the same payout id.
  - Reconciliation checks that all shares are equal, the count matches, budget + carry = allocations
    + remainder, payouts + carried = allocations, and every allocation account is cleared.

### Treasury: Sputnik DAO / Trezu

- **Research:** Trezu (trezu.org, MultiAgency/trezu) is a non-custodial multisig treasury app built
  on the **Sputnik DAO v2** contracts (`sputnik-dao.near`). It offers proposer, approver and
  financial-member roles, single and bulk NEP-141 payments, and cross-chain transfers via NEAR
  Intents. No public API for apps was found. Integration therefore targets the Sputnik contract
  directly, and councils manage the same DAO in Trezu.
- **`SputnikTreasury` (live):**
  - Hugshire's key has only the **proposer** role. It calls `add_proposal` with a `Transfer` (USDC,
    the cause's verified account, the exact amount, and the payout id in the description).
  - Council members approve in Trezu. Sputnik executes a Transfer proposal in the same call that
    reaches its vote threshold.
  - The job polls `get_proposal`. Funding is a real USDC transfer into the DAO, recorded by its
    transaction hash and accepted only if the DAO's `ft_balance_of` covers the budget.
- **`SandboxDaoTreasury`:**
  - A clearly labelled **stand-in** with an N-of-council threshold, implemented in the database.
  - It holds independently funded **test** assets and is never presented as decentralized.
- **Trust assumptions:**
  - Equal allocations are computed off chain. Sputnik cannot enforce "equal" by itself.
  - What anyone *can* verify: the published snapshot, its hash, the formula, the per-cause sums, and
    each on-chain proposal's amount and recipient.
  - Hugshire is trusted to include everyone who is eligible. The pseudonym lets each supporter check
    they were included.
  - The council is trusted not to approve a proposal that doesn't match the published snapshot.

## 8. Optional ads 🟡 (simulated only)

- A non-disruptive prompt after a mini-game: **"Help Hugshire Grow ❤️ — Optional ads help fund the
  Community Heart Pool."** with **Watch Ad / Maybe Later**.
- Watching gives **nothing**: no resources, lives, cooldown, yield, allocation or votes. Skipping
  costs nothing.
- Frequency is capped (3 min apart, 10 per day).
- `AdProvider` interface; only `SimulatedAdProvider` exists. It shows a "SIMULATED AD · NO
  ADVERTISER · NO REVENUE" card.
- Real ads stay disabled (`adsProductionEnabled=false`) until a network's current publisher policies,
  charity messaging, rewarded-format rules, consent and invalid-traffic protections are verified.
  Revenue enters the pool only through finalized, received statements, never per impression.

## 9. Notice Board ✅

- Organisations post news, stories, progress reports or impact evidence, with optional https photo,
  video and read-more links, from `/org/causes/[id]`.
- Players see a "!" for new posts, can read them in town, and can report a post.
- Admins hide or restore posts (audited) in `/admin/pool`.
- Every post is labelled **"Reported by the organisation"** unless Hugshire verified the evidence. The
  UI says plainly that a completed virtual building is not proof of real-world impact.

## 10. Tests

- **Unit:** `tests/unit/v4.test.ts`, 28 tests:
  - rules, Wood fake-outs, Stone memory and the 4-button cap, layout;
  - construction, sessions, caps, cooldowns, the commit;
  - auto workers (ratio and idempotency);
  - the full pool cycle, uniqueness, holding period, refusing simulated revenue in live mode, and
    separating money from play.

  Two existing tests were updated for the 7-day authorised fallback. **84/84 pass.**
- **E2E:** `tests/e2e/v4-town.spec.ts`: the overworld enters a town; deposit → building → the
  server-picked game → quit commits once → forged rewards ignored; the pool page discloses its rules.
  **5 passed, 1 skipped** (a mobile duplicate).
- **Manual in-app run (sandbox, 2026-11-11):**
  - Wood round: 5 Perfect, +3.3 Wood, server-confirmed.
  - Stone: 5 rounds all Perfect, ×18 combo, 1 → 2 buttons.
  - A harvested parcel of exactly 2 fruits went pending, then delivered after the payout.
  - A full simulated pool month: $40 × 50% → 1 tree × $20 → choice → council approval → executed →
    **reconciled**, with the snapshot hash verified.

## 11. Not done / blockers

- ⛔ Real ad network: provider choice, policy review, consent.
- ⛔ Live Sputnik DAO: create it (for example in Trezu), set the council, give Hugshire only the
  proposer role, and set `POOL_DAO_ACCOUNT`, `POOL_PROPOSER_*`. The adapter is written but has not
  been run against mainnet.
- ⛔ Privacy-preserving uniqueness provider for live mode. Sandbox uses a stand-in attestation;
  Privy alone does not prove one person = one account.
- 🟡 Presence is single-instance and in memory.
- 🟡 Mini-game art is drawn in code plus the existing mascot side sprites. Bespoke animation frames
  (chop and strike poses) would add polish.
- 🟡 The live app still reads balances from the ledger cache, not `vault.get_member` (unchanged, see
  KNOWN_LIMITATIONS).
- Not production-ready: needs an audit, legal review of the pool and ad messaging, and load testing.


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
