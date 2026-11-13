/** Town Notice Board: organisation-reported news and stories, with reporting and moderation. */
import { and, desc, eq, sql } from "drizzle-orm";
import { causeUpdates, storyReports, adViews, helperPreferences, poolAllocations, poolCycles } from "../db/schema";
import { AppError, audit, getSettings, notFound } from "../core";
import type { Ctx } from "./context";
import { adProvider } from "../providers/ads";

export async function noticeBoard(ctx: Ctx, causeId: string) {
  const rows = await ctx.db
    .select()
    .from(causeUpdates)
    .where(and(eq(causeUpdates.causeId, causeId), eq(causeUpdates.visibility, "published")))
    .orderBy(desc(causeUpdates.createdAt))
    .limit(30);
  return rows.map((u) => ({
    id: u.id,
    title: u.title,
    body: u.body,
    category: u.category,
    mediaUrl: u.mediaUrl,
    linkUrl: u.linkUrl,
    createdAt: u.createdAt,
    /** "organisation_reported" unless Hugshire checked real-world evidence. A virtual building never proves impact. */
    provenance: u.kind === "verified_progress" ? ("verified_by_hugshire" as const) : ("organisation_reported" as const),
  }));
}

export async function reportStory(ctx: Ctx, userId: string, updateId: string, reason: string) {
  const [u] = await ctx.db.select().from(causeUpdates).where(eq(causeUpdates.id, updateId));
  if (!u) throw notFound();
  await ctx.db.insert(storyReports).values({ updateId, reporterId: userId, reason }).onConflictDoNothing();
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "story.reported", targetType: "cause_update", targetId: updateId, data: { reason } });
}

export async function moderateStory(ctx: Ctx, adminId: string, updateId: string, visibility: "published" | "hidden", note: string) {
  const [u] = await ctx.db.update(causeUpdates).set({ visibility, moderationNote: note }).where(eq(causeUpdates.id, updateId)).returning();
  if (!u) throw notFound();
  await ctx.db.update(storyReports).set({ status: visibility === "hidden" ? "actioned" : "dismissed" }).where(and(eq(storyReports.updateId, updateId), eq(storyReports.status, "open")));
  await audit(ctx.db, { actorId: adminId, actorType: "admin", action: `story.${visibility}`, targetType: "cause_update", targetId: updateId, data: { note } });
}

export async function openReports(ctx: Ctx) {
  return ctx.db
    .select({ r: storyReports, title: causeUpdates.title, visibility: causeUpdates.visibility })
    .from(storyReports)
    .innerJoin(causeUpdates, eq(causeUpdates.id, storyReports.updateId))
    .where(eq(storyReports.status, "open"))
    .orderBy(desc(storyReports.createdAt))
    .limit(50);
}

// ───────────────────────────── optional ads ─────────────────────────────

/** Requests an optional ad. Gives nothing in return, by design. Frequency-capped. */
export async function requestAd(ctx: Ctx, userId: string, placement: string) {
  const s = await getSettings(ctx.db);
  const since = new Date(ctx.now().getTime() - 86400_000);
  const recent = await ctx.db.select({ at: adViews.createdAt }).from(adViews).where(and(eq(adViews.userId, userId), sql`${adViews.createdAt} >= ${since.toISOString()}`)).orderBy(desc(adViews.createdAt));
  if (recent.length >= s.adDailyLimit) throw new AppError("ad_limit", "That's plenty for today. Thank you!");
  // test mode: a short gap so the demo can be shown again quickly (live keeps the admin setting, 3 min by default)
  const gapSeconds = ctx.environment === "sandbox" ? Math.min(s.adMinIntervalSeconds, 15) : s.adMinIntervalSeconds;
  if (recent[0] && ctx.now().getTime() - recent[0].at.getTime() < gapSeconds * 1000) throw new AppError("ad_too_soon", "Thanks! Let's give it a moment before another.");
  const p = adProvider(s.adsProductionEnabled);
  const slot = await p.request(placement);
  if (!slot) return null;
  const [v] = await ctx.db.insert(adViews).values({ userId, provider: p.name, simulated: p.simulated, placement, createdAt: ctx.now() }).returning();
  return { viewId: v.id, ...slot };
}

/** Test mode: roughly what one ad view earns for the pool (about half of a typical $0.02 view). */
const SANDBOX_GOLD_PER_VIEW_MICRO = 10_000n; // $0.01

export async function completeAd(ctx: Ctx, userId: string, viewId: string) {
  const [v] = await ctx.db.select().from(adViews).where(and(eq(adViews.id, viewId), eq(adViews.userId, userId)));
  if (!v) throw notFound("Ad view not found");
  const first = !v.completed;
  await ctx.db.update(adViews).set({ completed: true }).where(eq(adViews.id, viewId));
  // Live: ad money reaches the pool only once the provider pays, and is shared equally each month.
  // Test mode: show the idea right away, as a SIMULATED golden fruit on the viewer's Heart Tree.
  let goldenMicro = 0n;
  if (first && ctx.environment === "sandbox") goldenMicro = await sandboxAdGolden(ctx, userId);
  return { ok: true, reward: null, goldenMicro };
}

/** Test mode only: each completed ad tops up a simulated golden fruit for this month, aimed at the viewer's home town. */
async function sandboxAdGolden(ctx: Ctx, userId: string) {
  const now = ctx.now();
  const period = `ads-${now.toISOString().slice(0, 7)}`; // e.g. "ads-2026-11": separate from the real monthly cycles
  const s = await getSettings(ctx.db);
  await ctx.db
    .insert(poolCycles)
    .values({ environment: ctx.environment, period, status: "choosing", simulated: true, charityBps: s.poolCharityBps, choiceDeadline: null, history: [{ status: "choosing", at: now.toISOString(), note: "Test-mode ad views (simulated revenue)" }] })
    .onConflictDoNothing();
  const [cycle] = await ctx.db.select().from(poolCycles).where(and(eq(poolCycles.environment, ctx.environment), eq(poolCycles.period, period)));
  if (!cycle) return 0n;
  const [prefs] = await ctx.db.select({ home: helperPreferences.defaultCauseId }).from(helperPreferences).where(eq(helperPreferences.userId, userId));
  const choices = prefs?.home ? [{ causeId: prefs.home, bps: 10000 }] : [];
  await ctx.db
    .insert(poolAllocations)
    .values({ cycleId: cycle.id, userId, amountMicro: SANDBOX_GOLD_PER_VIEW_MICRO, choices, choiceSource: choices.length ? "default_beneficiary" : null, status: "allocated" })
    .onConflictDoUpdate({ target: [poolAllocations.cycleId, poolAllocations.userId], set: { amountMicro: sql`${poolAllocations.amountMicro} + ${SANDBOX_GOLD_PER_VIEW_MICRO.toString()}` } });
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "pool.sandbox_ad_golden", data: { period, addedMicro: SANDBOX_GOLD_PER_VIEW_MICRO } });
  return SANDBOX_GOLD_PER_VIEW_MICRO;
}
