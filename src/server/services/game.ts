/**
 * V4 virtual construction economy (domain C). Wood and Stone are virtual, non-transferable and
 * have no monetary value. Nothing here reads or writes money accounts: the only financial input is
 * the supporter's verified principal (read from the ledger), which scales production.
 *
 * Server-authoritative: the server creates sessions, picks the resource, generates the secret
 * chart one round at a time, judges raw input timings, tracks hearts/combo/caps/cooldowns and
 * commits the result exactly once.
 */
import { randomInt } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { constructionProjects, gameSessions, helpers, resourceContributions, users, causes, cities, type Resource } from "../db/schema";
import { AppError, acct, audit, forbidden, liabilityBalance, notFound } from "../core";
import { inTx, type Ctx } from "./context";
import {
  RES_UNIT,
  RULES,
  applyRound,
  baseReward,
  judgeStone,
  judgeWood,
  pickResource,
  stoneRound,
  suspiciouslyPrecise,
  woodRound,
  type StoneRound,
  type WoodRound,
} from "@/game/v4/rules";
import { blueprint, isPlot } from "@/game/v4/town";

/** Reservations with no contributions expire after this long, freeing the plot and the initiator. */
export const RESERVATION_TTL_SECONDS = 24 * 3600;

// ───────────────────────────── eligibility ─────────────────────────────

/** Verified active principal from the double-entry ledger (never from the client). */
export async function eligiblePrincipal(ctx: Ctx, userId: string): Promise<bigint> {
  const [u] = await ctx.db.select({ status: users.status }).from(users).where(eq(users.id, userId));
  if (!u || u.status !== "active") return 0n;
  const p = await liabilityBalance(ctx.db, ctx.environment, acct.userPrincipal(userId));
  return p >= RULES.minEligiblePrincipalMicro ? p : 0n;
}

// ───────────────────────────── construction ─────────────────────────────

export async function townState(ctx: Ctx, causeId: string) {
  const projects = await ctx.db
    .select()
    .from(constructionProjects)
    .where(and(eq(constructionProjects.causeId, causeId), eq(constructionProjects.environment, ctx.environment), inArray(constructionProjects.status, ["reserved", "active", "completed"])));
  const ids = projects.map((p) => p.id);
  const contributors = ids.length
    ? await ctx.db
        .select({ projectId: resourceContributions.projectId, n: sql<number>`count(distinct ${resourceContributions.userId})::int` })
        .from(resourceContributions)
        .where(inArray(resourceContributions.projectId, ids))
        .groupBy(resourceContributions.projectId)
    : [];
  const cmap = new Map(contributors.map((c) => [c.projectId, c.n]));
  return projects.map((p) => ({
    id: p.id,
    plotKey: p.plotKey,
    blueprintKey: p.blueprintKey,
    status: p.status,
    initiatorId: p.initiatorId,
    woodRequired: p.woodRequired,
    stoneRequired: p.stoneRequired,
    woodContributed: p.woodContributed,
    stoneContributed: p.stoneContributed,
    contributors: cmap.get(p.id) ?? 0,
    completedAt: p.completedAt,
  }));
}

