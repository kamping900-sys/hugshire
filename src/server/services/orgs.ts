import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminActions,
  CAUSE_CATEGORIES,
  causes,
  causeUpdates,
  charityPayouts,
  cities,
  deliveries,
  helpers,
  organizationMembers,
  organizations,
  organizationVerifications,
} from "../db/schema";
import { AppError, audit, forbidden, notFound, slugify } from "../core";
import type { Ctx } from "./context";

// ───────────────────────────── validation ─────────────────────────────

const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const nearAccountSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .refine((s) => NEAR_ACCOUNT.test(s), "Enter a valid NEAR account (for example: myorg.near)");

export const createOrgInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).default(""),
  website: z.string().trim().url().max(200).optional().or(z.literal("").transform(() => undefined)),
  contactEmail: z.string().trim().email().max(200),
  taxId: z.string().trim().max(40).optional(),
});

export const causeInput = z.object({
  title: z.string().trim().min(4).max(80),
  summary: z.string().trim().min(10).max(200),
  description: z.string().trim().max(5000).default(""),
  category: z.enum(CAUSE_CATEGORIES),
  cityName: z.string().trim().min(2).max(40),
  goalUsd: z.coerce.number().int().min(100).max(10_000_000),
});

export const updateInput = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(4000) });

const MAP_TYPE: Record<(typeof CAUSE_CATEGORIES)[number], "school" | "shelter" | "nature" | "care" | "food" | "rebuild"> = {
  education: "school",
  animals: "shelter",
  nature: "nature",
  health: "care",
  food: "food",
  community: "rebuild",
};

// ───────────────────────────── city stages ─────────────────────────────

export const STAGES = ["Abandoned", "Cleared", "Foundations", "Small Town", "Growing Town", "Thriving Community"] as const;
/** Fraction (in basis points of the symbolic goal) where each stage starts. */
const STAGE_BPS = [0, 300, 1200, 3000, 6000, 9000];

/** City stage from REAL yield paid to the cause vs its symbolic goal. Gameplay cannot move it. */
export function computeStage(paidMicro: bigint, goalMicro: bigint): { index: number; name: (typeof STAGES)[number]; progressBps: number } {
  const bps = goalMicro > 0n ? Number((paidMicro * 10_000n) / goalMicro) : 0;
  let idx = 0;
  for (let k = 0; k < STAGE_BPS.length; k++) if (bps >= STAGE_BPS[k] && (k === 0 || paidMicro > 0n)) idx = k;
  return { index: idx, name: STAGES[idx], progressBps: Math.min(bps, 10_000) };
}

// ───────────────────────────── organisations ─────────────────────────────

export async function myOrgs(ctx: Ctx, userId: string) {
  return ctx.db
    .select({ org: organizations, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(eq(organizationMembers.userId, userId));
}

export async function requireOrgMember(ctx: Ctx, userId: string, orgId: string, role: "owner" | "editor" = "editor") {
  const [m] = await ctx.db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  if (!m || (role === "owner" && m.role !== "owner")) throw forbidden("You are not a member of this organisation.");
  return m;
}

export async function createOrganization(ctx: Ctx, userId: string, input: z.infer<typeof createOrgInput>) {
  const base = slugify(input.name) || "org";
  let slug = base;
  for (let n = 2; (await ctx.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug))).length; n++) slug = `${base}-${n}`;
  const [org] = await ctx.db
    .insert(organizations)
    .values({ ...input, slug, status: "pending", createdBy: userId })
    .returning();
  await ctx.db.insert(organizationMembers).values({ orgId: org.id, userId, role: "owner" });
  await ctx.db.insert(organizationVerifications).values({ orgId: org.id, kind: "registration" });
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "org.created", targetType: "organization", targetId: org.id });
  return org;
}

