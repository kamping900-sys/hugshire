import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { allocateProRata } from "@/lib/money";
import {
  charityPayouts,
  deposits,
  ledgerEntries,
  ledgerJournals,
  withdrawals,
  yieldAllocations,
  yieldSnapshots,
} from "../db/schema";
import { accountSum, acct, getSettings, postJournal, raiseAlert, resolveAlertsByKey, rows } from "../core";
import { inTx, type Ctx } from "./context";
import { principalSecondsByUser } from "./weights";

export type SnapshotResult =
  | { kind: "skipped"; reason: string }
  | { kind: "loss"; deficitMicro: bigint }
  | { kind: "allocated"; snapshotId: string; yieldMicro: bigint; users: number };

/**
 * Observes the pool, measures yield since the last snapshot, and attributes it to supporters
 * by time-weighted principal (principal × seconds). Yield is only ever *measured*, never computed
 * from gameplay or from a promised rate.
 *
 *   yield = observed pool value − pool value the ledger already accounts for
 */
export async function runYieldSnapshot(ctx: Ctx): Promise<SnapshotResult> {
  const now = ctx.now();
  // Money in flight makes observed and booked values disagree for a moment. Wait it out.
  const inFlight = await countInFlight(ctx);
  if (inFlight > 0) return { kind: "skipped", reason: `${inFlight} vault operations in flight` };

  const [last] = await ctx.db
    .select()
    .from(yieldSnapshots)
    .where(eq(yieldSnapshots.environment, ctx.environment))
    .orderBy(desc(yieldSnapshots.periodEnd))
    .limit(1);
  const periodStart = last?.periodEnd ?? (await firstPrincipalAt(ctx));
  if (!periodStart) return { kind: "skipped", reason: "no supplied principal yet" };
  if (now.getTime() - periodStart.getTime() < 1000) return { kind: "skipped", reason: "period too short" };

  const obs = await ctx.p.lending.observe(now);
  const booked = await accountSum(ctx.db, ctx.environment, acct.poolLending);
  const delta = obs.assetsMicro - booked;

  if (delta < 0n) {
    await raiseAlert(ctx.db, {
      severity: "critical",
      code: "pool_value_below_ledger",
      message: `Observed pool value is ${-delta} micro-USDC below the ledger. Yield allocation halted; check RHEA and the Vault.`,
      dedupeKey: `pool_deficit:${ctx.environment}`,
      data: { observed: obs.assetsMicro, booked },
    });
    return { kind: "loss", deficitMicro: -delta };
  }
  await resolveAlertsByKey(ctx.db, `pool_deficit:${ctx.environment}`);

  const settings = await getSettings(ctx.db);
  const weights = await principalSecondsByUser(ctx.db, ctx.environment, periodStart, now);
  const userIds = [...weights.keys()].sort();
  const parts = allocateProRata(delta, userIds.map((u) => weights.get(u)!));
  const eligibleAt = new Date(now.getTime() + settings.yieldSettlementSeconds * 1000);

  return inTx(ctx, async (tx) => {
    const [snap] = await tx.db
      .insert(yieldSnapshots)
      .values({
        environment: tx.environment,
        periodStart,
        periodEnd: now,
        observedAssetsMicro: obs.assetsMicro,
        ledgerAssetsBeforeMicro: booked,
        yieldMicro: delta,
        supplyAprWad: obs.supplyAprWad.toString(),
        source: obs.source,
      })
      .onConflictDoNothing()
      .returning();
    if (!snap) return { kind: "skipped", reason: "snapshot for this instant already exists" } as const;
    if (delta === 0n) return { kind: "allocated", snapshotId: snap.id, yieldMicro: 0n, users: 0 } as const;

    const entries: { account: string; amount: bigint }[] = [{ account: acct.poolLending, amount: delta }];
    const allocRows: (typeof yieldAllocations.$inferInsert)[] = [];
    userIds.forEach((u, idx) => {
      const amt = parts[idx];
      if (amt <= 0n) return;
      entries.push({ account: acct.userYield(u), amount: -amt });
      allocRows.push({ snapshotId: snap.id, userId: u, amountMicro: amt, weight: weights.get(u)!.toString(), eligibleAt });
    });
    const allocated = allocRows.reduce((a, r) => a + (r.amountMicro as bigint), 0n);
    if (allocated < delta) entries.push({ account: acct.poolUnallocatedYield, amount: -(delta - allocated) });

    await postJournal(tx.db, {
      environment: tx.environment,
      kind: "yield_accrued",
      refType: "yield_snapshot",
      refId: snap.id,
      memo: `Yield measured ${periodStart.toISOString()} → ${now.toISOString()} (${obs.source})`,
      at: now,
      entries,
    });
    if (allocRows.length) await tx.db.insert(yieldAllocations).values(allocRows);
    return { kind: "allocated", snapshotId: snap.id, yieldMicro: delta, users: allocRows.length } as const;
  });
}

async function countInFlight(ctx: Ctx): Promise<number> {
  const [d] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(deposits)
    .where(and(eq(deposits.environment, ctx.environment), eq(deposits.status, "vault_pending")));
  const [w] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(withdrawals)
    .where(and(eq(withdrawals.environment, ctx.environment), eq(withdrawals.status, "pending_protocol_withdrawal")));
  const [p] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(charityPayouts)
    .where(and(eq(charityPayouts.environment, ctx.environment), eq(charityPayouts.status, "submitted")));
  return Number(d.n) + Number(w.n) + Number(p.n);
}

async function firstPrincipalAt(ctx: Ctx): Promise<Date | null> {
  const r = await ctx.db
    .select({ at: ledgerEntries.createdAt })
    .from(ledgerEntries)
    .innerJoin(ledgerJournals, eq(ledgerJournals.id, ledgerEntries.journalId))
    .where(and(eq(ledgerJournals.environment, ctx.environment), eq(ledgerJournals.kind, "deposit_supplied")))
    .orderBy(asc(ledgerEntries.createdAt))
    .limit(1);
  return r[0]?.at ?? null;
}

/** A supporter's yield: eligible now, still settling, and lifetime totals. */
export async function yieldSummary(ctx: Ctx, userId: string) {
  const now = ctx.now();
  const r = await ctx.db.execute<{ eligible: string; settling: string; earned: string }>(sql`
    select
      coalesce(sum(case when eligible_at <= ${now.toISOString()} then amount_micro - consumed_micro else 0 end), 0)::text as eligible,
      coalesce(sum(case when eligible_at >  ${now.toISOString()} then amount_micro - consumed_micro else 0 end), 0)::text as settling,
      coalesce(sum(amount_micro), 0)::text as earned
    from yield_allocations where user_id = ${userId}`);
  const x = rows<{ eligible: string; settling: string; earned: string }>(r)[0];
  return { eligibleMicro: BigInt(x.eligible), settlingMicro: BigInt(x.settling), earnedMicro: BigInt(x.earned) };
}

/** Eligible allocations for a user, oldest first, locked for update (call inside a transaction). */
export async function lockEligibleAllocations(ctx: Ctx, userId: string) {
  return ctx.db
    .select()
    .from(yieldAllocations)
    .where(
      and(
        eq(yieldAllocations.userId, userId),
        lte(yieldAllocations.eligibleAt, ctx.now()),
        gt(sql`${yieldAllocations.amountMicro} - ${yieldAllocations.consumedMicro}`, sql`0`),
      ),
    )
    .orderBy(asc(yieldAllocations.eligibleAt), asc(yieldAllocations.id))
    .for("update");
}

export { inArray };
