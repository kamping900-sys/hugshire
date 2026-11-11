import { z } from "zod";
import { route } from "@/server/http";
import { moderateStory } from "@/server/services/stories";

/** Hide or restore a Notice Board post. The reason is kept in the audit log. */
export const POST = route(
  { auth: "admin", limit: 30, schema: z.object({ updateId: z.string().uuid(), visibility: z.enum(["published", "hidden"]), reason: z.string().trim().min(3).max(300) }) },
  async ({ ctx, user, body }) => {
    await moderateStory(ctx, user!.id, body.updateId, body.visibility, body.reason);
    return { ok: true };
  },
);
