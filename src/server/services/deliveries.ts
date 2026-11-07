import { and, eq, inArray, sql } from "drizzle-orm";
import { allocateProRata, minBig } from "@/lib/money";
import {
  causes,
  deliveries,
  deliveryAllocations,
  helperPreferences,
  helpers,
  organizations,
  users,
  yieldAllocations,
} from "../db/schema";
import { AppError, acct, audit, forbidden, getSettings, notFound, paused, postJournal } from "../core";
import { inTx, type Ctx } from "./context";
import { lockEligibleAllocations, yieldSummary } from "./yield";

/** A cause can receive yield only when it, its organisation and its payout account are all approved. */
export async function assertDeliverableCause(ctx: Ctx, causeId: string) {
  const [row] = await ctx.db
    .select({ c: causes, orgStatus: organizations.status, payoutVerifiedAt: organizations.payoutVerifiedAt })
    .from(causes)
    .innerJoin(organizations, eq(organizations.id, causes.orgId))
    .where(eq(causes.id, causeId));
  if (!row) throw notFound("Cause not found");
  if (row.c.status !== "approved" || row.orgStatus !== "approved") {
    throw new AppError("cause_not_deliverable", "This cause cannot receive deliveries right now.");
  }
  if (!row.c.payoutReadyAt || !row.payoutVerifiedAt) {
    throw new AppError("cause_payout_not_ready", "This cause's receiving account is still being verified.");
  }
  return row.c;
}

export async function isDeliverable(ctx: Ctx, causeId: string | null | undefined) {
  if (!causeId) return false;
  try {
    await assertDeliverableCause(ctx, causeId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Assigns a supporter's already-earned, eligible yield to a cause.
 * The caller never chooses an amount beyond an optional cap: the amount is whatever real yield
 * is eligible. Gameplay therefore decides *when* and *where*, never *how much*.
 */
export async function createDelivery(
  ctx: Ctx,
  i: {
    userId: string;
    causeId: string;
    helperId?: string | null;
    mode: "manual" | "auto";
    idempotencyKey: string;
    capMicro?: bigint;
  },
) {
  const prior = await ctx.db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.userId, i.userId), eq(deliveries.idempotencyKey, i.idempotencyKey)));
  if (prior.length) return { delivery: prior[0], replay: true };

  const settings = await getSettings(ctx.db);
  // Pausing payouts does not block assignment: assigned yield simply waits for the next payout run.
  if (settings.pauseAutoDelivery && i.mode === "auto") throw paused("Auto delivery");

  const [user] = await ctx.db.select().from(users).where(eq(users.id, i.userId));
  if (!user || user.status !== "active") throw new AppError("account_restricted", "Your account cannot deliver right now.", 403);
  await assertDeliverableCause(ctx, i.causeId);

  if (i.helperId) {
    const [h] = await ctx.db.select().from(helpers).where(eq(helpers.id, i.helperId));
    if (!h) throw notFound("Helper not found");
    if (h.userId !== i.userId) throw forbidden("That helper belongs to someone else.");
  }

  return inTx(ctx, async (tx) => {
    const allocs = await lockEligibleAllocations(tx, i.userId);
    let remaining = i.capMicro ?? allocs.reduce((a, x) => a + (x.amountMicro - x.consumedMicro), 0n);
    const take: { id: string; amount: bigint }[] = [];
    for (const a of allocs) {
      if (remaining <= 0n) break;
      const free = a.amountMicro - a.consumedMicro;
      const t = minBig(free, remaining);
      if (t > 0n) {
        take.push({ id: a.id, amount: t });
        remaining -= t;
      }
    }
    const total = take.reduce((s, t) => s + t.amount, 0n);
    if (total <= 0n) throw new AppError("nothing_to_deliver", "There is no eligible yield to deliver yet.");

    const [d] = await tx.db
      .insert(deliveries)
      .values({
        userId: i.userId,
        helperId: i.helperId ?? null,
        causeId: i.causeId,
        environment: tx.environment,
        amountMicro: total,
        mode: i.mode,
        status: "pending",
        idempotencyKey: i.idempotencyKey,
        createdAt: tx.now(),
      })
      .returning();

    for (const t of take) {
      // The CHECK (consumed <= amount) constraint is the last line of defence against double use.
      await tx.db
        .update(yieldAllocations)
        .set({ consumedMicro: sql`${yieldAllocations.consumedMicro} + ${t.amount.toString()}` })
        .where(eq(yieldAllocations.id, t.id));
    }
    await tx.db.insert(deliveryAllocations).values(take.map((t) => ({ deliveryId: d.id, allocationId: t.id, amountMicro: t.amount })));

    await postJournal(tx.db, {
      environment: tx.environment,
      kind: "delivery_assigned",
      refType: "delivery",
      refId: d.id,
      at: tx.now(),
      entries: [
        { account: acct.userYield(i.userId), amount: total },
        { account: acct.causePending(i.causeId), amount: -total },
      ],
    });

    if (i.mode === "manual") {
      await tx.db
        .insert(helperPreferences)
        .values({ userId: i.userId, lastSelectedCauseId: i.causeId })
        .onConflictDoUpdate({ target: helperPreferences.userId, set: { lastSelectedCauseId: i.causeId, updatedAt: tx.now() } });
    }
    await audit(tx.db, {
      actorId: i.mode === "manual" ? i.userId : null,
      actorType: i.mode === "manual" ? "user" : "worker",
      action: `delivery.${i.mode}`,
      targetType: "delivery",
      targetId: d.id,
      data: { causeId: i.causeId, amountMicro: total },
    });
    return { delivery: d, replay: false };
  });
}

