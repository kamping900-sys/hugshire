/**
 * Community Heart Pool (domain B). A separate charitable treasury funded only by FINALIZED,
 * RECEIVED advertising revenue × a publicly disclosed charity percentage. Never touches supporters'
 * principal, vault shares or vault yield. Ledger accounts live in the "pool:" namespace.
 *
 * Monthly cycle:
 *   revenue_reported → revenue_finalized → budget_transferred → treasury_funded →
 *   snapshot_finalized → allocations_calculated → choosing → payouts_prepared →
 *   awaiting_approval → executed → reconciled
 *
 * Equal allocation (community Option A): per_tree = floor(distributable / eligible_count), in
 * integer micro-USDC. One allocation per eligible unique supporter per cycle. It does not depend on
 * deposit size, Wood/Stone, games, ads, combos, wallets or workers. The remainder carries forward.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  adRevenueReports,
  causes,
  helperPreferences,
  helpers,
  identityAttestations,
  ledgerEntries,
  ledgerJournals,
  organizations,
  poolAllocations,
  poolCycles,
  poolEligibility,
  poolPayouts,
  supportPositions,
  treasuryProposals,
  users,
  POOL_CYCLE_STATUSES,
  type PoolCycleStatus,
} from "../db/schema";
import { AppError, acct, audit, getSettings, liabilityBalance, accountSum, notFound, postJournal, forbidden } from "../core";
import { allocateProRata } from "@/lib/money";
import { inTx, type Ctx } from "./context";
import { isDeliverable } from "./deliveries";
import { treasury, type TreasuryProvider } from "../providers/treasury";

export const poolAcct = {
  inTransit: "pool:treasury_in_transit",
  treasury: "pool:treasury",
  commitment: "pool:charity_commitment",
  alloc: (u: string) => `pool:alloc:${u}`,
  payable: (c: string) => `pool:cause:${c}:payable`,
  revenueShare: "pool:hugshire_revenue_share",
} as const;

export const DEFAULT_BENEFICIARY_RULE =
  "If you don't choose by the deadline, your golden fruit goes to your default cause from Delivery settings, else the cause you chose most recently, else your helper's home town. If none of these can receive funds, it is carried forward into next month's pool and shared equally again.";

const tp = (ctx: Ctx): TreasuryProvider => treasury(ctx.db, ctx.environment);

function nextOk(from: PoolCycleStatus, to: PoolCycleStatus) {
  const a = POOL_CYCLE_STATUSES.indexOf(from), b = POOL_CYCLE_STATUSES.indexOf(to);
  if (b !== a + 1) throw new AppError("bad_cycle_state", `Cycle is "${from}"; it cannot move to "${to}".`, 409);
}

async function move(ctx: Ctx, cycleId: string, to: PoolCycleStatus, by: string | null, note?: string, extra: Partial<typeof poolCycles.$inferInsert> = {}) {
  const [c] = await ctx.db.select().from(poolCycles).where(eq(poolCycles.id, cycleId));
  if (!c) throw notFound("Cycle not found");
  nextOk(c.status, to);
  const history = [...c.history, { status: to, at: ctx.now().toISOString(), by: by ?? undefined, note }];
  const [u] = await ctx.db.update(poolCycles).set({ ...extra, status: to, history }).where(and(eq(poolCycles.id, cycleId), eq(poolCycles.status, c.status))).returning();
  if (!u) throw new AppError("bad_cycle_state", "The cycle changed concurrently; refresh.", 409);
  await audit(ctx.db, { actorId: by, actorType: by ? "admin" : "system", action: `pool.${to}`, targetType: "pool_cycle", targetId: cycleId, data: note ? { note } : undefined });
  return u;
}

export async function getCycle(ctx: Ctx, cycleId: string) {
  const [c] = await ctx.db.select().from(poolCycles).where(eq(poolCycles.id, cycleId));
  if (!c) throw notFound("Cycle not found");
  return c;
}

// ───────────────────────────── 1. revenue ─────────────────────────────

export async function reportRevenue(ctx: Ctx, adminId: string, i: { period: string; provider: string; source: "simulated" | "provider_statement"; externalRef: string; grossMicro: bigint; note?: string }) {
  if (!/^\d{4}-\d{2}$/.test(i.period)) throw new AppError("bad_period", "Period must look like 2026-11.");
  if (i.source === "simulated" && ctx.environment === "live") throw new AppError("simulated_in_live", "Simulated revenue can never be recorded in live mode.");
  if (i.grossMicro <= 0n) throw new AppError("bad_amount", "Revenue must be positive.");
  const s = await getSettings(ctx.db);
  let [c] = await ctx.db.select().from(poolCycles).where(and(eq(poolCycles.environment, ctx.environment), eq(poolCycles.period, i.period)));
  if (!c) {
    [c] = await ctx.db
      .insert(poolCycles)
      .values({ environment: ctx.environment, period: i.period, charityBps: s.poolCharityBps, history: [{ status: "revenue_reported", at: ctx.now().toISOString(), by: adminId }] })
      .onConflictDoNothing()
      .returning();
    if (!c) [c] = await ctx.db.select().from(poolCycles).where(and(eq(poolCycles.environment, ctx.environment), eq(poolCycles.period, i.period)));
  }
  if (c.status !== "revenue_reported") throw new AppError("cycle_closed", "Revenue for this period is already finalized. Adjustments go into a later cycle.");
  const [r] = await ctx.db
    .insert(adRevenueReports)
    .values({ cycleId: c.id, provider: i.provider, source: i.source, externalRef: i.externalRef, grossMicro: i.grossMicro, note: i.note })
    .onConflictDoNothing()
    .returning();
  if (!r) throw new AppError("duplicate_report", "That provider statement was already recorded.");
  if (i.source === "simulated" && !c.simulated) await ctx.db.update(poolCycles).set({ simulated: true }).where(eq(poolCycles.id, c.id));
  await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "pool.revenue_reported", targetType: "ad_revenue_report", targetId: r.id, data: { source: i.source, grossMicro: i.grossMicro } });
  return { cycle: c, report: r };
}

/** Revenue counts only once it has actually been received (not estimated earnings). */
export async function markRevenueReceived(ctx: Ctx, adminId: string, reportId: string) {
  const [r] = await ctx.db.update(adRevenueReports).set({ receivedAt: ctx.now() }).where(and(eq(adRevenueReports.id, reportId), eq(adRevenueReports.status, "reported"))).returning();
  if (!r) throw new AppError("bad_state", "Only open reports can be marked received.");
  await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "pool.revenue_received", targetType: "ad_revenue_report", targetId: reportId });
  return r;
}

