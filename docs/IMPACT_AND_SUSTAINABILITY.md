# Impact and sustainability

Hugshire's aim is to make charitable participation financially accessible, socially engaging and sustainable. This document explains how impact is created, how it will be measured, and why the model is built to last.

**Three kinds of impact are kept strictly apart:**
- **charitable value** that has actually been transferred
- **participation** on the platform
- **organisation-reported outcomes**

None of them is presented as one of the others.

---

## 1. Financial impact

**How it's created:**
- **Charitable yield:** the yield on supporters' deposits, delivered as Heart Fruit to the causes they choose, by hand or through authorised daily auto-send.
- **Community Heart Pool:** a published share of received ad revenue, split equally among eligible supporters and directed by each of them to an approved cause.

**What counts as a transfer:** only **confirmed** payouts. A delivery is "Delivered" only after the payout to the cause's verified account is confirmed. On NEAR, every payout is a transaction with a public record.

**Current state:**
- **Real-money transfers:** begin with the mainnet launch.
- **Today's demonstration:** NEAR testnet transfers using test USDC. They show the full path: deposit → Vault → lending → donation to the cause's wallet → withdrawal, plus treasury payouts. They are not charitable donations of real money.

| Metric | Source in the system |
|---|---|
| Charitable value transferred | confirmed `charity_payouts`, executed `pool_payouts`, and onchain records (`chain_txs` on testnet) |
| Number of confirmed payouts | `charity_payouts` (status confirmed) and `pool_payouts` (status executed) |
| Causes supported | distinct causes with confirmed payouts |
| Distribution across causes | value per cause per month |
| Recurring support | supporters with auto-send authorised; deliveries per supporter per month |

## 2. Participation impact

Hugshire gives people more ways to take part than giving money: exploring towns, playing, building together and following organisations.

| Metric | Source in the system |
|---|---|
| Active and returning supporters | sessions, journeys, game sessions over time |
| Wood contributed | `resource_contributions` |
| Buildings completed | `construction_projects` (status completed) |
| Unique contributors per building | distinct users per project in `resource_contributions` |
| Towns visited | town page visits and presence |
| Optional ad views | `ad_views` (engagement only, never counted as revenue) |

These measure **engagement with the platform**. They are not charitable dollars and not verified social outcomes. A completed virtual building shows that a community came together in the game; it is not evidence of real-world impact.

## 3. Organisation visibility and storytelling

Every town has a **Notice Board**. Organisations publish:
- activity updates and photos
- community stories
- progress reports
- outcomes with supporting evidence (photo, video or link)

**How posts are labelled:**
- **"Reported by the organisation"** is the default.
- **"Verified"** appears only after Hugshire has checked the evidence.

Players can report posts, and admins can hide or restore them (audited).

**Why it matters:** supporters can see the organisation behind each town and follow its progress in the same place they send their support. The financial record (payouts) and the story (posts) sit side by side, yet stay distinguishable.

---

## 4. Measurement framework (proposed)

| Layer | Question | Indicators | Evidence standard |
|---|---|---|---|
| Inputs | How much support is available? | deposits supplied; ripe yield; received ad revenue | ledger, reconciled every 10 minutes against pool and chain state |
| Outputs | What reached causes? | confirmed payouts; value per cause; recurring deliveries | payout confirmations; onchain transaction records |
| Participation | Are people coming back and taking part? | returning supporters; contributors per building; towns visited | platform analytics (no personal data in public reports) |
| Organisation outcomes | What did organisations achieve? | Notice Board reports with evidence | "Reported" vs "Verified" labels; periodic evidence checks |
| Learning | Is the model working? | supporter retention; share of supporters on auto-send; cause diversity | to be measured after launch; no retention claims before data exists |

**Public reporting (planned):**
- A per-cause impact page: confirmed transfers, recurring supporters and the latest verified updates.
- A monthly Community Pool report with its published snapshot hash.

---

## 5. Sustainable participation

- **Lower barrier:** supporting a cause does not require giving up savings. Principal stays attributable to the supporter and can be requested back, subject to lending risk, liquidity and fees.
- **Less appeal fatigue:** support recurs through yield and daily auto-send rather than repeated requests.
- **Ongoing engagement:** shared towns, construction goals, helpers, exploration and stories invite people back. More visits mean more chances to discover causes.
- **Broader base:** the Community Heart Pool gives every eligible supporter an equal voice in directing shared funds, whatever their deposit size.

## 6. Diversified charitable funding

Organisations benefit from more than one source:
1. **Yield** from many supporters' deposits: recurring, and independent of new campaigns.
2. **Community Pool** funds from received advertising revenue, allocated by the community.

Both sources are measured, published and paid only to verified cause accounts.

## 7. Long-term sustainability strategy

| Pillar | How |
|---|---|
| Operations funded by the model | a disclosed platform share of eligible yield and of received ad revenue (see [Business model](BUSINESS_MODEL.md)) |
| Trust | separated ledgers, reconciliation, published pool snapshots, onchain records, audited contracts before mainnet |
| Growth | more organisations and towns, live ad partnerships, new environments and activities |
| Governance | Community Pool payouts approved by a DAO council (Sputnik DAO in Trezu) on mainnet |
| Honest measurement | separate metrics for money, participation and organisation-reported outcomes; claims only after the data exists |

**The long-term opportunity:** turn one-off charitable transactions into recurring participation and lasting relationships between supporters and the organisations they care about.
