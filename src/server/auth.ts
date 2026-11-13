import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { importSPKI, jwtVerify } from "jose";
import { z } from "zod";
import type { Db } from "./db/client";
import { loginCodes, sessions, userProfiles, users } from "./db/schema";
import { AppError, audit } from "./core";
import { env } from "./env";

export const SESSION_COOKIE = "hs_session";
const SESSION_DAYS = 14;
const CODE_TTL_MIN = 10;
const MAX_CODE_ATTEMPTS = 5;

export const emailSchema = z.string().trim().toLowerCase().email().max(200);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type SessionUser = typeof users.$inferSelect & { profile: typeof userProfiles.$inferSelect | null };

// ───────────────────────────── sessions ─────────────────────────────

export async function createSession(db: Db, userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

export async function userFromSessionToken(db: Db, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select({ u: users, p: userProfiles })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  if (!row || row.u.status !== "active") return null;
  return { ...row.u, profile: row.p };
}

export async function destroySession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

// ───────────────────────────── users ─────────────────────────────

function isBootstrapAdmin(email: string) {
  return env()
    .ADMIN_EMAILS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

export async function upsertUser(db: Db, i: { email: string; provider: "dev" | "privy"; subject?: string | null }) {
  const email = emailSchema.parse(i.email);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    if (isBootstrapAdmin(email) && existing.role !== "admin") await db.update(users).set({ role: "admin" }).where(eq(users.id, existing.id));
    if (i.subject && !existing.authSubject) await db.update(users).set({ authSubject: i.subject }).where(eq(users.id, existing.id));
    return existing;
  }
  const [u] = await db
    .insert(users)
    .values({ email, authProvider: i.provider, authSubject: i.subject ?? null, role: isBootstrapAdmin(email) ? "admin" : "user" })
    .returning();
  await db.insert(userProfiles).values({ userId: u.id, displayName: email.split("@")[0].slice(0, 24) });
  await audit(db, { actorId: u.id, actorType: "user", action: "user.created" });
  return u;
}

// ───────────────────────────── dev email codes ─────────────────────────────

/**
 * Development sign-in: a 6-digit code, hashed at rest, 10-minute expiry, 5 attempts.
 * The code is printed to the server log (no email service in dev). Refused in live mode.
 */
export async function requestDevCode(db: Db, rawEmail: string) {
  if (env().AUTH_PROVIDER !== "dev" || env().HUGSHIRE_MODE === "live") throw new AppError("auth_disabled", "Email codes are not enabled here.", 403);
  const email = emailSchema.parse(rawEmail);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginCodes).values({ email, codeHash: sha256(`${email}:${code}`), expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000) });
  console.log(`[hugshire dev auth] sign-in code for ${email}: ${code}`);
  // test mode only (email codes are refused in live mode above): hand the code back so the demo journey can fill it in
  return { email, devCode: env().HUGSHIRE_MODE === "sandbox" ? code : undefined };
}

export async function verifyDevCode(db: Db, rawEmail: string, code: string) {
  if (env().AUTH_PROVIDER !== "dev" || env().HUGSHIRE_MODE === "live") throw new AppError("auth_disabled", "Email codes are not enabled here.", 403);
  const email = emailSchema.parse(rawEmail);
  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= MAX_CODE_ATTEMPTS) throw new AppError("code_invalid", "That code has expired. Request a new one.", 401);
  const a = Buffer.from(row.codeHash, "hex");
  const b = Buffer.from(sha256(`${email}:${code.trim()}`), "hex");
  if (!timingSafeEqual(a, b)) {
    await db.update(loginCodes).set({ attempts: row.attempts + 1 }).where(eq(loginCodes.id, row.id));
    throw new AppError("code_invalid", "That code is not right.", 401);
  }
  await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));
  return upsertUser(db, { email, provider: "dev" });
}

// ───────────────────────────── Privy ─────────────────────────────

/**
 * Verifies a Privy access token (ES256, issuer "privy.io", audience = app id) using the
 * verification key from the Privy dashboard. Email comes from the identity token or user lookup.
 */
export async function verifyPrivyToken(accessToken: string) {
  const e = env();
  if (!e.PRIVY_APP_ID || !e.PRIVY_VERIFICATION_KEY) throw new AppError("auth_unconfigured", "Privy is not configured.", 503);
  const key = await importSPKI(e.PRIVY_VERIFICATION_KEY.replace(/\\n/g, "\n"), "ES256");
  const { payload } = await jwtVerify(accessToken, key, { issuer: "privy.io", audience: e.PRIVY_APP_ID });
  if (!payload.sub) throw new AppError("auth_invalid", "Invalid sign-in token.", 401);
  return { did: payload.sub };
}

// ───────────────────────────── RBAC ─────────────────────────────

export function requireUser(u: SessionUser | null): SessionUser {
  if (!u) throw new AppError("unauthenticated", "Please sign in first.", 401);
  return u;
}
export function requireAdmin(u: SessionUser | null): SessionUser {
  const x = requireUser(u);
  if (x.role !== "admin") throw new AppError("forbidden", "Admins only.", 403);
  return x;
}
