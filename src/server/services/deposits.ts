import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ANIMALS,
  bridgeTransactions,
  causes,
  deposits,
  DEPOSIT_STATUSES,
  helpers,
  onrampTransactions,
  organizations,
  supportPositions,
  userProfiles,
  users,
} from "../db/schema";
import { AppError, acct, audit, getSettings, notFound, paused, postJournal } from "../core";
import { assertTransition, inTx, type Ctx } from "./context";

export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const DEPOSIT_MACHINE: Record<DepositStatus, readonly DepositStatus[]> = {
  created: ["onramp_pending", "failed"],
  onramp_pending: ["onramp_completed", "failed", "manual_review"],
  onramp_completed: ["bridging", "failed", "manual_review"],
  bridging: ["bridged", "refunded", "failed", "manual_review"],
  bridged: ["vault_pending", "manual_review"],
  vault_pending: ["supplied", "failed", "manual_review"],
  supplied: [],
  failed: [],
  refunded: [],
  manual_review: ["onramp_completed", "bridging", "bridged", "vault_pending", "supplied", "failed", "refunded"],
};

export const createDepositInput = z.object({
  causeId: z.string().uuid(),
  amountUsd: z.string().min(1).max(20),
  animal: z.enum(ANIMALS),
  nickname: z.string().trim().min(1).max(24),
  idempotencyKey: z.string().min(8).max(80),
});

export async function createDeposit(
  ctx: Ctx,
  i: { userId: string; causeId: string; amountMicro: bigint; animal: (typeof ANIMALS)[number]; nickname: string; idempotencyKey: string; clientIp: string },
) {
  const settings = await getSettings(ctx.db);
  if (settings.pauseDeposits) throw paused("Adding money");
  if (i.amountMicro < BigInt(settings.minDepositMicro) || i.amountMicro > BigInt(settings.maxDepositMicro)) {
    throw new AppError("amount_out_of_range", "That amount is outside the allowed range for one deposit.");
  }
  const existing = await ctx.db
    .select()
    .from(deposits)
    .where(and(eq(deposits.userId, i.userId), eq(deposits.idempotencyKey, i.idempotencyKey)));
  if (existing.length) {
    const tx = await ctx.db.select().from(onrampTransactions).where(eq(onrampTransactions.depositId, existing[0].id));
    return { deposit: existing[0], checkoutUrl: (tx[0]?.raw as { url?: string } | null)?.url ?? null, replay: true };
  }

  const [cause] = await ctx.db
    .select({ c: causes, orgStatus: organizations.status })
    .from(causes)
    .innerJoin(organizations, eq(organizations.id, causes.orgId))
    .where(eq(causes.id, i.causeId));
  if (!cause) throw notFound("Cause not found");
  if (cause.c.status !== "approved" || cause.orgStatus !== "approved") throw new AppError("cause_unavailable", "This cause is not accepting support right now.");

  const [user] = await ctx.db.select().from(users).where(eq(users.id, i.userId));
  if (!user || user.status !== "active") throw new AppError("account_restricted", "Your account cannot add money right now.", 403);
  const [profile] = await ctx.db.select().from(userProfiles).where(eq(userProfiles.userId, i.userId));
  if (!profile?.riskAcknowledgedAt) throw new AppError("risk_not_acknowledged", "Please read and accept the risk notice first.");

  const wallets = await ctx.p.wallet.getUserWallets({ userId: i.userId, authSubject: user.authSubject });
  if (!wallets.baseAddress || !wallets.nearAccountId) throw new AppError("wallet_missing", "Your Hugshire wallet is not ready yet.");

  const [dep] = await ctx.db
    .insert(deposits)
    .values({
      userId: i.userId,
      causeId: i.causeId,
      environment: ctx.environment,
      requestedMicro: i.amountMicro,
      status: "created",
      idempotencyKey: i.idempotencyKey,
      animal: i.animal,
      helperNickname: i.nickname,
    })
    .returning();

  try {
    const session = await ctx.p.onramp.createBuySession({
      depositId: dep.id,
      userId: i.userId,
      amountMicro: i.amountMicro,
      walletAddress: wallets.baseAddress,
      clientIp: i.clientIp,
    });
    await ctx.db.insert(onrampTransactions).values({
      depositId: dep.id,
      direction: "buy",
      provider: ctx.p.onramp.name,
      partnerUserRef: session.partnerUserRef,
      status: "session_created",
      amountMicro: i.amountMicro,
      walletAddress: wallets.baseAddress,
      raw: { url: session.url, kind: session.kind },
    });
    await setDepositStatus(ctx, dep.id, "onramp_pending");
    await audit(ctx.db, { actorId: i.userId, actorType: "user", action: "deposit.created", targetType: "deposit", targetId: dep.id, data: { amountMicro: i.amountMicro } });
    return { deposit: { ...dep, status: "onramp_pending" as const }, checkoutUrl: session.url, replay: false };
  } catch (e) {
    await setDepositStatus(ctx, dep.id, "failed", `Checkout could not be created: ${(e as Error).message}`);
    throw new AppError("onramp_unavailable", "We could not open checkout. No money was taken. Please try again later.", 502);
  }
}