/** Before finalization a report can be reversed outright. After it, adjustments reduce a later cycle's budget, never principal. */
export async function reverseRevenue(ctx: Ctx, adminId: string, reportId: string, note: string) {
  const [r] = await ctx.db.select({ r: adRevenueReports, status: poolCycles.status }).from(adRevenueReports).innerJoin(poolCycles, eq(poolCycles.id, adRevenueReports.cycleId)).where(eq(adRevenueReports.id, reportId));
  if (!r) throw notFound();
  if (r.status !== "revenue_reported") throw new AppError("cycle_closed", "This cycle is finalized; record the adjustment against a later cycle.");
  await ctx.db.update(adRevenueReports).set({ status: "reversed", note }).where(eq(adRevenueReports.id, reportId));
  await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "pool.revenue_reversed", targetType: "ad_revenue_report", targetId: reportId, data: { note } });
}

export async function finalizeRevenue(ctx: Ctx, adminId: string, cycleId: string) {
  const s = await getSettings(ctx.db);
  if (s.poolCharityBps <= 0 || s.poolCharityBps > 10000) throw new AppError("charity_share_unset", "Set and publish the charity share of ad revenue (Admin → Community Pool) before finalizing.");
  const reports = await ctx.db.select().from(adRevenueReports).where(and(eq(adRevenueReports.cycleId, cycleId), eq(adRevenueReports.status, "reported")));
  if (!reports.length) throw new AppError("no_revenue", "There is no revenue to finalize.");
  if (reports.some((r) => !r.receivedAt)) throw new AppError("not_received", "Every report must be marked as actually received first.");
  const revenue = reports.reduce((a, r) => a + r.grossMicro, 0n);
  const budget = (revenue * BigInt(s.poolCharityBps)) / 10_000n;
  const carryIn = await liabilityBalance(ctx.db, ctx.environment, poolAcct.commitment);
  await ctx.db.update(adRevenueReports).set({ status: "finalized" }).where(and(eq(adRevenueReports.cycleId, cycleId), eq(adRevenueReports.status, "reported")));
  return move(ctx, cycleId, "revenue_finalized", adminId, `revenue ${revenue} × ${s.poolCharityBps} bps = ${budget}`, {
    revenueFinalizedMicro: revenue,
    charityBudgetMicro: budget,
    charityBps: s.poolCharityBps,
    carryInMicro: carryIn,
  });
}

