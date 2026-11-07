import { route } from "@/server/http";
import { causeInput, createCause } from "@/server/services/orgs";

export const POST = route({ auth: "user", schema: causeInput, limit: 10 }, async ({ body, user, ctx, params }) => {
  const c = await createCause(ctx, user!.id, params.orgId, body);
  return { cause: { id: c.id, slug: c.slug } };
});
