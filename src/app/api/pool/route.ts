import { and, eq } from "drizzle-orm";
import { route } from "@/server/http";
import { identityAttestations, poolEligibility, poolCycles } from "@/server/db/schema";
import { evaluateEligibility, poolOverview, pseudonym } from "@/server/services/pool";

/** Public pool overview; signed-in supporters also see their own eligibility and pseudonym. */
export const GET = route({ auth: "none", limit: 120 }, async ({ ctx, user }) => {
  const o = await poolOverview(ctx);
  if (!user) return o;
  const [att] = await ctx.db.select().from(identityAttestations).where(eq(identityAttestations.userId, user.id));
  const now = await evaluateEligibility(ctx, user.id, ctx.now());
  const mine = await ctx.db
    .select({ e: poolEligibility, period: poolCycles.period })
    .from(poolEligibility)
    .innerJoin(poolCycles, eq(poolCycles.id, poolEligibility.cycleId))
    .where(and(eq(poolEligibility.userId, user.id), eq(poolCycles.environment, ctx.environment)));
  return {
    ...o,
    me: {
      attested: Boolean(att && att.status === "verified"),
      eligibleNow: now.eligible,
      reasonsNow: now.reasons,
      cycles: mine.map((m) => ({ period: m.period, eligible: m.e.eligible, reasons: m.e.reasons, pseudonym: pseudonym(m.e.cycleId, user.id) })),
    },
  };
});
