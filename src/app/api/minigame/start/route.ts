import { z } from "zod";
import { route } from "@/server/http";
import { startSession } from "@/server/services/game";

/** Work button. The SERVER picks Wood or Stone; the client cannot choose. */
export const POST = route({ auth: "user", limit: 20, schema: z.object({ projectId: z.string().uuid() }) }, async ({ ctx, user, body }) => startSession(ctx, user!.id, body.projectId));
