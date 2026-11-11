import { route } from "@/server/http";
import { sandboxAttest } from "@/server/services/pool";

/** SANDBOX ONLY: stands in for a privacy-preserving proof-of-personhood provider. */
export const POST = route({ auth: "user", limit: 10 }, async ({ ctx, user }) => {
  const a = await sandboxAttest(ctx, user!.id, user!.email);
  return { ok: true, provider: a.provider };
});