// ───────────────────────────── automation ─────────────────────────────

export type ControlState = { mode: "manual" | "auto"; reason: "preference" | "inactive" | "active"; idleSeconds: number | null };

/** Server-authoritative control mode. Inactive longer than the timeout => auto. */
export function effectiveMode(
  h: { controlPreference: "manual" | "auto"; lastPlayerActionAt: Date | null },
  timeoutSeconds: number,
  now: Date,
): ControlState {
  const idle = h.lastPlayerActionAt ? Math.floor((now.getTime() - h.lastPlayerActionAt.getTime()) / 1000) : null;
  if (h.controlPreference === "auto") return { mode: "auto", reason: "preference", idleSeconds: idle };
  if (idle === null || idle > timeoutSeconds) return { mode: "auto", reason: "inactive", idleSeconds: idle };
  return { mode: "manual", reason: "active", idleSeconds: idle };
}

/** Called on player input (throttled by the client). Returning players take back manual control. */
export async function recordPlayerAction(ctx: Ctx, userId: string, helperId: string) {
  const [h] = await ctx.db.select().from(helpers).where(eq(helpers.id, helperId));
  if (!h) throw notFound("Helper not found");
  if (h.userId !== userId) throw forbidden();
  const now = ctx.now();
  if (h.lastPlayerActionAt && now.getTime() - h.lastPlayerActionAt.getTime() < 15_000) return h; // throttle writes
  const [u] = await ctx.db.update(helpers).set({ lastPlayerActionAt: now }).where(eq(helpers.id, helperId)).returning();
  return u;
}

export async function getPreferences(ctx: Ctx, userId: string) {
  const [p] = await ctx.db.select().from(helperPreferences).where(eq(helperPreferences.userId, userId));
  if (p) return p;
  const settings = await getSettings(ctx.db);
  const [created] = await ctx.db
    .insert(helperPreferences)
    .values({ userId, inactivityTimeoutSeconds: settings.defaultInactivitySeconds })
    .onConflictDoNothing()
    .returning();
  return created ?? (await ctx.db.select().from(helperPreferences).where(eq(helperPreferences.userId, userId)))[0];
}

