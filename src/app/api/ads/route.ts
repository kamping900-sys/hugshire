import { z } from "zod";
import { route } from "@/server/http";
import { completeAd, requestAd } from "@/server/services/stories";

/** Optional ads. Never rewards the player with anything. */
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), placement: z.enum(["after_minigame", "town"]) }),
  z.object({ action: z.literal("complete"), viewId: z.string().uuid() }),
]);

export const POST = route({ auth: "user", limit: 20, schema }, async ({ ctx, user, body }) =>
  body.action === "request" ? { ad: await requestAd(ctx, user!.id, body.placement) } : completeAd(ctx, user!.id, body.viewId),
);
