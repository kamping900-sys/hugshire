import { desc, eq } from "drizzle-orm";
import { route } from "@/server/http";
import { chainTxs } from "@/server/db/schema";
import { explorerAccount, explorerTx, playerWallet, testnetChain } from "@/server/chain/testnet";

/** The player's onchain view in demo onchain mode (NEAR testnet): wallet, live Vault position, transactions. */
export const GET = route({ auth: "user", limit: 60 }, async ({ ctx, user }) => {
  const chain = testnetChain();
  if (!chain) return { enabled: false };
  const w = playerWallet(chain.cfg, user!.id);
  const [exists, rows] = await Promise.all([
    chain.exists(w.accountId),
    ctx.db.select().from(chainTxs).where(eq(chainTxs.userId, user!.id)).orderBy(desc(chainTxs.createdAt)).limit(20),
  ]);
  const member = exists ? await chain.member(w.accountId).catch(() => null) : null;
  const walletUsdc = exists ? await chain.usdcBalance(w.accountId).catch(() => 0n) : 0n;
  return {
    enabled: true,
    network: "testnet",
    wallet: { account: w.accountId, url: explorerAccount(w.accountId), exists },
    vault: { account: chain.cfg.vault, url: explorerAccount(chain.cfg.vault) },
    onchain: member
      ? { principalMicro: member.principal, valueMicro: member.value, yieldMicro: member.yield_amount, donatedMicro: member.donated, withdrawableMicro: member.withdrawable, walletUsdcMicro: walletUsdc.toString() }
      : null,
    txs: rows
      .filter((r) => r.txHash !== "-")
      .map((r) => ({ kind: r.kind, step: r.step, note: r.note, account: r.account, amountMicro: r.amountMicro?.toString() ?? null, at: r.createdAt, hash: r.txHash, url: explorerTx(r.txHash) })),
  };
});
