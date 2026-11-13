import { z } from "zod";
import { route } from "@/server/http";
import { quitSession, submitRound } from "@/server/services/game";

/**
 * Raw stop times only (ms since each attempt started; null = no chop). The server recomputes the
 * timing bar from its secret seed, judges every stop, applies hearts/combo/caps and commits results.
 * Scores or rewards sent by a client are never accepted.
 */
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("round"), round: z.number().int().min(0).max(1000), stops: z.array(z.number().min(0).max(60_000).nullable()).max(10) }),
  z.object({ action: z.literal("quit") }),
]);

export const POST = route({ auth: "user", limit: 120, schema }, async ({ ctx, user, body, params }) => {
  if (body.action === "quit") return quitSession(ctx, user!.id, params.id);
  return submitRound(ctx, user!.id, params.id, { round: body.round, stops: body.stops });
});
