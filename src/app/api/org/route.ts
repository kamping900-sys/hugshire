import { route } from "@/server/http";
import { createOrganization, createOrgInput } from "@/server/services/orgs";

export const POST = route({ auth: "user", schema: createOrgInput, limit: 5 }, async ({ body, user, ctx }) => {
  const org = await createOrganization(ctx, user!.id, body);
  return { org: { id: org.id, slug: org.slug, status: org.status } };
});