export async function setPayoutAccount(ctx: Ctx, userId: string, orgId: string, account: string) {
  await requireOrgMember(ctx, userId, orgId, "owner");
  const acc = nearAccountSchema.parse(account);
  await ctx.db.update(organizations).set({ payoutNearAccount: acc, payoutVerifiedAt: null }).where(eq(organizations.id, orgId));
  // Changing the receiving account always requires fresh admin verification, and un-readies causes.
  await ctx.db.update(causes).set({ payoutReadyAt: null }).where(eq(causes.orgId, orgId));
  await ctx.db.insert(organizationVerifications).values({ orgId, kind: "payout_account", notes: acc });
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "org.payout_account_changed", targetType: "organization", targetId: orgId, data: { account: acc } });
}

// ───────────────────────────── causes ─────────────────────────────

export async function createCause(ctx: Ctx, userId: string, orgId: string, input: z.infer<typeof causeInput>) {
  await requireOrgMember(ctx, userId, orgId);
  const base = slugify(input.cityName) || "city";
  let slug = base;
  for (let n = 2; (await ctx.db.select({ id: causes.id }).from(causes).where(eq(causes.slug, slug))).length; n++) slug = `${base}-${n}`;
  const [cause] = await ctx.db
    .insert(causes)
    .values({
      orgId,
      slug,
      title: input.title,
      summary: input.summary,
      description: input.description,
      category: input.category,
      goalMicro: BigInt(input.goalUsd) * 1_000_000n,
      status: "draft",
    })
    .returning();
  const count = (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(cities))[0].n;
  const spot = worldSpot(Number(count));
  await ctx.db.insert(cities).values({ causeId: cause.id, name: input.cityName, mapType: MAP_TYPE[input.category], worldX: spot.x, worldY: spot.y, seed: hashSeed(cause.id) });
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "cause.created", targetType: "cause", targetId: cause.id });
  return cause;
}

export async function updateCause(ctx: Ctx, userId: string, causeId: string, input: Partial<z.infer<typeof causeInput>>) {
  const [c] = await ctx.db.select().from(causes).where(eq(causes.id, causeId));
  if (!c) throw notFound();
  await requireOrgMember(ctx, userId, c.orgId);
  if (c.status === "suspended") throw new AppError("suspended", "This cause is suspended. Contact Hugshire support.");
  const patch: Partial<typeof causes.$inferInsert> = { updatedAt: ctx.now() };
  if (input.title) patch.title = input.title;
  if (input.summary) patch.summary = input.summary;
  if (input.description !== undefined) patch.description = input.description;
  if (input.category) patch.category = input.category;
  if (input.goalUsd) patch.goalMicro = BigInt(input.goalUsd) * 1_000_000n;
  // Material edits to an approved cause go back to review.
  if (c.status === "approved" && (input.title || input.summary || input.category)) patch.status = "pending_review";
  await ctx.db.update(causes).set(patch).where(eq(causes.id, causeId));
  if (input.cityName) await ctx.db.update(cities).set({ name: input.cityName }).where(eq(cities.causeId, causeId));
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "cause.updated", targetType: "cause", targetId: causeId });
}

export async function submitCause(ctx: Ctx, userId: string, causeId: string) {
  const [c] = await ctx.db.select().from(causes).where(eq(causes.id, causeId));
  if (!c) throw notFound();
  await requireOrgMember(ctx, userId, c.orgId);
  if (!["draft", "rejected"].includes(c.status)) throw new AppError("bad_state", "Only drafts can be submitted for review.");
  await ctx.db.update(causes).set({ status: "pending_review", updatedAt: ctx.now() }).where(eq(causes.id, causeId));
}

export async function postCauseUpdate(ctx: Ctx, userId: string, causeId: string, input: z.infer<typeof updateInput>) {
  const [c] = await ctx.db.select().from(causes).where(eq(causes.id, causeId));
  if (!c) throw notFound();
  await requireOrgMember(ctx, userId, c.orgId);
  const [u] = await ctx.db.insert(causeUpdates).values({ causeId, authorId: userId, ...input, kind: "note" }).returning();
  return u;
}