export async function startProject(ctx: Ctx, userId: string, i: { causeId: string; plotKey: string; blueprintKey: string }) {
  const plot = isPlot(i.plotKey);
  const bp = blueprint(i.blueprintKey);
  if (!plot) throw new AppError("bad_plot", "That is not an approved building plot.");
  if (!bp) throw new AppError("bad_blueprint", "Unknown blueprint.");
  if (bp.size !== plot.size) throw new AppError("blueprint_size", `This plot fits ${plot.size === "S" ? "small" : plot.size === "M" ? "medium" : "large"} buildings only.`);
  const [c] = await ctx.db.select().from(causes).where(eq(causes.id, i.causeId));
  if (!c || c.status !== "approved") throw notFound("Town not found");
  if ((await eligiblePrincipal(ctx, userId)) === 0n) throw new AppError("not_eligible", "Start a deposit to help build. Building resources come from active support.", 403);
  await expireReservations(ctx);
  const mine = await ctx.db
    .select()
    .from(constructionProjects)
    .where(and(eq(constructionProjects.environment, ctx.environment), eq(constructionProjects.initiatorId, userId), inArray(constructionProjects.status, ["reserved", "active"])));
  if (mine.length) throw new AppError("one_project", "You already started a building that isn't finished yet. You can still help on other buildings.");
  try {
    const [p] = await ctx.db
      .insert(constructionProjects)
      .values({
        causeId: i.causeId,
        environment: ctx.environment,
        plotKey: i.plotKey,
        blueprintKey: bp.key,
        initiatorId: userId,
        woodRequired: BigInt(bp.wood) * RES_UNIT,
        stoneRequired: BigInt(bp.stone) * RES_UNIT,
        lastActivityAt: ctx.now(),
        createdAt: ctx.now(),
      })
      .returning();
    await audit(ctx.db, { actorId: userId, actorType: "user", action: "construction.start", targetType: "construction_project", targetId: p.id, data: { plot: i.plotKey, blueprint: bp.key } });
    return p;
  } catch (e) {
    // the partial unique indexes are the race-safe backstop
    const msg = String((e as Error).message ?? e) + String((e as { cause?: unknown }).cause ?? "");
    if (msg.includes("project_plot_open")) throw new AppError("plot_taken", "Someone just started building on this plot.");
    if (msg.includes("project_initiator_open")) throw new AppError("one_project", "You already started a building that isn't finished yet.");
    throw e;
  }
}

/** Reserved plots with no contributions for RESERVATION_TTL_SECONDS are released. */
export async function expireReservations(ctx: Ctx) {
  const cutoff = new Date(ctx.now().getTime() - RESERVATION_TTL_SECONDS * 1000);
  const r = await ctx.db
    .update(constructionProjects)
    .set({ status: "expired" })
    .where(and(eq(constructionProjects.status, "reserved"), lt(constructionProjects.lastActivityAt, cutoff)))
    .returning({ id: constructionProjects.id });
  return { expired: r.length };
}

/**
 * Applies a contribution exactly once (unique source+refKey), clamped to what the building still
 * needs. Completes the building when both requirements are met. Returns what was actually applied.
 */
export async function contribute(ctx: Ctx, i: { projectId: string; userId: string; resource: Resource; amountMicro: bigint; source: "minigame" | "auto_worker"; refKey: string }) {
  return inTx(ctx, async (tx) => {
    const prior = await tx.db.select().from(resourceContributions).where(and(eq(resourceContributions.source, i.source), eq(resourceContributions.refKey, i.refKey)));
    if (prior.length) return { appliedMicro: prior[0].amountMicro, replay: true, completed: false };
    const locked = await tx.db.execute(sql`select * from construction_projects where id = ${i.projectId} for update`);
    void locked;
    const [p] = await tx.db.select().from(constructionProjects).where(eq(constructionProjects.id, i.projectId));
    if (!p || (p.status !== "active" && p.status !== "reserved")) return { appliedMicro: 0n, replay: false, completed: false };
    const have = i.resource === "wood" ? p.woodContributed : p.stoneContributed;
    const need = (i.resource === "wood" ? p.woodRequired : p.stoneRequired) - have;
    const amt = i.amountMicro < need ? i.amountMicro : need;
    if (amt <= 0n) return { appliedMicro: 0n, replay: false, completed: false };
    await tx.db.insert(resourceContributions).values({ projectId: p.id, userId: i.userId, environment: tx.environment, resource: i.resource, amountMicro: amt, source: i.source, refKey: i.refKey, createdAt: tx.now() });
    const wood = p.woodContributed + (i.resource === "wood" ? amt : 0n);
    const stone = p.stoneContributed + (i.resource === "stone" ? amt : 0n);
    const done = wood >= p.woodRequired && stone >= p.stoneRequired;
    await tx.db
      .update(constructionProjects)
      .set({ woodContributed: wood, stoneContributed: stone, status: done ? "completed" : "active", lastActivityAt: tx.now(), completedAt: done ? tx.now() : null })
      .where(eq(constructionProjects.id, p.id));
    if (done) await audit(tx.db, { actorType: "system", action: "construction.completed", targetType: "construction_project", targetId: p.id, data: { blueprint: p.blueprintKey } });
    return { appliedMicro: amt, replay: false, completed: done };
  });
}

