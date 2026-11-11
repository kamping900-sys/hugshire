import { z } from "zod";
import { route } from "@/server/http";
import { reportStory } from "@/server/services/stories";

export const POST = route({ auth: "user", limit: 10, schema: z.object({ reason: z.string().trim().min(3).max(300) }) }, async ({ ctx, user, body, params }) => {
  await reportStory(ctx, user!.id, params.id, body.reason);
  return { ok: true };
});
