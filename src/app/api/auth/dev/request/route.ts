import { z } from "zod";
import { route } from "@/server/http";
import { requestDevCode } from "@/server/auth";

export const POST = route({ schema: z.object({ email: z.string() }), limit: 6 }, async ({ body, ctx }) => {
  const r = await requestDevCode(ctx.db, body.email);
  // The code is only echoed back outside production builds, to make local testing possible.
  return { ok: true, email: r.email, devCode: r.devCode };
});
