import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { causes, charityPayouts, deliveries, organizations } from "../db/schema";
import { acct, audit, getSettings, postJournal, raiseAlert } from "../core";
import { inTx, type Ctx } from "./context";

const MAX_ATTEMPTS = 3;

/**
 * Groups pending deliveries per cause into one payout once they reach the minimum payout size.
 * Only payout-ready causes of approved organisations are batched.
 */
export async function batchPayouts(ctx: Ctx) {
  // Vault v2: real-money payouts never come from this database batch. Supporters sign donate() and the
  // keeper may call auto_deliver() only within each supporter's on-chain grant (docs/VAULT_V2.md §4).
  if (ctx.environment === "live") return { created: 0, skipped: "live payouts are executed on chain by the vault" as const };
  const settings = await getSettings(ctx.db);
  if (settings.pausePayouts) return { created: 0, skipped: "paused" as const };
  const min = BigInt(settings.minPayoutMicro);
  const groups = await ctx.db
    .select({ causeId: deliveries.causeId, total: sql<string>`sum(${deliveries.amountMicro})::text` })
    .from(deliveries)
    .where(and(eq(deliveries.environment, ctx.environment), eq(deliveries.status, "pending"), isNull(deliveries.payoutId)))
    .groupBy(deliveries.causeId);

  let created = 0;
  for (const g of groups) {
    if (BigInt(g.total) < min) continue;
    const [c] = await ctx.db
      .select({ c: causes, org: organizations })
      .from(causes)
      .innerJoin(organizations, eq(organizations.id, causes.orgId))
      .where(eq(causes.id, g.causeId));
    if (!c || c.c.status !== "approved" || c.org.status !== "approved" || !c.c.payoutReadyAt || !c.org.payoutNearAccount || !c.org.payoutVerifiedAt) continue;

    await inTx(ctx, async (tx) => {
      const pending = await tx.db
        .select()
        .from(deliveries)
        .where(and(eq(deliveries.causeId, g.causeId), eq(deliveries.status, "pending"), isNull(deliveries.payoutId), eq(deliveries.environment, tx.environment)))
        .for("update");
      const amount = pending.reduce((a, d) => a + d.amountMicro, 0n);
      if (amount < min) return;
      const batchKey = `${g.causeId}:${tx.now().toISOString()}`;
      const [p] = await tx.db
        .insert(charityPayouts)
        .values({ causeId: g.causeId, environment: tx.environment, amountMicro: amount, destinationAccount: c.org.payoutNearAccount!, batchKey })
        .returning();
      await tx.db
        .update(deliveries)
        .set({ status: "queued", payoutId: p.id })
        .where(inArray(deliveries.id, pending.map((d) => d.id)));
      created++;
    });
  }
  return { created };
}

/** Sends created payouts on chain (live: Vault.distribute_yield; sandbox: labelled no-op). */
export async function submitPayouts(ctx: Ctx) {
  const settings = await getSettings(ctx.db);
  if (settings.pausePayouts) return { submitted: 0 };
  const list = await ctx.db
    .select()
    .from(charityPayouts)
    .where(and(eq(charityPayouts.environment, ctx.environment), eq(charityPayouts.status, "created")));
  let submitted = 0;
  for (const p of list) {
    // Claim the row first so two workers can never submit the same payout.
    const claimed = await ctx.db
      .update(charityPayouts)
      .set({ status: "submitted", attempts: p.attempts + 1, submittedAt: ctx.now() })
      .where(and(eq(charityPayouts.id, p.id), eq(charityPayouts.status, "created")))
      .returning();
    if (!claimed.length) continue;
    try {
      const { txHash } = await ctx.p.payout.distribute({ payoutId: p.id, destination: p.destinationAccount, amountMicro: p.amountMicro });
      await ctx.db.update(charityPayouts).set({ txHash }).where(eq(charityPayouts.id, p.id));
      await audit(ctx.db, { actorType: "worker", action: "payout.submitted", targetType: "payout", targetId: p.id, data: { txHash } });
      submitted++;
    } catch (e) {
      await failPayout(ctx, p.id, (e as Error).message, p.attempts + 1);
    }
  }
  return { submitted };
}

/** Confirms submitted payouts and books them. Failed payouts release their deliveries back to pending. */
export async function confirmPayouts(ctx: Ctx) {
  const list = await ctx.db
    .select()
    .from(charityPayouts)
    .where(and(eq(charityPayouts.environment, ctx.environment), eq(charityPayouts.status, "submitted")));
  let confirmed = 0;
  for (const p of list) {
    if (!p.txHash) continue;
    const r = await ctx.p.payout.confirm(p.txHash);
    if (r === "pending") continue;
    if (r === "failed") {
      await failPayout(ctx, p.id, "On-chain distribution failed", p.attempts);
      continue;
    }
    await inTx(ctx, async (tx) => {
      const [row] = await tx.db.select().from(charityPayouts).where(eq(charityPayouts.id, p.id)).for("update");
      if (row.status !== "submitted") return;
      await postJournal(tx.db, {
        environment: tx.environment,
        kind: "payout_confirmed",
        refType: "payout",
        refId: p.id,
        memo: `Paid to ${p.destinationAccount} tx ${p.txHash}`,
        at: tx.now(),
        entries: [
          { account: acct.causePending(p.causeId), amount: p.amountMicro },
          { account: acct.poolLending, amount: -p.amountMicro },
        ],
      });
      await tx.db.update(charityPayouts).set({ status: "confirmed", confirmedAt: tx.now() }).where(eq(charityPayouts.id, p.id));
      await tx.db.update(deliveries).set({ status: "paid", paidAt: tx.now() }).where(eq(deliveries.payoutId, p.id));
    });
    await audit(ctx.db, { actorType: "worker", action: "payout.confirmed", targetType: "payout", targetId: p.id });
    confirmed++;
  }
  return { confirmed };
}

async function failPayout(ctx: Ctx, payoutId: string, reason: string, attempts: number) {
  const final = attempts >= MAX_ATTEMPTS;
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(charityPayouts)
      .set({ status: final ? "manual_review" : "created", failureReason: reason, txHash: null })
      .where(eq(charityPayouts.id, payoutId));
  });
  if (final) {
    await raiseAlert(ctx.db, {
      severity: "critical",
      code: "payout_failed",
      message: `Payout ${payoutId} failed ${attempts} times: ${reason}`,
      dedupeKey: `payout_failed:${payoutId}`,
    });
  }
  await audit(ctx.db, { actorType: "worker", action: final ? "payout.manual_review" : "payout.retry", targetType: "payout", targetId: payoutId, data: { reason } });
}

/** Admin: release a payout in manual review back to its deliveries (they will be re-batched). */
export async function releasePayout(ctx: Ctx, payoutId: string, adminId: string) {
  await inTx(ctx, async (tx) => {
    const [p] = await tx.db.select().from(charityPayouts).where(eq(charityPayouts.id, payoutId)).for("update");
    if (!p || p.status !== "manual_review") throw new Error("Only payouts in manual review can be released");
    await tx.db.update(charityPayouts).set({ status: "failed" }).where(eq(charityPayouts.id, payoutId));
    await tx.db.update(deliveries).set({ status: "pending", payoutId: null }).where(eq(deliveries.payoutId, payoutId));
  });
  await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "payout.released", targetType: "payout", targetId: payoutId });
}
