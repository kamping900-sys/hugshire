import { route } from "@/server/http";
import { publicSnapshot } from "@/server/services/pool";

/** Public audit trail: pseudonymous snapshot, its hash, the equal-split numbers and every payout. */
export const GET = route({ auth: "none", limit: 120 }, async ({ ctx, params }) => publicSnapshot(ctx, params.id));
