import { z } from "zod";
import { route } from "@/server/http";
import { startProject } from "@/server/services/game";

/** Start a building on an approved plot (one unfinished project per supporter). */
export const POST = route(
  { auth: "user", limit: 20, schema: z.object({ causeId: z.string().uuid(), plotKey: z.string().max(8), blueprintKey: z.string().max(32) }) },
  async ({ ctx, user, body }) => ({ project: await startProject(ctx, user!.id, body) }),
);
