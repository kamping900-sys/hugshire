import { z } from "zod";
import { route } from "@/server/http";
import { ANIMALS } from "@/server/db/schema";
import { journey, onboard, renameHelper, setActiveHelper, setAutoDaily, setHome } from "@/server/services/journey";

/** Where the player is in the journey, plus their Heart Bank summary. Guests get { signedIn: false }. */
export const GET = route({ auth: "none", limit: 240 }, async ({ ctx, user }) => (user ? { signedIn: true, ...(await journey(ctx, user.id)) } : { signedIn: false }));

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("onboard"), animal: z.enum(ANIMALS), nickname: z.string().trim().min(1).max(24), homeCauseId: z.string().uuid(), createHelper: z.boolean().optional() }),
  z.object({ action: z.literal("home"), homeCauseId: z.string().uuid() }),
  z.object({ action: z.literal("activeHelper"), helperId: z.string().uuid() }),
  z.object({ action: z.literal("autoDaily"), on: z.boolean() }),
  z.object({ action: z.literal("renameHelper"), helperId: z.string().uuid(), animal: z.enum(ANIMALS), nickname: z.string().trim().min(1).max(24) }),
]);

export const POST = route({ auth: "user", limit: 30, schema }, async ({ ctx, user, body }) =>
  body.action === "onboard"
    ? onboard(ctx, user!.id, body)
    : body.action === "home"
      ? setHome(ctx, user!.id, body.homeCauseId)
      : body.action === "activeHelper"
        ? setActiveHelper(ctx, user!.id, body.helperId)
        : body.action === "autoDaily"
          ? setAutoDaily(ctx, user!.id, body.on)
          : renameHelper(ctx, user!.id, body.helperId, body),
);
