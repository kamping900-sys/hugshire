/**
 * The player journey: helper → home town → fund (or play free) → arrive.
 * Everyone who finishes onboarding has a helper and a home town (their default cause), whether or
 * not they deposit. Deposits create their own helper as before; a free player's helper has no deposit.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { causes, cities, deliveries, helperPreferences, helpers, userProfiles, type Animal } from "../db/schema";
import { AppError, acct, audit, liabilityBalance, notFound, rows } from "../core";
import type { Ctx } from "./context";
import { isDeliverable } from "./deliveries";
import { yieldSummary } from "./yield";
import { MASCOT_OF } from "./towns";
import { lendingPositions, poolAllocations, poolCycles } from "../db/schema";

export async function journey(ctx: Ctx, userId: string) {
  const [profile] = await ctx.db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
  const hs = await ctx.db.select().from(helpers).where(and(eq(helpers.userId, userId), eq(helpers.environment, ctx.environment))).orderBy(asc(helpers.createdAt));
  const [prefs] = await ctx.db.select().from(helperPreferences).where(eq(helperPreferences.userId, userId));
  const homeId = prefs?.defaultCauseId ?? hs[0]?.causeId ?? null;
  const [home] = homeId
    ? await ctx.db.select({ id: causes.id, slug: causes.slug, title: causes.title, cityName: cities.name }).from(causes).innerJoin(cities, eq(cities.causeId, causes.id)).where(eq(causes.id, homeId))
    : [];
  const principal = await liabilityBalance(ctx.db, ctx.environment, acct.userPrincipal(userId));
  const withdrawing = await liabilityBalance(ctx.db, ctx.environment, acct.userWithdrawing(userId));
  const y = await yieldSummary(ctx, userId);
  // today's lending rate → roughly how much interest the planted money grows per day
  const [lp] = await ctx.db.select({ apr: lendingPositions.supplyAprWad }).from(lendingPositions).where(eq(lendingPositions.environment, ctx.environment));
  const aprWad = lp ? BigInt(lp.apr) : 0n;
  const dailyMicro = (principal * aprWad) / 10n ** 18n / 365n;
  const d = rows<{ status: string; s: string }>(
    await ctx.db.execute(sql`select status, coalesce(sum(amount_micro),0)::text as s from deliveries where user_id = ${userId} and environment = ${ctx.environment} group by status`),
  );
  const by = Object.fromEntries(d.map((x) => [x.status, BigInt(x.s)]));
  const golden = await ctx.db
    .select({ status: poolAllocations.status, amount: poolAllocations.amountMicro })
    .from(poolAllocations)
    .innerJoin(poolCycles, eq(poolCycles.id, poolAllocations.cycleId))
    .where(and(eq(poolAllocations.userId, userId), eq(poolCycles.environment, ctx.environment)));
  const active = hs.find((h) => h.id === prefs?.activeHelperId) ?? hs[0];
  const animal = (active?.animal ?? profile?.favoriteAnimal ?? "cat") as Animal;
  // what each helper's town has received from this player (settled deposits)
  const planted = rows<{ cause_id: string; s: string }>(
    await ctx.db.execute(sql`select cause_id, coalesce(sum(coalesce(principal_micro, requested_micro)),0)::text as s from deposits where user_id = ${userId} and environment = ${ctx.environment} and status = 'supplied' group by cause_id`),
  );
  const plantedBy = new Map(planted.map((p) => [p.cause_id, BigInt(p.s)]));
  const towns = hs.length
    ? await ctx.db.select({ id: causes.id, slug: causes.slug, title: causes.title, cityName: cities.name }).from(causes).innerJoin(cities, eq(cities.causeId, causes.id))
    : [];
  const townOf = new Map(towns.map((t) => [t.id, t]));
  const helperList = hs.map((h) => ({
    id: h.id,
    animal: h.animal,
    mascot: MASCOT_OF[h.animal] ?? "cat",
    nickname: h.nickname,
    active: h.id === active?.id,
    plantedMicro: plantedBy.get(h.causeId) ?? 0n,
    town: townOf.get(h.causeId) ?? null,
  }));
  return {
    onboarded: hs.length > 0 || !!prefs?.defaultCauseId,
    helper: { id: active?.id ?? null, animal, mascot: MASCOT_OF[animal] ?? "cat", nickname: active?.nickname ?? profile?.displayName ?? "Helper", count: hs.length },
    helpers: helperList,
    sandbox: ctx.environment === "sandbox",
    home: home ?? null,
    riskAcknowledged: !!profile?.riskAcknowledgedAt,
    bank: {
      principalMicro: principal,
      withdrawingMicro: withdrawing,
      earnedMicro: y.earnedMicro,
      ripeMicro: y.eligibleMicro,
      settlingMicro: y.settlingMicro,
      pendingMicro: (by.pending ?? 0n) + (by.queued ?? 0n),
      deliveredMicro: by.paid ?? 0n,
      freePlay: principal < 1_000_000n,
      dailyMicro,
      aprBps: Number((aprWad * 10000n) / 10n ** 18n),
    },
    golden: { open: golden.filter((g) => g.status === "allocated").length, total: golden.length },
    autoDelivery: {
      authorised: !!(prefs?.autoEnabled && prefs?.autoAuthorizedAt),
      schedule: prefs?.autoSchedule ?? "inactivity",
      daily: !!(prefs?.autoEnabled && prefs?.autoAuthorizedAt && prefs?.autoSchedule === "schedule" && prefs?.autoIntervalSeconds <= 86400),
    },
  };
}

/** Saves the helper and home town. Creates a deposit-less helper for free players (once). */
export async function onboard(ctx: Ctx, userId: string, i: { animal: Animal; nickname: string; homeCauseId: string; createHelper?: boolean }) {
  const [c] = await ctx.db.select().from(causes).where(eq(causes.id, i.homeCauseId));
  if (!c || c.status !== "approved") throw notFound("Town not found");
  await ctx.db.update(userProfiles).set({ favoriteAnimal: i.animal, displayName: i.nickname }).where(eq(userProfiles.userId, userId));
  const deliverable = await isDeliverable(ctx, i.homeCauseId);
  const firstTime = !(await ctx.db.select({ u: helperPreferences.userId }).from(helperPreferences).where(eq(helperPreferences.userId, userId))).length;
  const autoDaily = firstTime && deliverable ? { autoEnabled: true, autoAuthorizedAt: ctx.now(), autoSchedule: "schedule" as const, autoIntervalSeconds: 86400 } : {};
  const set = { defaultCauseId: i.homeCauseId, ...(deliverable ? { deliveryRule: "default_cause" as const } : {}), ...autoDaily, updatedAt: ctx.now() };
  await ctx.db.insert(helperPreferences).values({ userId, ...set }).onConflictDoUpdate({ target: helperPreferences.userId, set });
  const existing = await ctx.db.select().from(helpers).where(and(eq(helpers.userId, userId), eq(helpers.environment, ctx.environment)));
  if (!existing.length && i.createHelper !== false) {
    await ctx.db.insert(helpers).values({ userId, causeId: i.homeCauseId, animal: i.animal, nickname: i.nickname, environment: ctx.environment, lastPlayerActionAt: ctx.now() });
  } else if (existing.length) {
    // the first helper follows the player's choices (later deposit helpers keep their own)
    const first = [...existing].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    await ctx.db.update(helpers).set({ animal: i.animal, nickname: i.nickname }).where(eq(helpers.id, first.id));
  }
  // else: a new player who is planting — the deposit creates their first helper
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "journey.onboarded", data: { animal: i.animal, home: i.homeCauseId } });
  return journey(ctx, userId);
}