// ───────────────────────────── admin decisions ─────────────────────────────

async function adminLog(ctx: Ctx, adminId: string, action: string, targetType: string, targetId: string, reason?: string) {
  await ctx.db.insert(adminActions).values({ adminId, action, targetType, targetId, reason });
  await audit(ctx.db, { actorId: adminId, actorType: "admin", action, targetType, targetId, data: { reason } });
}

export async function decideOrganization(ctx: Ctx, adminId: string, orgId: string, decision: "approved" | "rejected" | "suspended", reason?: string) {
  const [o] = await ctx.db.update(organizations).set({ status: decision }).where(eq(organizations.id, orgId)).returning();
  if (!o) throw notFound();
  await ctx.db
    .update(organizationVerifications)
    .set({ status: decision === "approved" ? "approved" : "rejected", reviewerId: adminId, decidedAt: ctx.now(), notes: reason })
    .where(and(eq(organizationVerifications.orgId, orgId), eq(organizationVerifications.kind, "registration"), eq(organizationVerifications.status, "pending")));
  if (decision === "suspended") await ctx.db.update(causes).set({ status: "suspended" }).where(eq(causes.orgId, orgId));
  await adminLog(ctx, adminId, `org.${decision}`, "organization", orgId, reason);
  return o;
}

/**
 * Marks the org's payout account verified. In live mode the admin must ALSO have added the account
 * to the Vault allowlist on chain (owner multisig); this records that it was done.
 */
export async function verifyPayoutAccount(ctx: Ctx, adminId: string, orgId: string, reason?: string) {
  const [o] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!o?.payoutNearAccount) throw new AppError("no_account", "The organisation has not set a receiving account.");
  if (o.status !== "approved") throw new AppError("org_not_approved", "Approve the organisation first.");
  await ctx.db.update(organizations).set({ payoutVerifiedAt: ctx.now() }).where(eq(organizations.id, orgId));
  await ctx.db.update(causes).set({ payoutReadyAt: ctx.now() }).where(and(eq(causes.orgId, orgId), eq(causes.status, "approved")));
  await ctx.db
    .update(organizationVerifications)
    .set({ status: "approved", reviewerId: adminId, decidedAt: ctx.now() })
    .where(and(eq(organizationVerifications.orgId, orgId), eq(organizationVerifications.kind, "payout_account"), eq(organizationVerifications.status, "pending")));
  await adminLog(ctx, adminId, "org.payout_verified", "organization", orgId, reason);
}

export async function decideCause(ctx: Ctx, adminId: string, causeId: string, decision: "approved" | "rejected" | "suspended", reason?: string) {
  const [c] = await ctx.db.select({ c: causes, org: organizations }).from(causes).innerJoin(organizations, eq(organizations.id, causes.orgId)).where(eq(causes.id, causeId));
  if (!c) throw notFound();
  if (decision === "approved" && c.org.status !== "approved") throw new AppError("org_not_approved", "Approve the organisation first.");
  await ctx.db
    .update(causes)
    .set({ status: decision, reviewNote: reason ?? null, updatedAt: ctx.now(), payoutReadyAt: decision === "approved" && c.org.payoutVerifiedAt ? ctx.now() : null })
    .where(eq(causes.id, causeId));
  await adminLog(ctx, adminId, `cause.${decision}`, "cause", causeId, reason);
}

export async function verifyCauseUpdate(ctx: Ctx, adminId: string, updateId: string) {
  await ctx.db.update(causeUpdates).set({ kind: "verified_progress", verifiedBy: adminId, verifiedAt: ctx.now() }).where(eq(causeUpdates.id, updateId));
  await adminLog(ctx, adminId, "update.verified", "cause_update", updateId);
}

// ───────────────────────────── public reads ─────────────────────────────

export type CauseCard = Awaited<ReturnType<typeof listPublicCauses>>[number];

