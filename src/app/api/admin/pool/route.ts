import { z } from "zod";
import { route } from "@/server/http";
import { parseUsd } from "@/lib/money";
import { AppError, setSetting } from "@/server/core";
import * as pool from "@/server/services/pool";

const id = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_share"), bps: z.number().int().min(1).max(10000) }),
  z.object({
    action: z.literal("report"),
    period: z.string(),
    source: z.enum(["simulated", "provider_statement"]),
    provider: z.string().min(2).max(40),
    externalRef: z.string().min(2).max(80),
    grossUsd: z.string().max(14),
    note: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal("received"), reportId: id }),
  z.object({ action: z.literal("reverse"), reportId: id, note: z.string().min(3).max(300) }),
  z.object({ action: z.literal("finalize"), cycleId: id }),
  z.object({ action: z.literal("transfer"), cycleId: id, txHash: z.string().max(100).optional() }),
  z.object({ action: z.literal("fund"), cycleId: id, txHash: z.string().max(100).optional() }),
  z.object({ action: z.literal("override"), cycleId: id, userId: id, eligible: z.boolean(), note: z.string().min(3).max(300) }),
  z.object({ action: z.literal("snapshot"), cycleId: id }),
  z.object({ action: z.literal("allocate"), cycleId: id }),
  z.object({ action: z.literal("prepare"), cycleId: id, force: z.boolean().default(false) }),
  z.object({ action: z.literal("propose"), cycleId: id }),
  z.object({ action: z.literal("approve"), proposalId: id }),
  z.object({ action: z.literal("sync"), cycleId: id }),
  z.object({ action: z.literal("repropose"), payoutId: id }),
  z.object({ action: z.literal("reconcile"), cycleId: id }),
]);

/** Community Heart Pool operations. Every step is audited; the cycle state machine refuses skips. */
export const POST = route({ auth: "admin", limit: 60, schema }, async ({ ctx, user, body }) => {
  const a = user!.id;
  switch (body.action) {
    case "set_share":
      await setSetting(ctx.db, "poolCharityBps", body.bps, a);
      return { ok: true };
    case "report": {
      let gross: bigint;
      try {
        gross = parseUsd(body.grossUsd);
      } catch {
        throw new AppError("invalid_amount", "Enter an amount like 125.50");
      }
      return pool.reportRevenue(ctx, a, { period: body.period, provider: body.provider, source: body.source, externalRef: body.externalRef, grossMicro: gross, note: body.note });
    }
    case "received":
      return pool.markRevenueReceived(ctx, a, body.reportId);
    case "reverse":
      return pool.reverseRevenue(ctx, a, body.reportId, body.note);
    case "finalize":
      return pool.finalizeRevenue(ctx, a, body.cycleId);
    case "transfer":
      return pool.transferBudget(ctx, a, body.cycleId, body.txHash);
    case "fund":
      return pool.confirmFunding(ctx, a, body.cycleId, body.txHash);
    case "override":
      return pool.overrideEligibility(ctx, a, body.cycleId, body.userId, body.eligible, body.note);
    case "snapshot":
      return pool.finalizeSnapshot(ctx, a, body.cycleId);
    case "allocate":
      return pool.calculateAllocations(ctx, a, body.cycleId);
    case "prepare":
      return pool.preparePayouts(ctx, a, body.cycleId, { force: body.force });
    case "propose":
      return pool.proposePayouts(ctx, a, body.cycleId);
    case "approve":
      return pool.approveProposal(ctx, { id: a, email: user!.email }, body.proposalId);
    case "sync":
      return pool.syncPayouts(ctx, body.cycleId);
    case "repropose":
      return pool.reproposePayout(ctx, a, body.payoutId);
    case "reconcile":
      return pool.reconcileCycle(ctx, a, body.cycleId);
  }
});
