import { z } from "zod";
import { route } from "@/server/http";
import { AppError } from "@/server/core";
import { prepareDepositBridge, submitDepositBridgeTx, submitVaultDepositTx, submitVaultWithdrawTx } from "@/server/services/live-steps";

const txHash = z.string().trim().min(10).max(100).regex(/^[A-Za-z0-9x]+$/);
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deposit.prepare_bridge"), id: z.string().uuid() }),
  z.object({ kind: z.literal("deposit.bridge_tx"), id: z.string().uuid(), txHash }),
  z.object({ kind: z.literal("deposit.vault_tx"), id: z.string().uuid(), txHash }),
  z.object({ kind: z.literal("withdrawal.vault_tx"), id: z.string().uuid(), txHash }),
]);

/**
 * Live-mode, user-signed steps. The client (Privy wallet) signs; the server records the hash and the
 * worker verifies the outcome on chain before anything is credited. Refused in sandbox.
 */
export const POST = route({ auth: "user", schema, limit: 30 }, async ({ body, user, ctx }) => {
  if (ctx.environment !== "live") throw new AppError("not_live", "Only available in live mode.", 404);
  switch (body.kind) {
    case "deposit.prepare_bridge":
      return prepareDepositBridge(ctx, user!.id, body.id);
    case "deposit.bridge_tx":
      await submitDepositBridgeTx(ctx, user!.id, body.id, body.txHash);
      return { ok: true };
    case "deposit.vault_tx":
      await submitVaultDepositTx(ctx, user!.id, body.id, body.txHash);
      return { ok: true };
    case "withdrawal.vault_tx":
      await submitVaultWithdrawTx(ctx, user!.id, body.id, body.txHash);
      return { ok: true };
  }
});
