import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { causes, cities, deposits, helpers, lendingPositions, supportPositions, withdrawals } from "../db/schema";
import { getSettings } from "../core";
import type { Ctx } from "./context";
import { effectiveMode, getPreferences } from "./deliveries";
import { withdrawalQuote } from "./withdrawals";
import { yieldSummary } from "./yield";

export async function deliveryState(ctx: Ctx, userId: string) {
  const settings = await getSettings(ctx.db);
  const prefs = await getPreferences(ctx, userId);
  const y = await yieldSummary(ctx, userId);
  const hs = await ctx.db.select().from(helpers).where(eq(helpers.userId, userId));
  const now = ctx.now();
  const parcelSize = BigInt(settings.parcelSizeMicro);
  return {
    eligibleMicro: y.eligibleMicro,
    settlingMicro: y.settlingMicro,
    earnedMicro: y.earnedMicro,
    parcelSizeMicro: parcelSize,
    prefs: {
      deliveryRule: prefs.deliveryRule,
      defaultCauseId: prefs.defaultCauseId,
      favoriteCauseId: prefs.favoriteCauseId,
      lastSelectedCauseId: prefs.lastSelectedCauseId,
      split: prefs.split,
      autoEnabled: prefs.autoEnabled,
      autoThresholdMicro: prefs.autoThresholdMicro,
      inactivityTimeoutSeconds: prefs.inactivityTimeoutSeconds,
    },
    helpers: hs.map((h) => ({
      id: h.id,
      causeId: h.causeId,
      animal: h.animal,
      nickname: h.nickname,
      controlPreference: h.controlPreference,
      control: effectiveMode(h, prefs.inactivityTimeoutSeconds, now),
    })),
  };
}

export async function portfolio(ctx: Ctx, userId: string) {
  const [pos] = await ctx.db.select().from(supportPositions).where(eq(supportPositions.userId, userId));
  const quote = await withdrawalQuote(ctx, userId);
  const y = await yieldSummary(ctx, userId);
  const [lp] = await ctx.db.select().from(lendingPositions).where(eq(lendingPositions.environment, ctx.environment));
  const deps = await ctx.db
    .select({ d: deposits, causeTitle: causes.title, causeSlug: causes.slug, cityName: cities.name })
    .from(deposits)
    .innerJoin(causes, eq(causes.id, deposits.causeId))
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .where(eq(deposits.userId, userId))
    .orderBy(desc(deposits.createdAt))
    .limit(50);
  const wds = await ctx.db.select().from(withdrawals).where(eq(withdrawals.userId, userId)).orderBy(desc(withdrawals.createdAt)).limit(20);
  const linked = await ctx.db
    .selectDistinct({ id: causes.id, title: causes.title, slug: causes.slug, cityName: cities.name })
    .from(helpers)
    .innerJoin(causes, eq(causes.id, helpers.causeId))
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .where(eq(helpers.userId, userId));
  return {
    totalDepositedMicro: pos?.totalDepositedMicro ?? 0n,
    totalWithdrawnMicro: pos?.totalWithdrawnMicro ?? 0n,
    principalMicro: quote.principalMicro,
    withdrawingMicro: quote.withdrawingMicro,
    redeemableMicro: quote.redeemableMicro,
    poolHealthy: quote.poolHealthy,
    aprWad: lp ? BigInt(lp.supplyAprWad) : null,
    lastObservedAt: lp?.lastObservedAt ?? null,
    yield: y,
    deposits: deps,
    withdrawals: wds,
    linkedCauses: linked,
  };
}

/** Public helper roster for a city: privacy-safe (animal + nickname only), viewer's own first. */
export async function cityHelpers(ctx: Ctx, causeId: string, viewerId: string | null, limit = 80) {
  const mine = viewerId
    ? await ctx.db.select().from(helpers).where(and(eq(helpers.causeId, causeId), eq(helpers.userId, viewerId), eq(helpers.environment, ctx.environment)))
    : [];
  const recent = await ctx.db
    .select({ id: helpers.id, animal: helpers.animal, nickname: helpers.nickname, userId: helpers.userId })
    .from(helpers)
    .where(and(eq(helpers.causeId, causeId), eq(helpers.environment, ctx.environment)))
    .orderBy(sql`${helpers.lastPlayerActionAt} desc nulls last`)
    .limit(limit);
  const ids = new Set(mine.map((m) => m.id));
  return [
    ...mine.map((m) => ({ id: m.id, animal: m.animal, nickname: m.nickname, mine: true })),
    ...recent.filter((r) => !ids.has(r.id)).map((r) => ({ id: r.id, animal: r.animal, nickname: r.nickname, mine: false })),
  ];
}

export async function deliverableCauses(ctx: Ctx) {
  return ctx.db
    .select({ id: causes.id, title: causes.title, slug: causes.slug, cityName: cities.name })
    .from(causes)
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .where(and(eq(causes.status, "approved"), sql`${causes.payoutReadyAt} is not null`));
}

export { inArray };