// ───────────────────────────── 2. treasury funding ─────────────────────────────

export async function transferBudget(ctx: Ctx, adminId: string, cycleId: string, txHash?: string) {
  const c = await getCycle(ctx, cycleId);
  if (c.status !== "revenue_finalized") nextOk(c.status, "budget_transferred");
  return inTx(ctx, async (tx) => {
    if (c.charityBudgetMicro > 0n)
      await postJournal(tx.db, {
        environment: tx.environment,
        kind: "pool_budget_transferred",
        refType: "pool_cycle",
        refId: cycleId,
        at: tx.now(),
        entries: [
          { account: poolAcct.inTransit, amount: c.charityBudgetMicro },
          { account: poolAcct.commitment, amount: -c.charityBudgetMicro },
        ],
      });
    return move(tx, cycleId, "budget_transferred", adminId, txHash ? `transfer ${txHash}` : undefined, { fundingTxHash: txHash ?? null });
  });
}

export async function confirmFunding(ctx: Ctx, adminId: string, cycleId: string, txHash?: string) {
  const c = await getCycle(ctx, cycleId);
  nextOk(c.status, "treasury_funded");
  const r = await tp(ctx).fund({ cycleId, amountMicro: c.charityBudgetMicro, txHash: txHash ?? c.fundingTxHash ?? undefined });
  return inTx(ctx, async (tx) => {
    if (c.charityBudgetMicro > 0n)
      await postJournal(tx.db, {
        environment: tx.environment,
        kind: "pool_treasury_funded",
        refType: "pool_cycle",
        refId: cycleId,
        at: tx.now(),
        entries: [
          { account: poolAcct.treasury, amount: c.charityBudgetMicro },
          { account: poolAcct.inTransit, amount: -c.charityBudgetMicro },
        ],
      });
    return move(tx, cycleId, "treasury_funded", adminId, `funded ${r.txHash}`, { treasuryFundedMicro: c.charityBudgetMicro, fundingTxHash: r.txHash });
  });
}

// ───────────────────────────── 3. eligibility snapshot ─────────────────────────────

/** Lowest principal balance held over [from, at], from the ledger (withdrawals count immediately). */
async function minPrincipalOver(ctx: Ctx, userId: string, from: Date, at: Date): Promise<bigint> {
  const account = acct.userPrincipal(userId);
  const entries = await ctx.db
    .select({ amount: ledgerEntries.amountMicro, at: ledgerEntries.createdAt })
    .from(ledgerEntries)
    .innerJoin(ledgerJournals, eq(ledgerJournals.id, ledgerEntries.journalId))
    .where(and(eq(ledgerEntries.account, account), eq(ledgerJournals.environment, ctx.environment), lte(ledgerEntries.createdAt, at)))
    .orderBy(asc(ledgerEntries.createdAt));
  let bal = 0n; // principal is a liability (credit-normal): balance = -sum
  let min: bigint | null = null;
  for (const e of entries) {
    if (e.at <= from) {
      bal += -e.amount;
      continue;
    }
    if (min === null) min = bal; // balance held at the start of the window
    bal += -e.amount;
    if (bal < min) min = bal;
  }
  return min === null ? bal : min;
}

export async function evaluateEligibility(ctx: Ctx, userId: string, at: Date) {
  const s = await getSettings(ctx.db);
  const reasons: string[] = [];
  const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!u || u.status !== "active") reasons.push("account_not_active");
  if (u && s.poolAccountAgeDays > 0 && u.createdAt.getTime() > at.getTime() - s.poolAccountAgeDays * 86400_000) reasons.push(`account_younger_than_${s.poolAccountAgeDays}_days`);
  const minBal = await minPrincipalOver(ctx, userId, new Date(at.getTime() - s.poolHoldingDays * 86400_000), at);
  if (minBal < BigInt(s.poolMinDepositMicro)) reasons.push(`held_less_than_minimum_for_${s.poolHoldingDays}_days`);
  const [att] = await ctx.db.select().from(identityAttestations).where(eq(identityAttestations.userId, userId));
  if (!att || att.status !== "verified") reasons.push("uniqueness_not_verified");
  return { eligible: reasons.length === 0, reasons, uniquenessKey: att && att.status === "verified" ? `${att.provider}:${att.subjectHash}` : null };
}

export const pseudonym = (cycleId: string, userId: string) => createHash("sha256").update(`hugshire-pool:${cycleId}:${userId}`).digest("hex").slice(0, 20);

