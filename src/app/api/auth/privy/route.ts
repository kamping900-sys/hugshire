import { z } from "zod";
import { cookies } from "next/headers";
import { route } from "@/server/http";
import { createSession, SESSION_COOKIE, upsertUser, verifyPrivyToken } from "@/server/auth";
import { AppError } from "@/server/core";
import { env } from "@/server/env";
import { verifyPrivyIdentity } from "@/server/privy";

/**
 * Exchanges a Privy access token + identity token for a Hugshire session.
 * The email comes from Privy's signed identity token, never from the request body.
 */
export const POST = route({ schema: z.object({ accessToken: z.string().min(20), identityToken: z.string().min(20) }), limit: 10 }, async ({ body, ctx, ip, req }) => {
  if (env().AUTH_PROVIDER !== "privy") throw new AppError("auth_disabled", "Privy sign-in is not enabled.", 403);
  const { did } = await verifyPrivyToken(body.accessToken);
  const identity = await verifyPrivyIdentity(body.identityToken, did);
  const user = await upsertUser(ctx.db, { email: identity.email, provider: "privy", subject: did });
  const s = await createSession(ctx.db, user.id, { ip, userAgent: req.headers.get("user-agent") });
  (await cookies()).set(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "lax", secure: true, path: "/", expires: s.expiresAt });
  return { ok: true };
});
