import { z } from "zod";
import { route } from "@/server/http";
import { createDelivery, listDeliveries } from "@/server/services/deliveries";

/**
 * Manual delivery. The body has no amount on purpose: the server delivers whatever yield the
 * supporter has actually earned and that is eligible now. Gameplay only picks when and where.
 */
export const POST = route(
  {
    auth: "user",
    limit: 30,
    schema: z.object({ causeId: z.string().uuid(), helperId: z.string().uuid().optional(), idempotencyKey: z.string().min(8).max(80) }),
  },
  async ({ body, user, ctx }) => {
    const r = await createDelivery(ctx, { userId: user!.id, causeId: body.causeId, helperId: body.helperId, mode: "manual", idempotencyKey: body.idempotencyKey });
    return { delivery: r.delivery, replay: r.replay };
  },
);

export const GET = route({ auth: "user" }, async ({ user, ctx }) => listDeliveries(ctx, user!.id));
