import { and, eq } from "drizzle-orm";
import { bridgeTransactions, deposits, onrampTransactions, users, withdrawals } from "../db/schema";
import { AppError, audit, forbidden, notFound, raiseAlert } from "../core";
import { env } from "../env";
import { NearRpc } from "../providers/near";
import type { Ctx } from "./context";
import { setDepositStatus, settleDepositSupplied } from "./deposits";
import { advanceWithdrawal, settleProtocolWithdrawal } from "./withdrawals";

/*
 * LIVE steps that need the supporter's own signature (their Privy wallets). The server never holds
 * user keys: it prepares the exact transaction, the client signs it, and the server verifies the
 * result on chain before booking anything. Not exercised end-to-end until Privy is wired in
 * (SETUP_GUIDE.md §3) — see KNOWN_LIMITATIONS.md.
 */

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

async function wallets(ctx: Ctx, userId: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
  const w = await ctx.p.wallet.getUserWallets({ userId, authSubject: u?.authSubject ?? null });
  if (!w.baseAddress || !w.nearAccountId) throw new AppError("wallet_missing", "Your Hugshire wallet is not ready yet.");
  return w;
}

async function ownDeposit(ctx: Ctx, userId: string, depositId: string) {
  const [d] = await ctx.db.select().from(deposits).where(eq(deposits.id, depositId));
  if (!d) throw notFound("Deposit not found");
  if (d.userId !== userId) throw forbidden();
  if (d.environment !== "live") throw new AppError("not_live", "This step only exists in live mode.");
  return d;
}

/** Step A (after Coinbase delivered USDC on Base): get a 1Click deposit address for the user to send to. */
export async function prepareDepositBridge(ctx: Ctx, userId: string, depositId: string) {
  const d = await ownDeposit(ctx, userId, depositId);
  if (d.status !== "onramp_completed") throw new AppError("bad_state", "This deposit is not waiting for the bridge step.");
  const [existing] = await ctx.db.select().from(bridgeTransactions).where(and(eq(bridgeTransactions.depositId, d.id), eq(bridgeTransactions.direction, "to_near")));
  const w = await wallets(ctx, userId);
  const [on] = await ctx.db.select().from(onrampTransactions).where(eq(onrampTransactions.depositId, d.id));
  const amountIn = on?.amountMicro ?? null;
  if (!amountIn || amountIn <= 0n) throw new AppError("amount_unknown", "Waiting for Coinbase to confirm how much USDC arrived.");
  if (existing?.depositAddress) {
    return { depositAddress: existing.depositAddress, amountMicro: existing.amountInMicro, token: BASE_USDC, chainId: 8453 };
  }
  const q = await ctx.p.bridge.quote({ direction: "to_near", amountInMicro: amountIn, recipient: w.nearAccountId!, refundTo: w.baseAddress!, dry: false });
  if (!q.depositAddress) throw new AppError("bridge_unavailable", "The bridge did not return a deposit address. Try again shortly.", 502);
  await ctx.db.insert(bridgeTransactions).values({
    depositId: d.id,
    direction: "to_near",
    provider: ctx.p.bridge.name,
    depositAddress: q.depositAddress,
    quote: JSON.parse(JSON.stringify(q.raw)),
    amountInMicro: amountIn,
    amountOutMicro: q.amountOutMicro,
    status: "PENDING_DEPOSIT",
  });
  return { depositAddress: q.depositAddress, amountMicro: amountIn, token: BASE_USDC, chainId: 8453, minAmountOutMicro: q.minAmountOutMicro, timeEstimateSeconds: q.timeEstimateSeconds };
}

