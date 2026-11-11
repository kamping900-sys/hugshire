/**
 * The Heart Tree is a picture of real money, not a source of it.
 *  - Red fruit   = the supporter's own vault yield ("From your deposit").
 *  - Golden fruit = their finalized, funded Community Heart Pool allocation ("From our community").
 * Fruit values are exact micro-USDC splits of the real amounts: there is no fixed $0.01 per fruit,
 * and fractional values are shown precisely.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { allocateProRata } from "@/lib/money";
import { deliveries, poolAllocations, poolCycles, causes } from "../db/schema";
import { rows } from "../core";
import type { Ctx } from "./context";
import { yieldSummary } from "./yield";

const MAX_FRUITS = 12;

/** Splits an exact amount into 1..12 fruits (more fruit as the amount grows), summing exactly. */
export function fruitSplit(totalMicro: bigint): bigint[] {
  if (totalMicro <= 0n) return [];
  // one fruit per ~$0.05, at least 1, at most 12 — purely visual, the values are exact
  const n = Number(totalMicro / 50_000n);
  const count = Math.max(1, Math.min(MAX_FRUITS, n));
  return allocateProRata(totalMicro, Array.from({ length: count }, () => 1n));
}

export async function heartTree(ctx: Ctx, userId: string) {
  const y = await yieldSummary(ctx, userId);
  const r = await ctx.db.execute<{ status: string; s: string }>(sql`
    select status, coalesce(sum(amount_micro),0)::text as s from deliveries
    where user_id = ${userId} and environment = ${ctx.environment} group by status`);
  const by = Object.fromEntries(rows<{ status: string; s: string }>(r).map((x) => [x.status, BigInt(x.s)]));
  const pending = (by.pending ?? 0n) + (by.queued ?? 0n);
  const delivered = by.paid ?? 0n;

  const gold = await ctx.db
    .select({ a: poolAllocations, period: poolCycles.period, simulated: poolCycles.simulated, cycleStatus: poolCycles.status, deadline: poolCycles.choiceDeadline })
    .from(poolAllocations)
    .innerJoin(poolCycles, eq(poolCycles.id, poolAllocations.cycleId))
    .where(and(eq(poolAllocations.userId, userId), eq(poolCycles.environment, ctx.environment)));
  const causeIds = [...new Set(gold.flatMap((g) => g.a.choices.map((c) => c.causeId)))];
  const names = causeIds.length ? await ctx.db.select({ id: causes.id, title: causes.title }).from(causes).where(inArray(causes.id, causeIds)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.title]));

  return {
    red: {
      /** Snapshotted yield still in its settlement window. */
      accruingMicro: y.settlingMicro,
      /** Ripe: real, settled yield that can be harvested and delivered now. */
      eligibleMicro: y.eligibleMicro,
      pendingMicro: pending,
      deliveredMicro: delivered,
      fruits: fruitSplit(y.eligibleMicro).map((v) => v.toString()),
      buds: y.settlingMicro > 0n ? Math.max(1, Math.min(6, Number(y.settlingMicro / 50_000n))) : 0,
    },
    golden: gold.map((g) => ({
      allocationId: g.a.id,
      period: g.period,
      simulated: g.simulated,
      amountMicro: g.a.amountMicro,
      status: g.a.status,
      choices: g.a.choices.map((c) => ({ ...c, title: nameOf.get(c.causeId) ?? "Cause" })),
      choiceSource: g.a.choiceSource,
      canChoose: g.cycleStatus === "choosing" && (g.a.status === "allocated" || g.a.status === "chosen"),
      choiceDeadline: g.deadline,
    })),
  };
}

export { deliveries };