export async function setDepositStatus(ctx: Ctx, depositId: string, to: DepositStatus, reason?: string) {
  const [d] = await ctx.db.select().from(deposits).where(eq(deposits.id, depositId)).for("update");
  if (!d) throw notFound("Deposit not found");
  if (d.status === to) return d;
  assertTransition(DEPOSIT_MACHINE, d.status, to, "deposit");
  const [u] = await ctx.db
    .update(deposits)
    .set({ status: to, failureReason: reason ?? d.failureReason, updatedAt: ctx.now() })
    .where(eq(deposits.id, depositId))
    .returning();
  return u;
}

/**
 * The deposit's USDC is confirmed inside the Vault and supplied to RHEA.
 * Credits principal, creates the helper. Idempotent: a second call is a no-op.
 */
export async function settleDepositSupplied(
  ctx: Ctx,
  i: { depositId: string; principalMicro: bigint; feesMicro: bigint; vaultTxHash: string | null },
) {
  return inTx(ctx, async (tx) => {
    const [d] = await tx.db.select().from(deposits).where(eq(deposits.id, i.depositId)).for("update");
    if (!d) throw notFound("Deposit not found");
    if (d.status === "supplied") return { deposit: d, helperId: null, alreadySettled: true };
    if (i.principalMicro <= 0n) throw new Error("Settled principal must be positive");
    if (i.principalMicro + i.feesMicro > d.requestedMicro * 2n) throw new Error("Settled amount is implausible; refusing (manual review)");
    assertTransition(DEPOSIT_MACHINE, d.status, "supplied", "deposit");
    const at = tx.now();

    const posted = await postJournal(tx.db, {
      environment: d.environment,
      kind: "deposit_supplied",
      refType: "deposit",
      refId: d.id,
      memo: "USDC supplied to RHEA through the Vault",
      at,
      entries: [
        { account: acct.poolLending, amount: i.principalMicro },
        { account: acct.userPrincipal(d.userId), amount: -i.principalMicro },
      ],
    });
    if (!posted) return { deposit: d, helperId: null, alreadySettled: true };

    const [updated] = await tx.db
      .update(deposits)
      .set({ status: "supplied", principalMicro: i.principalMicro, feesMicro: i.feesMicro, vaultTxHash: i.vaultTxHash, suppliedAt: at, updatedAt: at })
      .where(eq(deposits.id, d.id))
      .returning();

    await tx.db
      .insert(supportPositions)
      .values({ userId: d.userId, environment: d.environment, principalMicro: i.principalMicro, totalDepositedMicro: i.principalMicro, updatedAt: at })
      .onConflictDoUpdate({
        target: supportPositions.userId,
        set: {
          principalMicro: sql`${supportPositions.principalMicro} + ${i.principalMicro.toString()}`,
          totalDepositedMicro: sql`${supportPositions.totalDepositedMicro} + ${i.principalMicro.toString()}`,
          updatedAt: at,
        },
      });

    const settings = await getSettings(tx.db);
    let helperId: string | null = null;
    const already =
      settings.helperRule === "one_per_cause"
        ? await tx.db.select({ id: helpers.id }).from(helpers).where(and(eq(helpers.userId, d.userId), eq(helpers.causeId, d.causeId)))
        : [];
    if (!already.length) {
      const [h] = await tx.db
        .insert(helpers)
        .values({
          userId: d.userId,
          causeId: d.causeId,
          depositId: d.id,
          animal: d.animal,
          nickname: d.helperNickname,
          environment: d.environment,
          lastPlayerActionAt: at,
        })
        .onConflictDoNothing()
        .returning({ id: helpers.id });
      helperId = h?.id ?? null;
    }
    await audit(tx.db, { actorType: "worker", action: "deposit.supplied", targetType: "deposit", targetId: d.id, data: { principalMicro: i.principalMicro, feesMicro: i.feesMicro } });
    return { deposit: updated, helperId, alreadySettled: false };
  });
}

/** Records a bridge leg for a deposit (sandbox or 1Click). */
export async function recordBridge(ctx: Ctx, depositId: string, amountInMicro: bigint, recipient: string, refundTo: string) {
  const q = await ctx.p.bridge.quote({ direction: "to_near", amountInMicro, recipient, refundTo, dry: false });
  const [b] = await ctx.db
    .insert(bridgeTransactions)
    .values({
      depositId,
      direction: "to_near",
      provider: ctx.p.bridge.name,
      depositAddress: q.depositAddress,
      quote: JSON.parse(JSON.stringify(q.raw)),
      amountInMicro,
      amountOutMicro: q.amountOutMicro,
      status: "PENDING_DEPOSIT",
    })
    .returning();
  return { bridge: b, quote: q };
}
