/** Overworld summaries, detailed-town snapshots and lightweight multiplayer presence. */
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { causes, cities, constructionProjects, deliveries, helpers, organizations, userProfiles } from "../db/schema";
import { notFound, rows } from "../core";
import type { Ctx } from "./context";
import { myGameSummary, townState } from "./game";
import { heartTree } from "./heartTree";
import { noticeBoard } from "./stories";
import { isDeliverable } from "./deliveries";

/** DB animal → world mascot sprite. */
export const MASCOT_OF: Record<string, string> = { cat: "cat", bunny: "rabbit", otter: "otter", fox: "fox", bear: "panda", dog: "dog", raccoon: "raccoon", capybara: "bird" };

export async function worldTowns(ctx: Ctx) {
  const list = await ctx.db
    .select({ id: causes.id, slug: causes.slug, title: causes.title, summary: causes.summary, category: causes.category, isSample: causes.isSample, cityName: cities.name, seed: cities.seed, org: organizations.name })
    .from(causes)
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .innerJoin(organizations, eq(organizations.id, causes.orgId))
    .where(eq(causes.status, "approved"));
  if (!list.length) return [];
  const ids = list.map((c) => c.id);
  const proj = await ctx.db
    .select({ causeId: constructionProjects.causeId, status: constructionProjects.status, w: constructionProjects.woodContributed, wr: constructionProjects.woodRequired, s: constructionProjects.stoneContributed, sr: constructionProjects.stoneRequired })
    .from(constructionProjects)
    .where(and(inArray(constructionProjects.causeId, ids), eq(constructionProjects.environment, ctx.environment), inArray(constructionProjects.status, ["reserved", "active", "completed"])));
  const hc = await ctx.db.select({ causeId: helpers.causeId, n: sql<number>`count(*)::int` }).from(helpers).where(and(inArray(helpers.causeId, ids), eq(helpers.environment, ctx.environment))).groupBy(helpers.causeId);
  const paid = rows<{ cause_id: string; s: string }>(
    await ctx.db.execute(sql`select cause_id, coalesce(sum(amount_micro),0)::text as s from deliveries where status = 'paid' and environment = ${ctx.environment} group by cause_id`),
  );
  const paidBy = new Map(paid.map((p) => [p.cause_id, BigInt(p.s)]));
  return list.map((c) => {
    const ps = proj.filter((p) => p.causeId === c.id);
    const done = ps.filter((p) => p.status === "completed").length;
    const open = ps.filter((p) => p.status !== "completed");
    const need = open.reduce((a, p) => a + p.wr + p.sr, 0n);
    const have = open.reduce((a, p) => a + p.w + p.s, 0n);
    return {
      ...c,
      completed: done,
      underConstruction: open.length,
      constructionBps: need > 0n ? Number((have * 10000n) / need) : 0,
      helpers: hc.find((h) => h.causeId === c.id)?.n ?? 0,
      deliveredMicro: (paidBy.get(c.id) ?? 0n).toString(),
    };
  });
}

export async function causeBySlug(ctx: Ctx, slug: string) {
  const [row] = await ctx.db
    .select({ c: causes, city: cities, org: organizations })
    .from(causes)
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .innerJoin(organizations, eq(organizations.id, causes.orgId))
    .where(eq(causes.slug, slug));
  if (!row || row.c.status !== "approved") throw notFound("Town not found");
  return row;
}

export async function townSnapshot(ctx: Ctx, slug: string, viewerId: string | null) {
  const { c, city, org } = await causeBySlug(ctx, slug);
  const projects = await townState(ctx, c.id);
  const notices = await noticeBoard(ctx, c.id);
  let me = null;
  if (viewerId) {
    const [h] = await ctx.db.select().from(helpers).where(and(eq(helpers.userId, viewerId), eq(helpers.environment, ctx.environment))).limit(1);
    const [prof] = await ctx.db.select().from(userProfiles).where(eq(userProfiles.userId, viewerId));
    me = {
      userId: viewerId,
      mascot: MASCOT_OF[h?.animal ?? prof?.favoriteAnimal ?? "cat"] ?? "cat",
      nickname: h?.nickname ?? prof?.displayName ?? "You",
      game: await myGameSummary(ctx, viewerId),
      tree: await heartTree(ctx, viewerId),
    };
  }
  return {
    town: { id: c.id, slug: c.slug, title: c.title, summary: c.summary, category: c.category, cityName: city.name, seed: city.seed, org: org.name, isSample: c.isSample, deliverable: await isDeliverable(ctx, c.id) },
    projects,
    notices,
    me,
  };
}

// ───────────────────────────── presence (single-instance, in memory) ─────────────────────────────
// Good enough for one web instance. Multi-instance deployments need Redis pub/sub or a WebSocket
// service (KNOWN_LIMITATIONS). Presence is cosmetic: it never affects resources or money.

type Pres = { userId: string; mascot: string; nickname: string; x: number; y: number; dir: string; working: boolean; at: number };
const g = globalThis as unknown as { __hsPresence?: Map<string, Map<string, Pres>> };
const towns = (g.__hsPresence ??= new Map());

/** Stable, non-reversible key so clients can interpolate movement without seeing user ids. */
const anonKey = (id: string) => createHash("sha256").update("presence:" + id).digest("hex").slice(0, 12);

export function updatePresence(causeId: string, p: Omit<Pres, "at">) {
  let m = towns.get(causeId);
  if (!m) towns.set(causeId, (m = new Map()));
  for (const [, other] of towns) if (other !== m) other.delete(p.userId); // one town at a time
  m.set(p.userId, { ...p, at: Date.now() });
  return listPresence(causeId, p.userId);
}

export function listPresence(causeId: string, exceptUserId?: string) {
  const m = towns.get(causeId);
  if (!m) return [];
  const now = Date.now();
  const out: (Omit<Pres, "userId"> & { key: string })[] = [];
  for (const [id, p] of m) {
    if (now - p.at > 12_000) m.delete(id);
    else if (id !== exceptUserId) out.push({ key: anonKey(id), mascot: p.mascot, nickname: p.nickname, x: p.x, y: p.y, dir: p.dir, working: p.working, at: p.at });
  }
  return out.slice(0, 40);
}

export { deliveries };