/** Where auto mode sends yield, per the supporter's rule. Returns [{causeId, bps}]. */
export async function autoDestinations(ctx: Ctx, userId: string): Promise<{ causeId: string; bps: number }[]> {
  const prefs = await getPreferences(ctx, userId);
  const myHelpers = await ctx.db.select().from(helpers).where(eq(helpers.userId, userId));
  const home = myHelpers.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.causeId ?? null;

  const pick = async (...candidates: (string | null | undefined)[]) => {
    for (const c of candidates) if (await isDeliverable(ctx, c)) return [{ causeId: c!, bps: 10_000 }];
    return [];
  };
  switch (prefs.deliveryRule) {
    case "default_cause":
      return pick(prefs.defaultCauseId, prefs.lastSelectedCauseId, home);
    case "favorite":
      return pick(prefs.favoriteCauseId, prefs.defaultCauseId, prefs.lastSelectedCauseId, home);
    case "split": {
      const ok: { causeId: string; bps: number }[] = [];
      for (const s of prefs.split) if (s.bps > 0 && (await isDeliverable(ctx, s.causeId))) ok.push(s);
      if (ok.length) return ok;
      return pick(prefs.lastSelectedCauseId, home);
    }
    case "last_selected":
    default:
      return pick(prefs.lastSelectedCauseId, prefs.defaultCauseId, home);
  }
}

/**
 * Auto-delivers for supporters whose helpers are all in auto mode (preference, or idle past the timeout)
 * and whose eligible yield has reached their threshold. Uses the same createDelivery path as manual play.
 */
export async function runAutoDelivery(ctx: Ctx) {
  const settings = await getSettings(ctx.db);
  if (settings.pauseAutoDelivery) return { delivered: 0, skipped: "paused" as const };
  const now = ctx.now();
  const candidates = await ctx.db
    .selectDistinct({ userId: yieldAllocations.userId })
    .from(yieldAllocations)
    .where(and(sql`${yieldAllocations.amountMicro} > ${yieldAllocations.consumedMicro}`, sql`${yieldAllocations.eligibleAt} <= ${now.toISOString()}`));
  let delivered = 0;
  for (const { userId } of candidates) {
    const prefs = await getPreferences(ctx, userId);
    if (!prefs.autoEnabled) continue;
    const hs = await ctx.db.select().from(helpers).where(eq(helpers.userId, userId));
    if (!hs.length) continue;
    const allAuto = hs.every((h) => effectiveMode(h, prefs.inactivityTimeoutSeconds, now).mode === "auto");
    if (!allAuto) continue;
    const { eligibleMicro } = await yieldSummary(ctx, userId);
    if (eligibleMicro <= 0n || eligibleMicro < prefs.autoThresholdMicro) continue;
    const dests = await autoDestinations(ctx, userId);
    if (!dests.length) continue;
    const parts = allocateProRata(eligibleMicro, dests.map((d) => BigInt(d.bps)));
    const bucket = Math.floor(now.getTime() / 60_000);
    for (let k = 0; k < dests.length; k++) {
      if (parts[k] <= 0n) continue;
      try {
        await createDelivery(ctx, {
          userId,
          causeId: dests[k].causeId,
          helperId: hs.find((h) => h.causeId === dests[k].causeId)?.id ?? hs[0].id,
          mode: "auto",
          idempotencyKey: `auto:${bucket}:${dests[k].causeId}`,
          capMicro: parts[k],
        });
        delivered++;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
      }
    }
  }
  return { delivered };
}

export async function listDeliveries(ctx: Ctx, userId: string) {
  return ctx.db
    .select({ d: deliveries, causeTitle: causes.title, causeSlug: causes.slug })
    .from(deliveries)
    .innerJoin(causes, eq(causes.id, deliveries.causeId))
    .where(eq(deliveries.userId, userId))
    .orderBy(sql`${deliveries.createdAt} desc`)
    .limit(100);
}

export { inArray };
