import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getDb } from "./db/client";
import { AppError } from "./core";
import { SESSION_COOKIE, userFromSessionToken, type SessionUser } from "./auth";
import { env } from "./env";
import { defaultCtx, type Ctx } from "./services/context";

/** The signed-in user for server components and route handlers. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userFromSessionToken(await getDb(), token);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "127.0.0.1").trim();
}

// ───────────────────────────── rate limiting ─────────────────────────────

const buckets = new Map<string, { tokens: number; at: number }>();
/** In-process token bucket. Enough for one instance; see KNOWN_LIMITATIONS for multi-instance. */
export function rateLimit(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) buckets.clear();
  return true;
}

// ───────────────────────────── route wrapper ─────────────────────────────

type Handler<T> = (a: { req: NextRequest; body: T; user: SessionUser | null; ctx: Ctx; ip: string; params: Record<string, string> }) => Promise<unknown>;

/**
 * Wraps a JSON route: same-origin check for mutations (CSRF), rate limit, zod validation,
 * consistent error envelope, bigint-safe JSON.
 */
export function route<T = unknown>(opts: { schema?: ZodType<T>; limit?: number; auth?: "user" | "admin" | "none" }, fn: Handler<T>) {
  return async (req: NextRequest, context: { params: Promise<Record<string, string>> }) => {
    try {
      const ip = await clientIp();
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        const allowed = new URL(env().APP_URL).origin;
        const self = req.nextUrl.origin;
        if (origin && origin !== allowed && origin !== self) throw new AppError("bad_origin", "Cross-site request refused.", 403);
      }
      if (!rateLimit(`${req.nextUrl.pathname}:${ip}`, opts.limit ?? 60)) throw new AppError("rate_limited", "Too many requests. Please slow down.", 429);
      const user = await currentUser();
      if (opts.auth === "user" && !user) throw new AppError("unauthenticated", "Please sign in first.", 401);
      if (opts.auth === "admin" && user?.role !== "admin") throw new AppError("forbidden", "Admins only.", 403);
      let body = undefined as T;
      if (opts.schema) {
        const raw = req.method === "GET" ? Object.fromEntries(req.nextUrl.searchParams) : await req.json().catch(() => ({}));
        body = opts.schema.parse(raw);
      }
      const ctx = await defaultCtx();
      const out = await fn({ req, body, user, ctx, ip, params: await context.params });
      if (out instanceof Response) return out;
      return json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return json({ error: { code: e.code, message: e.message } }, e.status);
  if (e instanceof ZodError) return json({ error: { code: "invalid_input", message: e.issues[0]?.message ?? "Invalid input", issues: e.issues.slice(0, 5) } }, 400);
  console.error("[hugshire] unhandled", e);
  return json({ error: { code: "internal", message: "Something went wrong on our side. Please try again in a moment." } }, 500);
}
