import { z } from "zod";
import { route } from "@/server/http";
import { quitSession, submitRound } from "@/server/services/game";

/**
 * Raw input timings only (ms from round start). The server judges them against the secret chart,
 * applies hearts/combo/caps and commits results. Scores or rewards from a client are never accepted.
 */
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("round"),
    round: z.number().int().min(0).max(500),
    swings: z.array(z.number()).max(64).optional(),
    strikes: z.array(z.object({ t: z.number(), b: z.number().int().min(0).max(3) })).max(48).optional(),
  }),
  z.object({ action: z.literal("quit") }),
]);

export const POST = route({ auth: "user", limit: 90, schema }, async ({ ctx, user, body, params }) => {
  if (body.action === "quit") return quitSession(ctx, user!.id, params.id);
  return submitRound(ctx, user!.id, params.id, { round: body.round, swings: body.swings, strikes: body.strikes });
});