/** Step B: the user signed the Base USDC transfer to the 1Click deposit address. */
export async function submitDepositBridgeTx(ctx: Ctx, userId: string, depositId: string, txHash: string) {
  const d = await ownDeposit(ctx, userId, depositId);
  const [b] = await ctx.db.select().from(bridgeTransactions).where(and(eq(bridgeTransactions.depositId, d.id), eq(bridgeTransactions.direction, "to_near")));
  if (!b?.depositAddress) throw new AppError("bad_state", "Prepare the bridge step first.");
  const e = env();
  // Optional speed-up per 1Click docs; status polling is the source of truth either way.
  await fetch(`${e.ONECLICK_BASE_URL}/v0/deposit/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(e.ONECLICK_API_KEY ? { "X-API-Key": e.ONECLICK_API_KEY } : {}) },
    body: JSON.stringify({ txHash, depositAddress: b.depositAddress }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
  await ctx.db.update(bridgeTransactions).set({ txHashes: [txHash], status: "KNOWN_DEPOSIT_TX", updatedAt: ctx.now() }).where(eq(bridgeTransactions.id, b.id));
  await setDepositStatus(ctx, d.id, "bridging");
  await audit(ctx.db, { actorId: userId, actorType: "user", action: "deposit.bridge_tx", targetType: "deposit", targetId: d.id, data: { txHash } });
}

/** Step C: the user signed usdc.ft_transfer_call(vault, amount, "") from their NEAR account. */
export async function submitVaultDepositTx(ctx: Ctx, userId: string, depositId: string, txHash: string) {
  const d = await ownDeposit(ctx, userId, depositId);
  if (d.status !== "bridged") throw new AppError("bad_state", "This deposit is not waiting for the Vault step.");
  await ctx.db.update(deposits).set({ vaultTxHash: txHash, updatedAt: ctx.now() }).where(eq(deposits.id, d.id));
  await setDepositStatus(ctx, d.id, "vault_pending");
}

/**
 * Worker: verifies pending Vault deposits on chain. Principal is credited only from the Vault's own
 * `deposit` event for the user's NEAR account, never from client claims.
 */
export async function verifyVaultDeposits(ctx: Ctx) {
  if (ctx.environment !== "live") return { verified: 0 };
  const e = env();
  const rpc = new NearRpc(e.NEAR_RPC_URL);
  const list = await ctx.db.select().from(deposits).where(and(eq(deposits.environment, "live"), eq(deposits.status, "vault_pending")));
  let verified = 0;
  for (const d of list) {
    if (!d.vaultTxHash) continue;
    const w = await wallets(ctx, d.userId);
    const r = await rpc.txEvents(d.vaultTxHash, w.nearAccountId!, e.NEAR_VAULT_CONTRACT!);
    if (r.state === "pending") continue;
    const ev = r.events.find((x) => x.event === "deposit_queued" && x.data.owner === w.nearAccountId);
    if (r.state === "failure" || r.signerId !== w.nearAccountId || !ev) {
      await setDepositStatus(ctx, d.id, "manual_review", "Vault deposit could not be verified on chain");
      await raiseAlert(ctx.db, { severity: "warning", code: "vault_deposit_unverified", message: `Deposit ${d.id} tx ${d.vaultTxHash} not verified`, dedupeKey: `vault_dep:${d.id}` });
      continue;
    }
    const amount = BigInt(ev.data.amount);
    const fees = d.requestedMicro > amount ? d.requestedMicro - amount : 0n;
    await settleDepositSupplied(ctx, { depositId: d.id, principalMicro: amount, feesMicro: fees, vaultTxHash: d.vaultTxHash });
    verified++;
  }
  return { verified };
}

/** Withdrawal step: the user signed vault.withdraw(amount). */
export async function submitVaultWithdrawTx(ctx: Ctx, userId: string, withdrawalId: string, txHash: string) {
  const [w] = await ctx.db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
  if (!w) throw notFound();
  if (w.userId !== userId) throw forbidden();
  if (w.environment !== "live") throw new AppError("not_live", "This step only exists in live mode.");
  await advanceWithdrawal(ctx, w.id, "pending_protocol_withdrawal", "Vault withdrawal submitted", { vaultTxHash: txHash });
}

/** Worker: verifies Vault withdrawals from the Vault's `withdraw` event (amount actually paid). */
export async function verifyVaultWithdrawals(ctx: Ctx) {
  if (ctx.environment !== "live") return { verified: 0 };
  const e = env();
  const rpc = new NearRpc(e.NEAR_RPC_URL);
  const list = await ctx.db.select().from(withdrawals).where(and(eq(withdrawals.environment, "live"), eq(withdrawals.status, "pending_protocol_withdrawal")));
  let verified = 0;
  for (const w of list) {
    if (!w.vaultTxHash) continue;
    const wal = await wallets(ctx, w.userId);
    const r = await rpc.txEvents(w.vaultTxHash, wal.nearAccountId!, e.NEAR_VAULT_CONTRACT!);
    if (r.state === "pending") continue;
    const ev = r.events.find((x) => x.event === "withdraw" && x.data.owner === wal.nearAccountId);
    // v2: amount = USDC paid; principal = basis released (larger than amount after a pool loss)
    if (r.state === "failure" || !ev || BigInt(ev.data.amount) > w.requestedMicro) {
      await advanceWithdrawal(ctx, w.id, "manual_review", "Vault withdrawal could not be matched on chain");
      await raiseAlert(ctx.db, { severity: "warning", code: "vault_withdraw_unverified", message: `Withdrawal ${w.id} not verified`, dedupeKey: `vault_wd:${w.id}` });
      continue;
    }
    await settleProtocolWithdrawal(ctx, w.id, BigInt(ev.data.amount), w.vaultTxHash);
    verified++;
  }
  return { verified };
}