function snapshotDoc(c: typeof poolCycles.$inferSelect, pseudonyms: string[]) {
  return {
    version: 1,
    cycle: c.id,
    period: c.period,
    simulated: c.simulated,
    charityBps: c.charityBps,
    revenueFinalizedMicro: c.revenueFinalizedMicro.toString(),
    charityBudgetMicro: c.charityBudgetMicro.toString(),
    carryInMicro: c.carryInMicro.toString(),
    eligible: [...pseudonyms].sort(),
  };
}
const hashDoc = (d: unknown) => createHash("sha256").update(JSON.stringify(d)).digest("hex");

export async function finalizeSnapshot(ctx: Ctx, adminId: string, cycleId: string) {
  const c = await getCycle(ctx, cycleId);
  nextOk(c.status, "snapshot_finalized");
  const at = ctx.now();
  const candidates = await ctx.db.select({ userId: supportPositions.userId }).from(supportPositions).where(eq(supportPositions.environment, ctx.environment));
  const overrides = new Map((await ctx.db.select().from(poolEligibility).where(eq(poolEligibility.cycleId, cycleId))).map((r) => [r.userId, r]));
  const seen = new Set<string>();
  const eligibleIds: string[] = [];
  for (const { userId } of candidates) {
    const ev = await evaluateEligibility(ctx, userId, at);
    const o = overrides.get(userId);
    let eligible = ev.eligible;
    const reasons = [...ev.reasons];
    if (o?.overrideBy) {
      eligible = o.eligible && !!ev.uniquenessKey; // an override can never bypass uniqueness
      reasons.push(`override:${o.overrideNote ?? ""}`);
    }
    if (eligible && ev.uniquenessKey && seen.has(ev.uniquenessKey)) {
      eligible = false;
      reasons.push("duplicate_identity");
    }
    if (eligible && ev.uniquenessKey) seen.add(ev.uniquenessKey);
    await ctx.db
      .insert(poolEligibility)
      .values({ cycleId, userId, eligible, reasons, uniquenessKey: eligible ? ev.uniquenessKey : null, overrideBy: o?.overrideBy ?? null, overrideNote: o?.overrideNote ?? null })
      .onConflictDoUpdate({ target: [poolEligibility.cycleId, poolEligibility.userId], set: { eligible, reasons, uniquenessKey: eligible ? ev.uniquenessKey : null } });
    if (eligible) eligibleIds.push(userId);
  }
  const doc = snapshotDoc(c, eligibleIds.map((u) => pseudonym(cycleId, u)));
  return move(ctx, cycleId, "snapshot_finalized", adminId, `${eligibleIds.length} eligible`, { eligibleCount: eligibleIds.length, snapshotHash: hashDoc(doc), snapshotAt: at });
}

/** Appeals / corrections before the snapshot is finalized. Logged and shown in the audit trail. */
export async function overrideEligibility(ctx: Ctx, adminId: string, cycleId: string, userId: string, eligible: boolean, note: string) {
  const c = await getCycle(ctx, cycleId);
  if (POOL_CYCLE_STATUSES.indexOf(c.status) >= POOL_CYCLE_STATUSES.indexOf("snapshot_finalized")) throw new AppError("snapshot_final", "The snapshot is final. Corrections apply to the next cycle.");
  await ctx.db
    .insert(poolEligibility)
    .values({ cycleId, userId, eligible, reasons: [], overrideBy: adminId, overrideNote: note })
    .onConflictDoUpdate({ target: [poolEligibility.cycleId, poolEligibility.userId], set: { eligible, overrideBy: adminId, overrideNote: note } });
  await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "pool.eligibility_override", targetType: "user", targetId: userId, data: { cycleId, eligible, note } });
}

// ───────────────────────────── 4. equal allocation ─────────────────────────────

export function equalSplit(distributable: bigint, count: number) {
  if (count <= 0) return { perTree: 0n, remainder: distributable };
  const perTree = distributable / BigInt(count); // floor
  return { perTree, remainder: distributable - perTree * BigInt(count) };
}