/** The Heart Tree toggle: send ripe fruit to your home town automatically, once a day. */
export async function setAutoDaily(ctx: Ctx, userId: string, on: boolean) {
  const [prefs] = await ctx.db.select().from(helperPreferences).where(eq(helperPreferences.userId, userId));
  const home = prefs?.defaultCauseId;
  if (on && (!home || !(await isDeliverable(ctx, home)))) throw new AppError("no_home", "Choose a home town that can receive deliveries first.");
  const set = on
    ? { autoEnabled: true, autoAuthorizedAt: ctx.now(), autoSchedule: "schedule" as const, autoIntervalSeconds: 86400, deliveryRule: "default_cause" as const, updatedAt: ctx.now() }
    : { autoEnabled: false, updatedAt: ctx.now() };
  await ctx.db.insert(helperPreferences).values({ userId, ...set }).onConflictDoUpdate({ target: helperPreferences.userId, set });
  await audit(ctx.db, { actorId: userId, actorType: "user", action: on ? "auto_delivery.daily_on" : "auto_delivery.off", data: { home } });
  return journey(ctx, userId);
}

/** Choose which of your helpers you walk around as. */
export async function setActiveHelper(ctx: Ctx, userId: string, helperId: string) {
  const [h] = await ctx.db.select().from(helpers).where(and(eq(helpers.id, helperId), eq(helpers.userId, userId)));
  if (!h) throw notFound("Helper not found");
  const set = { activeHelperId: helperId, updatedAt: ctx.now() };
  await ctx.db.insert(helperPreferences).values({ userId, ...set }).onConflictDoUpdate({ target: helperPreferences.userId, set });
  return journey(ctx, userId);
}

/** Rename a helper (or change its animal). */
export async function renameHelper(ctx: Ctx, userId: string, helperId: string, i: { animal: Animal; nickname: string }) {
  const [h] = await ctx.db.select().from(helpers).where(and(eq(helpers.id, helperId), eq(helpers.userId, userId)));
  if (!h) throw notFound("Helper not found");
  await ctx.db.update(helpers).set({ animal: i.animal, nickname: i.nickname }).where(eq(helpers.id, helperId));
  return journey(ctx, userId);
}

/** Change the home town (default destination for red fruit auto-delivery and golden fruit). */
export async function setHome(ctx: Ctx, userId: string, homeCauseId: string) {
  if (!(await isDeliverable(ctx, homeCauseId))) throw new AppError("cause_not_deliverable", "That town cannot receive deliveries right now.");
  const set = { defaultCauseId: homeCauseId, deliveryRule: "default_cause" as const, updatedAt: ctx.now() };
  await ctx.db.insert(helperPreferences).values({ userId, ...set }).onConflictDoUpdate({ target: helperPreferences.userId, set });
  return journey(ctx, userId);
}

export { deliveries };
