import { and, eq, inArray, lt } from "drizzle-orm";
import { bridgeTransactions, deposits, onrampTransactions, withdrawals } from "../db/schema";
import { audit, raiseAlert } from "../core";
import type { Ctx } from "./context";
import { recordBridge, setDepositStatus, settleDepositSupplied } from "./deposits";
import { advanceWithdrawal, settleProtocolWithdrawal } from "./withdrawals";

/**
 * Moves deposits and withdrawals forward by *observing* provider state.
 * Sandbox: labelled test providers advance immediately (no money exists).
 * Live: each step waits for a verifiable external fact (Coinbase webhook, 1Click status,
 * NEAR transaction outcome). Steps that need the user's own signature wait for the client
 * to submit a tx hash, which is then verified on chain before anything is booked.
 */
export async function processDeposits(ctx: Ctx) {
  const list = await ctx.db
    .select()
    .from(deposits)
    .where(and(eq(deposits.environment, ctx.environment), inArray(deposits.status, ["onramp_completed", "bridging", "bridged", "vault_pending"])));
  let advanced = 0;
  for (const d of list) {
    try {
      if (ctx.environment === "sandbox") {
        if (d.status === "onramp_completed") {
          await recordBridge(ctx, d.id, d.requestedMicro, "sandbox-vault", "sandbox-refund");
          await setDepositStatus(ctx, d.id, "bridging");
        } else if (d.status === "bridging") {
          await ctx.db.update(bridgeTransactions).set({ status: "SUCCESS", updatedAt: ctx.now() }).where(eq(bridgeTransactions.depositId, d.id));
          await setDepositStatus(ctx, d.id, "bridged");
        } else if (d.status === "bridged") {
          await setDepositStatus(ctx, d.id, "vault_pending");
        } else if (d.status === "vault_pending") {
          await settleDepositSupplied(ctx, { depositId: d.id, principalMicro: d.requestedMicro, feesMicro: 0n, vaultTxHash: `sandbox-${d.id}` });
        }
        advanced++;
        continue;
      }
      // live
      if (d.status === "bridging") {
        const [b] = await ctx.db.select().from(bridgeTransactions).where(eq(bridgeTransactions.depositId, d.id));
        if (!b?.depositAddress) continue;
        const s = await ctx.p.bridge.status(b.depositAddress);
        await ctx.db
          .update(bridgeTransactions)
          .set({ status: s.status, amountOutMicro: s.amountOutMicro ?? b.amountOutMicro, txHashes: s.txHashes, updatedAt: ctx.now() })
          .where(eq(bridgeTransactions.id, b.id));
        if (s.status === "SUCCESS") await setDepositStatus(ctx, d.id, "bridged");
        else if (s.status === "REFUNDED") await setDepositStatus(ctx, d.id, "refunded", "1Click refunded the transfer to your Base wallet");
        else if (s.status === "FAILED" || s.status === "INCOMPLETE_DEPOSIT") await setDepositStatus(ctx, d.id, "manual_review", `1Click status ${s.status}`);
        advanced++;
      }
      // live "onramp_completed", "bridged" and "vault_pending" are advanced by user-signed tx submissions
      // (see /api/deposits/[id]/tx) and by verifyVaultDeposit below.
    } catch (e) {
      await raiseAlert(ctx.db, {
        severity: "warning",
        code: "deposit_processing_error",
        message: `Deposit ${d.id} (${d.status}): ${(e as Error).message}`,
        dedupeKey: `deposit_err:${d.id}`,
      });
    }
  }
  return { advanced };
}

export async function processWithdrawals(ctx: Ctx) {
  const list = await ctx.db
    .select()
    .from(withdrawals)
    .where(and(eq(withdrawals.environment, ctx.environment), inArray(withdrawals.status, ["requested", "pending_protocol_withdrawal", "bridging", "available_for_offramp"])));
  let advanced = 0;
  for (const w of list) {
    if (ctx.environment !== "sandbox") continue; // live steps are user-signed + verified, see api/withdrawals
    if (w.status === "requested") await advanceWithdrawal(ctx, w.id, "pending_protocol_withdrawal", "Test mode: Vault withdrawal simulated");
    else if (w.status === "pending_protocol_withdrawal") await settleProtocolWithdrawal(ctx, w.id, w.requestedMicro, `sandbox-${w.id}`);
    else if (w.status === "bridging") await advanceWithdrawal(ctx, w.id, "available_for_offramp", "Test mode: bridge simulated, no fee");
    else if (w.status === "available_for_offramp")
      await advanceWithdrawal(ctx, w.id, "completed", "Test mode: no bank transfer happens", { receivedMicro: w.redeemedMicro ?? w.requestedMicro });
    advanced++;
  }
  return { advanced };
}

/** Sandbox checkout: the user clicked "Complete test payment". Live never calls this. */
export async function completeSandboxCheckout(ctx: Ctx, depositId: string, userId: string) {
  if (ctx.environment !== "sandbox") throw new Error("Sandbox checkout is disabled in live mode");
  const [d] = await ctx.db.select().from(deposits).where(eq(deposits.id, depositId));
  if (!d || d.userId !== userId) throw new Error("Deposit not found");
  if (d.status !== "onramp_pending") return d;
  await ctx.db.update(onrampTransactions).set({ status: "sandbox_completed", updatedAt: ctx.now() }).where(eq(onrampTransactions.depositId, d.id));
  const u = await setDepositStatus(ctx, depositId, "onramp_completed");
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "deposit.sandbox_checkout", targetType: "deposit", targetId: depositId });
  return u;
}

/** Abandoned checkouts: onramp sessions expire after 5 minutes; give users a day before closing them. */
export async function expireStaleCheckouts(ctx: Ctx) {
  const cutoff = new Date(ctx.now().getTime() - 24 * 3600 * 1000);
  const stale = await ctx.db
    .select({ id: deposits.id })
    .from(deposits)
    .where(and(eq(deposits.environment, ctx.environment), eq(deposits.status, "onramp_pending"), lt(deposits.createdAt, cutoff)));
  for (const s of stale) await setDepositStatus(ctx, s.id, "failed", "Checkout was not completed. No money was taken.");
  return { expired: stale.length };
}