export async function listPublicCauses(ctx: Ctx, q?: { search?: string; category?: string }) {
  const where = [eq(causes.status, "approved"), eq(organizations.status, "approved")];
  if (q?.search) where.push(or(ilike(causes.title, `%${q.search}%`), ilike(cities.name, `%${q.search}%`), ilike(organizations.name, `%${q.search}%`))!);
  if (q?.category && (CAUSE_CATEGORIES as readonly string[]).includes(q.category)) where.push(eq(causes.category, q.category as never));
  const list = await ctx.db
    .select({ cause: causes, city: cities, org: { id: organizations.id, name: organizations.name, slug: organizations.slug, isSample: organizations.isSample } })
    .from(causes)
    .innerJoin(organizations, eq(organizations.id, causes.orgId))
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .where(and(...where))
    .orderBy(desc(causes.createdAt));
  const stats = await causeStats(ctx, list.map((l) => l.cause.id));
  return list.map((l) => {
    const s = stats.get(l.cause.id) ?? { paidMicro: 0n, pendingMicro: 0n, helpers: 0 };
    return { ...l, stats: s, stage: computeStage(s.paidMicro, l.cause.goalMicro) };
  });
}

export async function causeStats(ctx: Ctx, causeIds: string[]) {
  const out = new Map<string, { paidMicro: bigint; pendingMicro: bigint; helpers: number }>();
  if (!causeIds.length) return out;
  for (const id of causeIds) out.set(id, { paidMicro: 0n, pendingMicro: 0n, helpers: 0 });
  const paid = await ctx.db
    .select({ causeId: charityPayouts.causeId, s: sql<string>`sum(${charityPayouts.amountMicro})::text` })
    .from(charityPayouts)
    .where(and(inArray(charityPayouts.causeId, causeIds), eq(charityPayouts.status, "confirmed"), eq(charityPayouts.environment, ctx.environment)))
    .groupBy(charityPayouts.causeId);
  for (const p of paid) out.get(p.causeId)!.paidMicro = BigInt(p.s);
  const pend = await ctx.db
    .select({ causeId: deliveries.causeId, s: sql<string>`sum(${deliveries.amountMicro})::text` })
    .from(deliveries)
    .where(and(inArray(deliveries.causeId, causeIds), inArray(deliveries.status, ["pending", "queued"]), eq(deliveries.environment, ctx.environment)))
    .groupBy(deliveries.causeId);
  for (const p of pend) out.get(p.causeId)!.pendingMicro = BigInt(p.s);
  const hc = await ctx.db
    .select({ causeId: helpers.causeId, n: sql<number>`count(*)::int` })
    .from(helpers)
    .where(and(inArray(helpers.causeId, causeIds), eq(helpers.environment, ctx.environment)))
    .groupBy(helpers.causeId);
  for (const h of hc) out.get(h.causeId)!.helpers = Number(h.n);
  return out;
}

export async function getCauseBySlug(ctx: Ctx, slug: string) {
  const [row] = await ctx.db
    .select({ cause: causes, city: cities, org: organizations })
    .from(causes)
    .innerJoin(organizations, eq(organizations.id, causes.orgId))
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .where(eq(causes.slug, slug));
  if (!row) return null;
  const stats = (await causeStats(ctx, [row.cause.id])).get(row.cause.id)!;
  const updates = await ctx.db.select().from(causeUpdates).where(eq(causeUpdates.causeId, row.cause.id)).orderBy(desc(causeUpdates.createdAt)).limit(20);
  return { ...row, stats, stage: computeStage(stats.paidMicro, row.cause.goalMicro), updates };
}

// ───────────────────────────── helpers ─────────────────────────────

/** Deterministic world placement on a loose spiral so cities never overlap. */
export function worldSpot(n: number) {
  const angle = n * 2.399963; // golden angle
  const r = 260 + 210 * Math.sqrt(n);
  return { x: Math.round(1600 + Math.cos(angle) * r), y: Math.round(1200 + Math.sin(angle) * r * 0.72) };
}

export function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 2_147_483_647;
}