// ───────────────────────────── cooldowns ─────────────────────────────

export async function cooldowns(ctx: Ctx, userId: string): Promise<Record<Resource, number | null>> {
  const out: Record<Resource, number | null> = { wood: null, stone: null };
  for (const r of ["wood", "stone"] as Resource[]) {
    const [last] = await ctx.db
      .select({ endedAt: gameSessions.endedAt })
      .from(gameSessions)
      .where(and(eq(gameSessions.userId, userId), eq(gameSessions.resource, r), eq(gameSessions.status, "ended")))
      .orderBy(desc(gameSessions.endedAt))
      .limit(1);
    let until = last?.endedAt ? last.endedAt.getTime() + RULES.cooldownSeconds * 1000 : 0;
    // daily safeguard
    const since = new Date(ctx.now().getTime() - 86400_000);
    const [d] = await ctx.db
      .select({ s: sql<string>`coalesce(sum(${resourceContributions.amountMicro}),0)::text` })
      .from(resourceContributions)
      .where(and(eq(resourceContributions.userId, userId), eq(resourceContributions.resource, r), eq(resourceContributions.source, "minigame"), gte(resourceContributions.createdAt, since)));
    if (BigInt(d.s) >= RULES.dailyCapMicro) until = Math.max(until, ctx.now().getTime() + 3600_000);
    out[r] = until > ctx.now().getTime() ? until : null;
  }
  return out;
}

// ───────────────────────────── sessions ─────────────────────────────

type Chart = WoodRound | StoneRound;
const chartFor = (resource: Resource, seed: number, round: number): Chart => (resource === "wood" ? woodRound(seed, round) : stoneRound(seed, round));

/** What the client may see of a round: the chart only (never the seed or future rounds). */
function publicRound(chart: Chart) {
  return chart;
}

function sessionView(s: typeof gameSessions.$inferSelect, chart: Chart | null) {
  return {
    id: s.id,
    resource: s.resource,
    status: s.status,
    endReason: s.endReason,
    hearts: s.hearts,
    combo: s.combo,
    bestCombo: s.bestCombo,
    round: s.round,
    earnedMicro: s.earnedMicro,
    baseRewardMicro: s.baseRewardMicro,
    capMicro: RULES.sessionCapMicro,
    expiresAt: s.expiresAt,
    stats: s.stats,
    chart: chart ? publicRound(chart) : null,
  };
}

/** Ends any of this user's sessions that ran past their expiry (counts toward cooldown). */
async function expireUserSessions(ctx: Ctx, userId?: string) {
  const now = ctx.now();
  const where = userId ? and(eq(gameSessions.status, "open"), eq(gameSessions.userId, userId), lt(gameSessions.expiresAt, now)) : and(eq(gameSessions.status, "open"), lt(gameSessions.expiresAt, now));
  const stale = await ctx.db.select().from(gameSessions).where(where);
  for (const s of stale) await endSession(ctx, s.id, "timeout");
  return stale.length;
}

export async function expireSessions(ctx: Ctx) {
  return { expired: await expireUserSessions(ctx) };
}

