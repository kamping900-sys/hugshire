import { route } from "@/server/http";
import { recordPlayerAction } from "@/server/services/deliveries";
import { deliveryState } from "@/server/services/me";

/** Player heartbeat (the client throttles it to about one per 30 s). Returning players take back manual control. */
export const POST = route({ auth: "user", limit: 20 }, async ({ user, ctx, params }) => {
  await recordPlayerAction(ctx, user!.id, params.id);
  return deliveryState(ctx, user!.id);
});
