import { route } from "@/server/http";
import { townSnapshot } from "@/server/services/towns";

/** Detailed town: shared construction state, Notice Board and (if signed in) the viewer's own state. */
export const GET = route({ auth: "none", limit: 240 }, async ({ ctx, user, params }) => townSnapshot(ctx, params.slug, user?.id ?? null));