/** Work button: the server picks Wood or Stone, opens a session and reveals round 0. */
export async function startSession(ctx: Ctx, userId: string, projectId: string) {
  await expireUserSessions(ctx, userId);
  const [p] = await ctx.db.select().from(constructionProjects).where(eq(constructionProjects.id, projectId));
  if (!p || p.environment !== ctx.environment) throw notFound("Building not found");
  if (p.status === "completed") return { kind: "done" as const };
  if (p.status === "expired") throw new AppError("project_expired", "This plot reservation expired.");
  const principal = await eligiblePrincipal(ctx, userId);
  if (principal === 0n) throw new AppError("not_eligible", "An active deposit is needed to produce building resources.", 403);
  const open = await ctx.db.select().from(gameSessions).where(and(eq(gameSessions.userId, userId), eq(gameSessions.status, "open")));
  if (open.length) {
    // one session at a time, across tabs and devices: resume it instead of opening another
    const s = open[0];
    return { kind: "play" as const, session: sessionView(s, chartFor(s.resource, s.seed, s.round)), resumed: true };
  }
  const cd = await cooldowns(ctx, userId);
  const pick = pickResource(
    { wood: p.woodContributed < p.woodRequired, stone: p.stoneContributed < p.stoneRequired },
    cd,
    ctx.now().getTime(),
    randomInt(0, 1_000_000) / 1_000_000,
  );
  if (pick.kind === "done") return { kind: "done" as const };
  if (pick.kind === "wait") return { kind: "wait" as const, untilMs: pick.untilMs, cooldowns: cd };
  const seed = randomInt(1, 2 ** 31 - 1);
  const now = ctx.now();
  try {
    const [s] = await ctx.db
      .insert(gameSessions)
      .values({
        userId,
        environment: ctx.environment,
        projectId,
        resource: pick.resource,
        seed,
        baseRewardMicro: baseReward(principal),
        principalMicro: principal,
        hearts: RULES.hearts,
        roundRevealedAt: now,
        startedAt: now,
        expiresAt: new Date(now.getTime() + RULES.sessionMaxSeconds * 1000),
      })
      .returning();
    return { kind: "play" as const, session: sessionView(s, chartFor(s.resource, seed, 0)), resumed: false };
  } catch (e) {
    if (String((e as Error).message) + String((e as { cause?: unknown }).cause ?? "").includes("game_session_one_open")) throw new AppError("session_open", "You already have a game open in another tab.");
    throw e;
  }
}

export type RoundInput = { round: number; swings?: number[]; strikes?: { t: number; b: number }[] };

/** Judges one round of raw input timings and reveals the next round (or ends the session). */
export async function submitRound(ctx: Ctx, userId: string, sessionId: string, input: RoundInput) {
  const [s] = await ctx.db.select().from(gameSessions).where(eq(gameSessions.id, sessionId));
  if (!s) throw notFound("Session not found");
  if (s.userId !== userId) throw forbidden();
  if (s.status !== "open") return { session: sessionView(s, null), applied: [] };
  const now = ctx.now();
  if (now > s.expiresAt) {
    const ended = await endSession(ctx, s.id, "timeout");
    return { session: sessionView(ended, null), applied: [] };
  }
  if (input.round !== s.round) throw new AppError("round_mismatch", "That round was already submitted.", 409);
  const chart = chartFor(s.resource, s.seed, s.round);
  // a round cannot be finished faster than it takes to play it
  if (now.getTime() - s.roundRevealedAt.getTime() < chart.durationMs - RULES.submitSlackMs) throw new AppError("too_fast", "Round submitted before it could have been played.", 422);

  const { judgements } = chart.game === "wood" ? judgeWood(chart, input.swings ?? []) : judgeStone(chart, input.strikes ?? []);
  // anti-automation: inhumanly consistent timing zeroes the round and flags the session
  const raw = chart.game === "wood" ? input.swings ?? [] : (input.strikes ?? []).map((x) => x.t);
  const targets = chart.game === "wood" ? chart.events.filter((e) => e.kind === "log").map((e) => e.t) : chart.expected.map((e) => e.t);
  const deltas = raw.map((x) => {
    let best = Infinity;
    for (const t of targets) if (Math.abs(x - t) < Math.abs(best)) best = x - t;
    return best;
  }).filter((d) => Number.isFinite(d) && Math.abs(d) < 200);
  const flags = [...s.stats.flags];
  const precise = suspiciouslyPrecise(deltas);
  if (precise) flags.push(`precise:r${s.round}`);

  // budget: session cap and what the building still needs right now
  const [p] = await ctx.db.select().from(constructionProjects).where(eq(constructionProjects.id, s.projectId));
  const remaining = p ? (s.resource === "wood" ? p.woodRequired - p.woodContributed : p.stoneRequired - p.stoneContributed) : 0n;
  const budget = remaining < RULES.sessionCapMicro ? (remaining > 0n ? remaining : 0n) : RULES.sessionCapMicro;
  const base = precise ? 0n : s.baseRewardMicro;
  const r = applyRound({ hearts: s.hearts, combo: s.combo, bestCombo: s.bestCombo, earnedMicro: s.earnedMicro }, judgements, base, budget);
  const stats = { ...s.stats, flags };
  for (const a of r.applied) {
    if (a.result === "perfect") stats.perfect++;
    else if (a.result === "hit") stats.hit++;
    else if (a.result === "miss") stats.miss++;
    else stats.fakeouts++;
  }
  // optimistic lock on the round number: a replayed or concurrent submission cannot apply twice
  const updated = await ctx.db
    .update(gameSessions)
    .set({ hearts: r.state.hearts, combo: r.state.combo, bestCombo: r.state.bestCombo, earnedMicro: r.state.earnedMicro, round: s.round + 1, roundRevealedAt: now, stats })
    .where(and(eq(gameSessions.id, s.id), eq(gameSessions.round, s.round), eq(gameSessions.status, "open")))
    .returning();
  if (!updated.length) throw new AppError("round_mismatch", "That round was already submitted.", 409);
  let cur = updated[0];
  let reason: typeof s.endReason = null;
  if (flags.length >= 2) reason = "invalid";
  else if (r.stopped === "hearts") reason = "hearts";
  else if (r.stopped === "cap") reason = budget < RULES.sessionCapMicro ? "building_done" : "cap";
  else if (budget === 0n) reason = "building_done";
  if (reason) cur = await endSession(ctx, s.id, reason);
  return { session: sessionView(cur, cur.status === "open" ? chartFor(cur.resource, cur.seed, cur.round) : null), applied: r.applied.map((a) => ({ ...a, rewardMicro: a.rewardMicro.toString() })) };
}

