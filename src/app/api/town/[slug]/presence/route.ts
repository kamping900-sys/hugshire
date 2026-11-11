import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { route } from "@/server/http";
import { causeBySlug, updatePresence, MASCOT_OF } from "@/server/services/towns";
import { townState } from "@/server/services/game";
import { helpers, userProfiles } from "@/server/db/schema";

/** Heartbeat: where my helper is. Returns other visitors and the latest shared building state. */
export const POST = route(
  {
    auth: "user",
    limit: 120,
    schema: z.object({ x: z.number().min(0).max(4000), y: z.number().min(0).max(4000), dir: z.enum(["front", "back", "side", "sideL"]).default("front"), working: z.boolean().default(false) }),
  },
  async ({ ctx, user, body, params }) => {
    const { c } = await causeBySlug(ctx, params.slug);
    const [h] = await ctx.db.select().from(helpers).where(and(eq(helpers.userId, user!.id), eq(helpers.environment, ctx.environment))).limit(1);
    const [prof] = await ctx.db.select().from(userProfiles).where(eq(userProfiles.userId, user!.id));
    const others = updatePresence(c.id, {
      userId: user!.id,
      mascot: MASCOT_OF[h?.animal ?? prof?.favoriteAnimal ?? "cat"] ?? "cat",
      nickname: h?.nickname ?? prof?.displayName ?? "Friend",
      x: body.x,
      y: body.y,
      dir: body.dir,
      working: body.working,
    });
    return { others, projects: await townState(ctx, c.id) };
  },
);
