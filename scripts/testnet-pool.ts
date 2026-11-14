/**
 * Onchain Community Heart Pool payout check (NEAR testnet): treasury funded, then it pays a cause's wallet.
 *   npx tsx scripts/testnet-pool.ts [causeSlug] [usd]
 */
import fs from "node:fs";
import { TestnetChain, explorerTx, explorerAccount, type ChainConfig } from "../src/server/chain/testnet";

(async () => {
  const c = new TestnetChain(JSON.parse(fs.readFileSync(".data/chain/config.json", "utf8")) as ChainConfig);
  const slug = process.argv[2] || "pawsbury";
  const micro = BigInt(Math.round(Number(process.argv[3] || "2.5") * 1e6));
  const cause = await c.ensureCauseWallet(slug);
  const before = await c.usdcBalance(cause);
  const r = await c.poolPayout(slug, micro);
  console.log("treasury", explorerAccount(r.treasury));
  console.log("  fund  ", explorerTx(r.fund));
  console.log("  payout", explorerTx(r.payout));
  console.log(`  ${slug} wallet $${(Number(before) / 1e6).toFixed(4)} → $${(Number(await c.usdcBalance(cause)) / 1e6).toFixed(4)}`);
})();