export async function quitSession(ctx: Ctx, userId: string, sessionId: string) {
  const [s] = await ctx.db.select().from(gameSessions).where(eq(gameSessions.id, sessionId));
  if (!s) throw notFound();
  if (s.userId !== userId) throw forbidden();
  const ended = s.status === "open" ? await endSession(ctx, s.id, "quit") : s;
  return { session: sessionView(ended, null) };
}

/**
 * Ends a session (idempotent) and commits its earned resources to the building exactly once.
 * Resources earned before Game Over are kept. An invalidated session commits nothing.
 */
async function endSession(ctx: Ctx, id: string, reason: NonNullable<(typeof gameSessions.$inferSelect)["endReason"]>) {
  const now = ctx.now();
  const r = await ctx.db
    .update(gameSessions)
    .set({ status: "ended", endReason: reason, endedAt: now })
    .where(and(eq(gameSessions.id, id), eq(gameSessions.status, "open")))
    .returning();
  const [s] = r.length ? r : await ctx.db.select().from(gameSessions).where(eq(gameSessions.id, id));
  if (s.committedAt) return s;
  if (reason !== "invalid" && s.earnedMicro > 0n) {
    const c = await contribute(ctx, { projectId: s.projectId, userId: s.userId, resource: s.resource, amountMicro: s.earnedMicro, source: "minigame", refKey: s.id });
    const [u] = await ctx.db.update(gameSessions).set({ committedAt: now, earnedMicro: c.appliedMicro }).where(and(eq(gameSessions.id, s.id), isNull(gameSessions.committedAt))).returning();
    return u ?? s;
  }
  const [u] = await ctx.db.update(gameSessions).set({ committedAt: now, earnedMicro: reason === "invalid" ? 0n : s.earnedMicro }).where(and(eq(gameSessions.id, s.id), isNull(gameSessions.committedAt))).returning();
  return u ?? s;
}

// ───────────────────────────── auto workers ─────────────────────────────

/**
 * Offline production by animal workers (hourly, idempotent per user per hour). Same deposit scaling,
 * no Perfect or combo bonuses, ~25× slower than baseline manual play. Skips players with an open
 * session. Target: the supporter's own unfinished building, else their last unfinished building,
 * else the oldest unfinished building in their helper's home town.
 */