export async function calculateAllocations(ctx: Ctx, adminId: string, cycleId: string) {
  const c = await getCycle(ctx, cycleId);
  nextOk(c.status, "allocations_calculated");
  const s = await getSettings(ctx.db);
  const elig = await ctx.db.select().from(poolEligibility).where(and(eq(poolEligibility.cycleId, cycleId), eq(poolEligibility.eligible, true)));
  const distributable = c.charityBudgetMicro + c.carryInMicro;
  const { perTree, remainder } = equalSplit(distributable, elig.length);
  return inTx(ctx, async (tx) => {
    if (perTree > 0n) {
      for (const e of elig) {
        const [a] = await tx.db.insert(poolAllocations).values({ cycleId, userId: e.userId, amountMicro: perTree, createdAt: tx.now() }).onConflictDoNothing().returning();
        if (!a) continue;
        await postJournal(tx.db, {
          environment: tx.environment,
          kind: "pool_allocated",
          refType: "pool_allocation",
          refId: a.id,
          at: tx.now(),
          entries: [
            { account: poolAcct.commitment, amount: perTree },
            { account: poolAcct.alloc(e.userId), amount: -perTree },
          ],
        });
      }
    }
    await move(tx, cycleId, "allocations_calculated", adminId, `${elig.length} × ${perTree}, remainder ${remainder}`, { perTreeMicro: perTree, remainderMicro: remainder });
    return move(tx, cycleId, "choosing", adminId, undefined, { choiceDeadline: new Date(tx.now().getTime() + s.poolChoiceDays * 86400_000) });
  });
}

// ───────────────────────────── 5. choosing causes ─────────────────────────────

export async function chooseCauses(ctx: Ctx, userId: string, allocationId: string, choices: { causeId: string; bps: number }[]) {
  const [a] = await ctx.db.select({ a: poolAllocations, status: poolCycles.status, deadline: poolCycles.choiceDeadline }).from(poolAllocations).innerJoin(poolCycles, eq(poolCycles.id, poolAllocations.cycleId)).where(eq(poolAllocations.id, allocationId));
  if (!a) throw notFound();
  if (a.a.userId !== userId) throw forbidden();
  if (a.status !== "choosing" || (a.deadline && ctx.now() > a.deadline)) throw new AppError("choice_closed", "Choices for this month are closed.");
  if (!choices.length || choices.length > 3) throw new AppError("bad_choices", "Pick between one and three causes.");
  if (choices.reduce((x, c) => x + c.bps, 0) !== 10000 || choices.some((c) => c.bps <= 0)) throw new AppError("bad_split", "Shares must add up to 100%.");
  for (const c of choices) if (!(await isDeliverable(ctx, c.causeId))) throw new AppError("cause_not_deliverable", "One of those causes cannot receive funds right now.");
  await ctx.db.update(poolAllocations).set({ choices, choiceSource: "user", status: "chosen" }).where(eq(poolAllocations.id, allocationId));
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "pool.choice", targetType: "pool_allocation", targetId: allocationId, data: { choices } });
}

async function defaultBeneficiary(ctx: Ctx, userId: string): Promise<string | null> {
  const [p] = await ctx.db.select().from(helperPreferences).where(eq(helperPreferences.userId, userId));
  const hs = await ctx.db.select().from(helpers).where(eq(helpers.userId, userId));
  const home = hs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.causeId;
  for (const c of [p?.defaultCauseId, p?.lastSelectedCauseId, home]) if (c && (await isDeliverable(ctx, c))) return c;
  return null;
}

// ───────────────────────────── 6. payouts ─────────────────────────────

