/**
 * Demo onchain mode (CHAIN_MODE=testnet): mirrors the player's money actions as real NEAR testnet
 * transactions, in its own loop so slow chain calls never hold up the game's jobs.
 *   supplied deposit  → test USDC to the player's wallet → Hugshire Vault → mock RHEA
 *   delivery (fruit)  → vault.donate from the player's wallet → the cause's wallet receives USDC
 *   withdrawal        → vault.withdraw → USDC back to the player's wallet
 * Every transaction hash is recorded in chain_txs. Actions older than CHAIN_SINCE are not replayed.
 */
import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { causes, chainTxs, deliveries, deposits, poolCycles, poolPayouts, withdrawals } from "../db/schema";
import { testnetChain, playerWallet } from "../chain/testnet";
import type { Ctx } from "./context";

function since(): Date {
  const s = process.env.CHAIN_SINCE;
  return s ? new Date(s) : new Date("2100-01-01");
}

const notMirrored = (refType: string, refCol: unknown) => sql`not exists (select 1 from chain_txs c where c.ref_type = ${refType} and c.ref_id = ${refCol})`;

/** Demo accounts whose older deposits are mirrored too (CHAIN_BACKFILL_EMAILS, comma-separated). */
const backfillUser = (userCol: unknown) => {
  const emails = (process.env.CHAIN_BACKFILL_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return sql`false`;
  return sql`${userCol} in (select id from users where lower(email) in (${sql.join(emails.map((e) => sql`${e}`), sql`, `)}))`;
};

async function record(ctx: Ctx, rows: (typeof chainTxs.$inferInsert)[]) {
  if (rows.length) await ctx.db.insert(chainTxs).values(rows).onConflictDoNothing();
}

const busy = (e: unknown) => /One vault operation per minute|locked|Vault is busy/i.test(String(e));

/** One pass: at most a few chain actions, oldest first. */
export async function runChainSync(ctx: Ctx, log: (m: string) => void = () => {}) {
  const chain = testnetChain();
  if (!chain || ctx.environment !== "sandbox") return { skipped: "chain mode off" };
  const from = since();
  let done = 0;

  // 1) deposits into the Vault
  const deps = await ctx.db
    .select({ id: deposits.id, userId: deposits.userId, principal: deposits.principalMicro, requested: deposits.requestedMicro })
    .from(deposits)
    .where(and(eq(deposits.environment, "sandbox"), eq(deposits.status, "supplied"), or(gte(deposits.suppliedAt, from), backfillUser(deposits.userId)), notMirrored("deposit", deposits.id)))
    .orderBy(asc(deposits.suppliedAt))
    .limit(2);
  for (const d of deps) {
    const amount = d.principal ?? d.requested;
    const r = await chain.deposit(d.userId, amount);
    const base = { userId: d.userId, kind: "deposit" as const, refType: "deposit" as const, refId: d.id, account: r.wallet, amountMicro: amount };
    await record(ctx, [
      { ...base, step: "mint", txHash: r.mint, note: "Test USDC arrives in the player's wallet (stands in for the bridged USDC)" },
      { ...base, step: "to_vault", txHash: r.toVault, note: "Player's wallet → Hugshire Vault" },
      { ...base, step: "process", txHash: r.processed, note: "Vault mints shares and supplies RHEA (mock)" },
    ]);
    await ctx.db.update(deposits).set({ vaultTxHash: r.toVault }).where(eq(deposits.id, d.id));
    log(`[chain] deposit ${d.id} → ${r.toVault}`);
    done++;
  }

  // 2) delivered fruit → donation to the cause's wallet
  const dels = await ctx.db
    .select({ id: deliveries.id, userId: deliveries.userId, amount: deliveries.amountMicro, slug: causes.slug })
    .from(deliveries)
    .innerJoin(causes, eq(causes.id, deliveries.causeId))
    .where(and(inArray(deliveries.status, ["pending", "queued", "paid"]), gte(deliveries.createdAt, from), notMirrored("delivery", deliveries.id)))
    .orderBy(asc(deliveries.createdAt))
    .limit(2);
  for (const d of dels) {
    const w = playerWallet(chain.cfg, d.userId);
    const m = await chain.member(w.accountId).catch(() => null);
    if (!m || BigInt(m.principal) === 0n) {
      await record(ctx, [{ userId: d.userId, kind: "donate", refType: "delivery", refId: d.id, step: "skipped", txHash: "-", note: "No onchain deposit for this player yet" }]);
      continue;
    }
    try {
      const r = await chain.donate(d.userId, d.slug, d.amount);
      await record(ctx, [{ userId: d.userId, kind: "donate", refType: "delivery", refId: d.id, step: "donate", txHash: r.hash, account: r.cause, amountMicro: d.amount, note: d.slug }]);
      log(`[chain] donation ${d.id} → ${r.cause} ${r.hash}`);
      done++;
    } catch (e) {
      if (busy(e)) continue; // the Vault allows one operation per supporter per minute; next pass
      throw e;
    }
  }

  // 3) withdrawals back to the player's wallet
  const wds = await ctx.db
    .select({ id: withdrawals.id, userId: withdrawals.userId, amount: withdrawals.requestedMicro })
    .from(withdrawals)
    .where(and(eq(withdrawals.environment, "sandbox"), gte(withdrawals.createdAt, from), notMirrored("withdrawal", withdrawals.id)))
    .orderBy(asc(withdrawals.createdAt))
    .limit(2);
  for (const wd of wds) {
    const w = playerWallet(chain.cfg, wd.userId);
    const m = await chain.member(w.accountId).catch(() => null);
    const can = BigInt(m?.withdrawable ?? "0");
    if (can === 0n) {
      await record(ctx, [{ userId: wd.userId, kind: "withdraw", refType: "withdrawal", refId: wd.id, step: "skipped", txHash: "-", note: "No onchain deposit for this player yet" }]);
      continue;
    }
    const amount = wd.amount < can ? wd.amount : can;
    try {
      const r = await chain.withdraw(wd.userId, amount);
      await record(ctx, [{ userId: wd.userId, kind: "withdraw", refType: "withdrawal", refId: wd.id, step: "withdraw", txHash: r.hash, account: r.wallet, amountMicro: amount, note: "Vault → RHEA (mock) → player's wallet" }]);
      await ctx.db.update(withdrawals).set({ vaultTxHash: r.hash }).where(eq(withdrawals.id, wd.id));
      log(`[chain] withdrawal ${wd.id} → ${r.hash}`);
      done++;
    } catch (e) {
      if (busy(e)) continue;
      throw e;
    }
  }

  // 4) Community Heart Pool payouts: treasury wallet → the cause's wallet
  const pps = await ctx.db
    .select({ id: poolPayouts.id, amount: poolPayouts.amountMicro, slug: causes.slug, executedAt: poolPayouts.executedAt })
    .from(poolPayouts)
    .innerJoin(causes, eq(causes.id, poolPayouts.causeId))
    .innerJoin(poolCycles, eq(poolCycles.id, poolPayouts.cycleId))
    .where(and(eq(poolCycles.environment, "sandbox"), eq(poolPayouts.status, "executed"), gte(poolPayouts.executedAt, from), notMirrored("pool_payout", poolPayouts.id)))
    .orderBy(asc(poolPayouts.executedAt))
    .limit(2);
  for (const p of pps) {
    const r = await chain.poolPayout(p.slug, p.amount);
    const base = { kind: "pool" as const, refType: "pool_payout" as const, refId: p.id, amountMicro: p.amount };
    await record(ctx, [
      { ...base, step: "pool_fund", txHash: r.fund, account: r.treasury, note: "Community treasury receives the month's budget (test USDC stands in for ad revenue)" },
      { ...base, step: "pool_payout", txHash: r.payout, account: r.cause, note: p.slug },
    ]);
    await ctx.db.update(poolPayouts).set({ txHash: r.payout }).where(eq(poolPayouts.id, p.id));
    log(`[chain] pool payout ${p.id} → ${r.cause} ${r.payout}`);
    done++;
  }
  return { done };
}

/** Background loop for the onchain mirror (only when CHAIN_MODE=testnet). */
export function startChainSync(getCtx: () => Promise<Ctx>, log: (m: string) => void = () => {}) {
  if (!testnetChain()) return () => {};
  let running = false, stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await runChainSync(await getCtx(), log);
    } catch (e) {
      log(`[chain] sync error: ${String(e).slice(0, 300)}`);
    } finally {
      running = false;
    }
  };
  const t = setInterval(tick, 8_000);
  void tick();
  log("[hugshire] NEAR testnet mirror running");
  return () => { stopped = true; clearInterval(t); };
}
