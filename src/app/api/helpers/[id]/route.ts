import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/server/http";
import { ANIMALS, helpers } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/core";

export const PATCH = route(
  {
    auth: "user",
    schema: z.object({
      nickname: z.string().trim().min(1).max(24).optional(),
      animal: z.enum(ANIMALS).optional(),
      controlPreference: z.enum(["manual", "auto"]).optional(),
    }),
  },
  async ({ body, user, ctx, params }) => {
    const [h] = await ctx.db.select().from(helpers).where(eq(helpers.id, params.id));
    if (!h) throw notFound("Helper not found");
    if (h.userId !== user!.id) throw forbidden();
    const patch: Partial<typeof helpers.$inferInsert> = {};
    if (body.nickname) patch.nickname = body.nickname;
    if (body.animal) patch.animal = body.animal;
    if (body.controlPreference) {
      patch.controlPreference = body.controlPreference;
      patch.lastPlayerActionAt = ctx.now(); // choosing is itself a player action
    }
    const [u] = await ctx.db.update(helpers).set(patch).where(eq(helpers.id, h.id)).returning();
    return { helper: u };
  },
);