export async function preparePayouts(ctx: Ctx, adminId: string | null, cycleId: string, opts: { force?: boolean } = {}) {
  const c = await getCycle(ctx, cycleId);
  nextOk(c.status, "payouts_prepared");
  if (!opts.force && c.choiceDeadline && ctx.now() < c.choiceDeadline) throw new AppError("choice_open", "Supporters can still choose until the deadline.");
  if (opts.force && ctx.environment === "live") throw new AppError("no_force_live", "The choice window cannot be cut short in live mode.");
  const allocs = await ctx.db.select().from(poolAllocations).where(eq(poolAllocations.cycleId, cycleId));
  const perCause = new Map<string, bigint>();
  return inTx(ctx, async (tx) => {
    for (const a of allocs) {
      let choices = a.choices;
      let source = a.choiceSource;
      if (a.status === "allocated") {
        const d = await defaultBeneficiary(tx, a.userId);
        choices = d ? [{ causeId: d, bps: 10000 }] : [];
        source = d ? "default_beneficiary" : "carried_forward";
      }
      const live: { causeId: string; bps: number }[] = [];
      for (const ch of choices) if (await isDeliverable(tx, ch.causeId)) live.push(ch);
      if (!live.length) {
        // disclosed rule: carry forward into next month's pool
        await postJournal(tx.db, { environment: tx.environment, kind: "pool_carried_forward", refType: "pool_allocation", refId: a.id, at: tx.now(), entries: [{ account: poolAcct.alloc(a.userId), amount: a.amountMicro }, { account: poolAcct.commitment, amount: -a.amountMicro }] });
        await tx.db.update(poolAllocations).set({ status: "carried_forward", choiceSource: "carried_forward", choices: [] }).where(eq(poolAllocations.id, a.id));
        continue;
      }
      const parts = allocateProRata(a.amountMicro, live.map((x) => BigInt(x.bps)));
      const entries = [{ account: poolAcct.alloc(a.userId), amount: a.amountMicro }];
      live.forEach((ch, k) => {
        if (parts[k] <= 0n) return;
        perCause.set(ch.causeId, (perCause.get(ch.causeId) ?? 0n) + parts[k]);
        entries.push({ account: poolAcct.payable(ch.causeId), amount: -parts[k] });
      });
      await postJournal(tx.db, { environment: tx.environment, kind: "pool_assigned", refType: "pool_allocation", refId: a.id, at: tx.now(), entries });
      await tx.db.update(poolAllocations).set({ choices: live, choiceSource: source, status: "chosen" }).where(eq(poolAllocations.id, a.id));
    }
    for (const [causeId, amount] of perCause) {
      const [row] = await tx.db.select({ dest: organizations.payoutNearAccount }).from(causes).innerJoin(organizations, eq(organizations.id, causes.orgId)).where(eq(causes.id, causeId));
      await tx.db.insert(poolPayouts).values({ cycleId, causeId, amountMicro: amount, destinationAccount: row?.dest ?? "unknown" }).onConflictDoNothing();
    }
    return move(tx, cycleId, "payouts_prepared", adminId, `${perCause.size} causes`);
  });
}

export async function proposePayouts(ctx: Ctx, adminId: string, cycleId: string) {
  const c = await getCycle(ctx, cycleId);
  nextOk(c.status, "awaiting_approval");
  const ps = await ctx.db.select().from(poolPayouts).where(and(eq(poolPayouts.cycleId, cycleId), eq(poolPayouts.status, "prepared")));
  const t = tp(ctx);
  for (const p of ps) {
    const { proposalId } = await t.propose({ payoutId: p.id, receiver: p.destinationAccount, amountMicro: p.amountMicro, description: `Hugshire Community Heart Pool ${c.period}${c.simulated ? " (SIMULATED revenue, test assets)" : ""}: equal allocations directed to this cause` });
    await ctx.db.update(poolPayouts).set({ status: "proposed", proposalId }).where(and(eq(poolPayouts.id, p.id), eq(poolPayouts.status, "prepared")));
  }
  return move(ctx, cycleId, "awaiting_approval", adminId, `${ps.length} proposals via ${t.name}`);
}

/** Sandbox DAO only: a council member approves. Live approvals happen in the Sputnik DAO (Trezu). */
export async function approveProposal(ctx: Ctx, member: { id: string; email: string }, proposalId: string) {
  if (ctx.environment === "live") throw new AppError("use_dao", "Approve this payment in the community treasury (Trezu / Sputnik DAO).");
  const info = await tp(ctx).info();
  if (!info.council.includes(member.email.toLowerCase())) throw forbidden("Only treasury council members can approve.");
  return inTx(ctx, async (tx) => {
    const locked = await tx.db.execute(sql`select id from treasury_proposals where id = ${proposalId} for update`);
    void locked;
    const [p] = await tx.db.select().from(treasuryProposals).where(eq(treasuryProposals.id, proposalId));
    if (!p) throw notFound();
    if (p.status !== "in_progress") return p;
    if (p.approvals.some((a) => a.member === member.email)) throw new AppError("already_voted", "You already approved this proposal.");
    const approvals = [...p.approvals, { member: member.email, at: tx.now().toISOString() }];
    const done = approvals.length >= p.threshold;
    const [u] = await tx.db
      .update(treasuryProposals)
      .set({ approvals, status: done ? "executed" : "in_progress", txHash: done ? `sandbox-dao-transfer-${p.id.slice(0, 8)}` : null })
      .where(eq(treasuryProposals.id, p.id))
      .returning();
    await audit(tx.db, { actorId: member.id, actorType: "admin", action: "pool.proposal_approved", targetType: "treasury_proposal", targetId: p.id, data: { approvals: approvals.length, threshold: p.threshold } });
    return u;
  });
}

