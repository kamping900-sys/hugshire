import { and, eq, sql } from "drizzle-orm";
import { minBig } from "@/lib/money";
import { lendingPositions, supportPositions, WITHDRAWAL_STATUSES, withdrawals, type WithdrawalStatus } from "../db/schema";
import { AppError, accountSum, acct, audit, getSettings, liabilityBalance, notFound, paused, postJournal } from "../core";
import { assertTransition, inTx, type Ctx } from "./context";

export const WITHDRAWAL_MACHINE: Record<WithdrawalStatus, readonly WithdrawalStatus[]> = {
  requested: ["pending_protocol_withdrawal", "failed", "manual_review"],
  pending_protocol_withdrawal: ["bridging", "failed", "manual_review"],
  bridging: ["available_for_offramp", "failed", "manual_review"],
  available_for_offramp: ["offramp_processing", "completed", "manual_review"],
  offramp_processing: ["completed", "failed", "manual_review"],
  completed: [],
  failed: [],
  manual_review: ["pending_protocol_withdrawal", "bridging", "available_for_offramp", "offramp_processing", "completed", "failed"],
};

export { WITHDRAWAL_STATUSES };

/**
 * What a supporter could redeem now. Mirrors the Vault rule:
 *   redeemable = principal × min(1, poolAssets / totalPrincipalOwed)
 * so if the pool ever takes a loss, every supporter shares it pro-rata. Yield already earned
 * belongs to causes and is never paid back out as principal.
 */
export async function withdrawalQuote(ctx: Ctx, userId: string) {
  const principal = await liabilityBalance(ctx.db, ctx.environment, acct.userPrincipal(userId));
  const withdrawing = await liabilityBalance(ctx.db, ctx.environment, acct.userWithdrawing(userId));
  const owed = await totalPrincipalOwed(ctx);
  // Observe the pool now: a stored observation predates later deposits and would understate it.
  let observed: bigint;
  let observedAt: Date | null = ctx.now();
  try {
    observed = (await ctx.p.lending.observe(ctx.now())).assetsMicro;
  } catch {
    const [pos] = await ctx.db.select().from(lendingPositions).where(eq(lendingPositions.environment, ctx.environment));
    const booked = await accountSum(ctx.db, ctx.environment, acct.poolLending);
    // Fall back to the ledger, adjusted by the last known gap between observed and booked.
    observed = booked;
    observedAt = pos?.lastObservedAt ?? null;
  }
  const ratioOk = owed === 0n || observed >= owed;
  const redeemable = ratioOk ? principal : (principal * observed) / owed;
  return {
    principalMicro: principal,
    withdrawingMicro: withdrawing,
    redeemableMicro: redeemable,
    poolHealthy: ratioOk,
    lastObservedAt: observedAt,
  };
}

async function totalPrincipalOwed(ctx: Ctx): Promise<bigint> {
  const r = await ctx.db.execute<{ s: string }>(sql`
    select coalesce(-sum(e.amount_micro), 0)::text as s
    from ledger_entries e join ledger_journals j on j.id = e.journal_id
    where j.environment = ${ctx.environment}
      and (e.account like 'user:%:principal' or e.account like 'user:%:principal_withdrawing')`);
  const rowsArr = (Array.isArray(r) ? r : (r as { rows: { s: string }[] }).rows) as { s: string }[];
  return BigInt(rowsArr[0]?.s ?? "0");
}

