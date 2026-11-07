import { route } from "@/server/http";
import { AppError } from "@/server/core";
import { completeSandboxCheckout } from "@/server/services/processor";

/** Test mode only: stands in for the Coinbase checkout. Refused in live mode. */
export const POST = route({ auth: "user", limit: 20 }, async ({ user, ctx, params }) => {
  if (ctx.environment !== "sandbox") throw new AppError("not_available", "Not available in live mode.", 404);
  const d = await completeSandboxCheckout(ctx, params.id, user!.id);
  return { status: d.status };
});