/** Reads proposal status from the treasury and books executed payments exactly once. */
export async function syncPayouts(ctx: Ctx, cycleId: string) {
  const c = await getCycle(ctx, cycleId);
  if (c.status !== "awaiting_approval") return { synced: 0 };
  const t = tp(ctx);
  const ps = await ctx.db.select().from(poolPayouts).where(eq(poolPayouts.cycleId, cycleId));
  let synced = 0;
  for (const p of ps) {
    if (p.status !== "proposed" || !p.proposalId) continue;
    const st = await t.status(p.proposalId);
    if (st.status === "executed") {
      await inTx(ctx, async (tx) => {
        const first = await postJournal(tx.db, { environment: tx.environment, kind: "pool_paid", refType: "pool_payout", refId: p.id, at: tx.now(), entries: [{ account: poolAcct.payable(p.causeId), amount: p.amountMicro }, { account: poolAcct.treasury, amount: -p.amountMicro }] });
        if (first) await tx.db.update(poolPayouts).set({ status: "executed", txHash: st.txHash ?? null, executedAt: tx.now() }).where(eq(poolPayouts.id, p.id));
      });
      synced++;
    } else if (st.status === "rejected" || st.status === "failed") {
      await ctx.db.update(poolPayouts).set({ status: st.status === "rejected" ? "rejected" : "failed", failureReason: `treasury proposal ${st.status}` }).where(eq(poolPayouts.id, p.id));
    }
  }
  const after = await ctx.db.select().from(poolPayouts).where(eq(poolPayouts.cycleId, cycleId));
  if (after.length && after.every((p) => p.status === "executed")) {
    const paidCauses = after.map((p) => p.causeId);
    const chosen = await ctx.db.select().from(poolAllocations).where(and(eq(poolAllocations.cycleId, cycleId), eq(poolAllocations.status, "chosen")));
    for (const a of chosen) if (a.choices.every((ch) => paidCauses.includes(ch.causeId))) await ctx.db.update(poolAllocations).set({ status: "paid" }).where(eq(poolAllocations.id, a.id));
    await move(ctx, cycleId, "executed", null, `${after.length} payments executed`);
  }
  return { synced };
}

/** A failed or rejected payment can be re-proposed (new proposal, same payout id: never paid twice). */
export async function reproposePayout(ctx: Ctx, adminId: string, payoutId: string) {
  const [p] = await ctx.db.select({ p: poolPayouts, period: poolCycles.period }).from(poolPayouts).innerJoin(poolCycles, eq(poolCycles.id, poolPayouts.cycleId)).where(eq(poolPayouts.id, payoutId));
  if (!p || !["failed", "rejected"].includes(p.p.status)) throw new AppError("bad_state", "Only failed or rejected payments can be re-proposed.");
  await ctx.db.delete(treasuryProposals).where(and(eq(treasuryProposals.payoutId, payoutId), inArray(treasuryProposals.status, ["failed", "rejected"])));
  const { proposalId } = await tp(ctx).propose({ payoutId, receiver: p.p.destinationAccount, amountMicro: p.p.amountMicro, description: `Hugshire Community Heart Pool ${p.period} (re-proposed)` });
  await ctx.db.update(poolPayouts).set({ status: "proposed", proposalId, failureReason: null }).where(eq(poolPayouts.id, payoutId));
  await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "pool.reproposed", targetType: "pool_payout", targetId: payoutId });
}

// ───────────────────────────── 7. reconciliation ─────────────────────────────

export async function reconcileCycle(ctx: Ctx, adminId: string | null, cycleId: string) {
  const c = await getCycle(ctx, cycleId);
  const allocs = await ctx.db.select().from(poolAllocations).where(eq(poolAllocations.cycleId, cycleId));
  const payouts = await ctx.db.select().from(poolPayouts).where(eq(poolPayouts.cycleId, cycleId));
  const problems: string[] = [];
  const allocated = allocs.reduce((a, x) => a + x.amountMicro, 0n);
  if (allocated !== c.perTreeMicro * BigInt(allocs.length)) problems.push("allocations are not all equal");
  if (allocs.length !== c.eligibleCount) problems.push("allocation count differs from the eligible count");
  if (allocated + c.remainderMicro !== c.charityBudgetMicro + c.carryInMicro) problems.push("budget + carry-in != allocations + remainder");
  const carried = allocs.filter((a) => a.status === "carried_forward").reduce((x, a) => x + a.amountMicro, 0n);
  const paid = payouts.reduce((x, p) => x + p.amountMicro, 0n);
  if (paid + carried !== allocated) problems.push("payouts + carried-forward != allocations");
  if (payouts.some((p) => p.status !== "executed")) problems.push("some payouts are not executed");
  for (const a of allocs) {
    const bal = await accountSum(ctx.db, ctx.environment, poolAcct.alloc(a.userId));
    if (bal !== 0n && a.status !== "carried_forward") problems.push(`allocation account not cleared for one supporter`);
  }
  if (problems.length) return { ok: false as const, problems };
  if (c.status === "executed") await move(ctx, cycleId, "reconciled", adminId, "all checks passed");
  return { ok: true as const, problems };
}

