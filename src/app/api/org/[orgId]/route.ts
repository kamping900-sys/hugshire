import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/server/http";
import { organizations } from "@/server/db/schema";
import { requireOrgMember, setPayoutAccount } from "@/server/services/orgs";

const schema = z.object({
  description: z.string().trim().max(2000).optional(),
  website: z.string().trim().url().max(200).optional().or(z.literal("")),
  contactEmail: z.string().trim().email().max(200).optional(),
  payoutNearAccount: z.string().trim().max(64).optional(),
});

/** Organisation settings. Changing the receiving account always triggers fresh admin verification. */
export const PUT = route({ auth: "user", schema, limit: 20 }, async ({ body, user, ctx, params }) => {
  await requireOrgMember(ctx, user!.id, params.orgId, "owner");
  const patch: Partial<typeof organizations.$inferInsert> = {};
  if (body.description !== undefined) patch.description = body.description;
  if (body.website !== undefined) patch.website = body.website || null;
  if (body.contactEmail) patch.contactEmail = body.contactEmail;
  if (Object.keys(patch).length) await ctx.db.update(organizations).set(patch).where(eq(organizations.id, params.orgId));
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, params.orgId));
  if (body.payoutNearAccount && body.payoutNearAccount.toLowerCase() !== org.payoutNearAccount) {
    await setPayoutAccount(ctx, user!.id, params.orgId, body.payoutNearAccount);
  }
  return { ok: true };
});
