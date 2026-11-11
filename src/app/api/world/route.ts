import { route } from "@/server/http";
import { worldTowns } from "@/server/services/towns";

/** Overworld: every approved organisation town with a construction summary. Public. */
export const GET = route({ auth: "none", limit: 120 }, async ({ ctx }) => ({ towns: await worldTowns(ctx), environment: ctx.environment }));