// ───────────────────────────── public views ─────────────────────────────

export async function publicSnapshot(ctx: Ctx, cycleId: string) {
  const c = await getCycle(ctx, cycleId);
  if (!c.snapshotHash) throw new AppError("no_snapshot", "The eligibility snapshot is not finalized yet.");
  const elig = await ctx.db.select().from(poolEligibility).where(and(eq(poolEligibility.cycleId, cycleId), eq(poolEligibility.eligible, true)));
  const doc = snapshotDoc(c, elig.map((e) => pseudonym(cycleId, e.userId)));
  const payouts = await ctx.db.select({ p: poolPayouts, title: causes.title }).from(poolPayouts).innerJoin(causes, eq(causes.id, poolPayouts.causeId)).where(eq(poolPayouts.cycleId, cycleId));
  return {
    snapshot: doc,
    snapshotHash: c.snapshotHash,
    recomputedHash: hashDoc(doc),
    allocation: { eligibleCount: c.eligibleCount, perTreeMicro: c.perTreeMicro.toString(), remainderMicro: c.remainderMicro.toString(), formula: "per_tree = floor((charity_budget + carry_in) / eligible_count)" },
    payouts: payouts.map((x) => ({ cause: x.title, amountMicro: x.p.amountMicro.toString(), status: x.p.status, proposalId: x.p.proposalId, txHash: x.p.txHash, destination: x.p.destinationAccount })),
    status: c.status,
    history: c.history,
  };
}

export async function poolOverview(ctx: Ctx) {
  const s = await getSettings(ctx.db);
  const cycles = await ctx.db.select().from(poolCycles).where(eq(poolCycles.environment, ctx.environment)).orderBy(sql`${poolCycles.period} desc`).limit(12);
  const info = await tp(ctx).info().catch((e) => ({ account: "not configured", threshold: null, council: [] as string[], balanceMicro: null, notes: (e as Error).message }));
  return {
    charityBps: s.poolCharityBps,
    rules: { minDepositMicro: s.poolMinDepositMicro, holdingDays: s.poolHoldingDays, accountAgeDays: s.poolAccountAgeDays, choiceDays: s.poolChoiceDays, defaultBeneficiary: DEFAULT_BENEFICIARY_RULE },
    treasury: { provider: tp(ctx).name, decentralized: tp(ctx).decentralized, ...info },
    cycles,
  };
}

/** Sandbox-only "verify I'm a unique person" stand-in. Live needs a real uniqueness provider. */
export async function sandboxAttest(ctx: Ctx, userId: string, email: string) {
  if (ctx.environment === "live") throw new AppError("no_provider", "A privacy-preserving uniqueness provider is not connected yet.");
  const subjectHash = createHash("sha256").update(`sandbox:${email.toLowerCase()}`).digest("hex");
  await ctx.db.insert(identityAttestations).values({ userId, provider: "sandbox", subjectHash, verifiedAt: ctx.now() }).onConflictDoNothing();
  const [a] = await ctx.db.select().from(identityAttestations).where(eq(identityAttestations.userId, userId));
  if (!a) throw new AppError("duplicate_identity", "This identity is already linked to another account.");
  return a;
}

/** Periodic: sync proposal statuses and auto-prepare payouts once the choice window closes. */
export async function runPoolJobs(ctx: Ctx) {
  const open = await ctx.db.select().from(poolCycles).where(and(eq(poolCycles.environment, ctx.environment), inArray(poolCycles.status, ["choosing", "awaiting_approval"])));
  let n = 0;
  for (const c of open) {
    if (c.status === "choosing" && c.choiceDeadline && ctx.now() >= c.choiceDeadline) {
      await preparePayouts(ctx, null, c.id);
      n++;
    }
    if (c.status === "awaiting_approval") n += (await syncPayouts(ctx, c.id)).synced;
  }
  return { n };
}
