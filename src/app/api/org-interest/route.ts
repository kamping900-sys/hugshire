import { z } from "zod";
import { route } from "@/server/http";
import { orgInquiries } from "@/server/db/schema";

const schema = z.object({
  orgName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  country: z.string().trim().max(80).optional().or(z.literal("")),
  cause: z.string().trim().min(10).max(1500),
});

/** Landing-page "For organisations" interest form. Stored for admins to follow up; nothing is sent externally. */
export const POST = route({ auth: "none", limit: 5, schema }, async ({ ctx, ip, body }) => {
  await ctx.db.insert(orgInquiries).values({
    orgName: body.orgName,
    contactName: body.contactName,
    email: body.email.toLowerCase(),
    website: body.website || null,
    country: body.country || null,
    cause: body.cause,
    ip,
  });
  return { ok: true };
});