export async function requestWithdrawal(ctx: Ctx, i: { userId: string; amountMicro: bigint; idempotencyKey: string }) {
  const settings = await getSettings(ctx.db);
  if (settings.pauseWithdrawals) throw paused("Withdrawals");
  const prior = await ctx.db
    .select()
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, i.userId), eq(withdrawals.idempotencyKey, i.idempotencyKey)));
  if (prior.length) return { withdrawal: prior[0], replay: true };
  if (i.amountMicro <= 0n) throw new AppError("invalid_amount", "Enter an amount above zero.");

  return inTx(ctx, async (tx) => {
    // Lock the position row so two concurrent requests can't both pass the balance check.
    await tx.db.select().from(supportPositions).where(eq(supportPositions.userId, i.userId)).for("update");
    const principal = await liabilityBalance(tx.db, tx.environment, acct.userPrincipal(i.userId));
    if (i.amountMicro > principal) throw new AppError("insufficient_principal", "That is more than your current principal.");
    const at = tx.now();
    const [w] = await tx.db
      .insert(withdrawals)
      .values({
        userId: i.userId,
        environment: tx.environment,
        requestedMicro: i.amountMicro,
        status: "requested",
        idempotencyKey: i.idempotencyKey,
        history: [{ status: "requested", at: at.toISOString() }],
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    await postJournal(tx.db, {
      environment: tx.environment,
      kind: "withdrawal_requested",
      refType: "withdrawal",
      refId: w.id,
      at,
      entries: [
        { account: acct.userPrincipal(i.userId), amount: i.amountMicro },
        { account: acct.userWithdrawing(i.userId), amount: -i.amountMicro },
      ],
    });
    await tx.db
      .update(supportPositions)
      .set({
        principalMicro: sql`${supportPositions.principalMicro} - ${i.amountMicro.toString()}`,
        withdrawingMicro: sql`${supportPositions.withdrawingMicro} + ${i.amountMicro.toString()}`,
        updatedAt: at,
      })
      .where(eq(supportPositions.userId, i.userId));
    await audit(tx.db, { actorId: i.userId, actorType: "user", action: "withdrawal.requested", targetType: "withdrawal", targetId: w.id, data: { amountMicro: i.amountMicro } });
    return { withdrawal: w, replay: false };
  });
}

export async function advanceWithdrawal(ctx: Ctx, id: string, to: WithdrawalStatus, note?: string, patch: Partial<typeof withdrawals.$inferInsert> = {}) {
  return inTx(ctx, async (tx) => {
    const [w] = await tx.db.select().from(withdrawals).where(eq(withdrawals.id, id)).for("update");
    if (!w) throw notFound("Withdrawal not found");
    if (w.status === to) return w;
    assertTransition(WITHDRAWAL_MACHINE, w.status, to, "withdrawal");
    const at = tx.now();
    const [u] = await tx.db
      .update(withdrawals)
      .set({ ...patch, status: to, updatedAt: at, history: [...w.history, { status: to, at: at.toISOString(), note }] })
      .where(eq(withdrawals.id, id))
      .returning();
    return u;
  });
}

/**
 * The Vault paid out `redeemedMicro` for this withdrawal. Books it: the withdrawing principal is
 * extinguished, the pool shrinks by what actually left, and any shortfall is recorded explicitly.
 */
export async function settleProtocolWithdrawal(ctx: Ctx, id: string, redeemedMicro: bigint, vaultTxHash: string | null) {
  return inTx(ctx, async (tx) => {
    const [w] = await tx.db.select().from(withdrawals).where(eq(withdrawals.id, id)).for("update");
    if (!w) throw notFound("Withdrawal not found");
    if (w.status !== "pending_protocol_withdrawal") throw new Error(`Cannot settle a withdrawal in status ${w.status}`);
    const redeemed = minBig(redeemedMicro, w.requestedMicro);
    const shortfall = w.requestedMicro - redeemed;
    const at = tx.now();
    await postJournal(tx.db, {
      environment: tx.environment,
      kind: "withdrawal_redeemed",
      refType: "withdrawal",
      refId: w.id,
      at,
      entries: [
        { account: acct.userWithdrawing(w.userId), amount: w.requestedMicro },
        { account: acct.poolLending, amount: -redeemed },
        ...(shortfall > 0n ? [{ account: acct.poolShortfall, amount: -shortfall }] : []),
      ],
    });
    await tx.db
      .update(supportPositions)
      .set({
        withdrawingMicro: sql`${supportPositions.withdrawingMicro} - ${w.requestedMicro.toString()}`,
        totalWithdrawnMicro: sql`${supportPositions.totalWithdrawnMicro} + ${redeemed.toString()}`,
        updatedAt: at,
      })
      .where(eq(supportPositions.userId, w.userId));
    const [u] = await tx.db
      .update(withdrawals)
      .set({
        redeemedMicro: redeemed,
        vaultTxHash,
        status: "bridging",
        updatedAt: at,
        history: [...w.history, { status: "bridging", at: at.toISOString(), note: shortfall > 0n ? `Pool shortfall ${shortfall}` : undefined }],
      })
      .where(eq(withdrawals.id, id))
      .returning();
    return u;
  });
}

export async function listWithdrawals(ctx: Ctx, userId: string) {
  return ctx.db.select().from(withdrawals).where(eq(withdrawals.userId, userId)).orderBy(sql`${withdrawals.createdAt} desc`);
}
