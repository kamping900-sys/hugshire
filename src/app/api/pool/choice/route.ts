import { z } from "zod";
import { route } from "@/server/http";
import { chooseCauses } from "@/server/services/pool";

/** Direct my golden fruit (equal community allocation) to up to three approved causes. */
export const POST = route(
  {
    auth: "user",
    limit: 30,
    schema: z.object({ allocationId: z.string().uuid(), choices: z.array(z.object({ causeId: z.string().uuid(), bps: z.number().int().min(1).max(10000) })).min(1).max(3) }),
  },
  async ({ ctx, user, body }) => {
    await chooseCauses(ctx, user!.id, body.allocationId, body.choices);
    return { ok: true };
  },
);
