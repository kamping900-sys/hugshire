import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/server/http";
import { ANIMALS, userProfiles } from "@/server/db/schema";
import { audit } from "@/server/core";
import { deliveryState } from "@/server/services/me";

/** The supporter's live delivery state (eligible yield, helpers, control mode, rules). */
export const GET = route({ auth: "user", limit: 120 }, async ({ user, ctx }) => deliveryState(ctx, user!.id));

export const PUT = route(
  {
    auth: "user",
    schema: z.object({
      displayName: z.string().trim().min(1).max(24).optional(),
      favoriteAnimal: z.enum(ANIMALS).optional(),
      acknowledgeRisk: z.literal(true).optional(),
    }),
  },
  async ({ body, user, ctx }) => {
    const patch: Partial<typeof userProfiles.$inferInsert> = {};
    if (body.displayName) patch.displayName = body.displayName;
    if (body.favoriteAnimal) patch.favoriteAnimal = body.favoriteAnimal;
    if (body.acknowledgeRisk) patch.riskAcknowledgedAt = ctx.now();
    if (Object.keys(patch).length) await ctx.db.update(userProfiles).set(patch).where(eq(userProfiles.userId, user!.id));
    if (body.acknowledgeRisk) await audit(ctx.db, { actorId: user!.id, actorType: "user", action: "risk.acknowledged" });
    return { ok: true };
  },
);