export async function runAutoWorkers(ctx: Ctx) {
  const hour = Math.floor(ctx.now().getTime() / 3600_000);
  const roster = await ctx.db.selectDistinct({ userId: helpers.userId, causeId: helpers.causeId }).from(helpers).where(eq(helpers.environment, ctx.environment));
  const byUser = new Map<string, string[]>();
  for (const r of roster) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.causeId]);
  let applied = 0;
  for (const [userId, homeCauses] of byUser) {
    const principal = await eligiblePrincipal(ctx, userId);
    if (principal === 0n) continue;
    const open = await ctx.db.select({ id: gameSessions.id }).from(gameSessions).where(and(eq(gameSessions.userId, userId), eq(gameSessions.status, "open")));
    if (open.length) continue;
    const target = await autoTarget(ctx, userId, homeCauses);
    if (!target) continue;
    const needWood = target.woodContributed < target.woodRequired;
    const needStone = target.stoneContributed < target.stoneRequired;
    const resource: Resource = needWood && needStone ? (hour % 2 ? "stone" : "wood") : needWood ? "wood" : "stone";
    const amount = baseReward(principal) * RULES.autoBasePerHour;
    if (amount <= 0n) continue;
    const c = await contribute(ctx, { projectId: target.id, userId, resource, amountMicro: amount, source: "auto_worker", refKey: `auto:${userId}:${hour}` });
    if (c.appliedMicro > 0n && !c.replay) applied++;
  }
  return { applied };
}

async function autoTarget(ctx: Ctx, userId: string, homeCauses: string[]) {
  const unfinished = and(eq(constructionProjects.environment, ctx.environment), inArray(constructionProjects.status, ["reserved", "active"]));
  const [own] = await ctx.db.select().from(constructionProjects).where(and(unfinished, eq(constructionProjects.initiatorId, userId)));
  if (own) return own;
  const [last] = await ctx.db
    .select({ p: constructionProjects })
    .from(resourceContributions)
    .innerJoin(constructionProjects, eq(constructionProjects.id, resourceContributions.projectId))
    .where(and(eq(resourceContributions.userId, userId), unfinished))
    .orderBy(desc(resourceContributions.createdAt))
    .limit(1);
  if (last) return last.p;
  if (!homeCauses.length) return null;
  const [home] = await ctx.db.select().from(constructionProjects).where(and(unfinished, inArray(constructionProjects.causeId, homeCauses), ne(constructionProjects.status, "reserved"))).orderBy(constructionProjects.createdAt).limit(1);
  return home ?? null;
}

// ───────────────────────────── per-player summary ─────────────────────────────

export async function myGameSummary(ctx: Ctx, userId: string) {
  const principal = await eligiblePrincipal(ctx, userId);
  const cd = await cooldowns(ctx, userId);
  const [own] = await ctx.db
    .select({ p: constructionProjects, causeTitle: causes.title, cityName: cities.name })
    .from(constructionProjects)
    .innerJoin(causes, eq(causes.id, constructionProjects.causeId))
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .where(and(eq(constructionProjects.environment, ctx.environment), eq(constructionProjects.initiatorId, userId), inArray(constructionProjects.status, ["reserved", "active"])));
  const totals = await ctx.db
    .select({ resource: resourceContributions.resource, source: resourceContributions.source, s: sql<string>`sum(${resourceContributions.amountMicro})::text` })
    .from(resourceContributions)
    .where(eq(resourceContributions.userId, userId))
    .groupBy(resourceContributions.resource, resourceContributions.source);
  const open = await ctx.db.select().from(gameSessions).where(and(eq(gameSessions.userId, userId), eq(gameSessions.status, "open")));
  return {
    eligible: principal > 0n,
    principalMicro: principal,
    baseRewardMicro: baseReward(principal),
    autoPerHourMicro: baseReward(principal) * RULES.autoBasePerHour,
    cooldowns: cd,
    ownProject: own ? { ...own.p, causeTitle: own.causeTitle, cityName: own.cityName } : null,
    openSessionId: open[0]?.id ?? null,
    totals: totals.map((t) => ({ resource: t.resource, source: t.source, micro: BigInt(t.s) })),
  };
}
