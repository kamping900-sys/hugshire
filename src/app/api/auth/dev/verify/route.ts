import { z } from "zod";
import { cookies } from "next/headers";
import { route } from "@/server/http";
import { createSession, SESSION_COOKIE, verifyDevCode } from "@/server/auth";
import { env } from "@/server/env";

export const POST = route({ schema: z.object({ email: z.string(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }), limit: 10 }, async ({ body, ctx, ip, req }) => {
  const user = await verifyDevCode(ctx.db, body.email, body.code);
  const s = await createSession(ctx.db, user.id, { ip, userAgent: req.headers.get("user-agent") });
  (await cookies()).set(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "lax", secure: env().APP_URL.startsWith("https"), path: "/", expires: s.expiresAt });
  return { ok: true };
});
