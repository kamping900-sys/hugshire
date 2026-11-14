/**
 * End-to-end onchain check on NEAR testnet: deposit → interest → donate to a cause → withdraw.
 *   npx tsx scripts/testnet-demo.ts [userId]
 */
import fs from "node:fs";
import { TestnetChain, explorerTx, explorerAccount, type ChainConfig } from "../src/server/chain/testnet";

const usd = (m: bigint) => "$" + (Number(m) / 1e6).toFixed(4);

(async () => {
  const c = new TestnetChain(JSON.parse(fs.readFileSync(".data/chain/config.json", "utf8")) as ChainConfig);
  const user = process.argv[2] || "demo-user-1";
  for (const s of ["pawsbury", "inkwell-hollow", "fernhollow", "ladle-lane"]) await c.ensureCauseWallet(s);

  const d = await c.deposit(user, 25_000_000n);
  console.log("player wallet", explorerAccount(d.wallet));
  for (const [k, h] of Object.entries({ mint: d.mint, toVault: d.toVault, processed: d.processed, supplied: d.supplied })) console.log("  deposit", k.padEnd(9), explorerTx(h));
  console.log("  member after deposit", await c.member(d.wallet));

  const causeId = await c.ensureCauseWallet("fernhollow");
  const before = await c.usdcBalance(causeId);
  const don = await c.donate(user, "fernhollow", 50_000n); // $0.05 of yield
  console.log("  donate  ", explorerTx(don.hash), "cause", usd(before), "→", usd(await c.usdcBalance(causeId)));

  console.log("  (the Vault allows one operation per supporter per minute; waiting 62 s)");
  await new Promise((r) => setTimeout(r, 62_000));
  const wb = await c.usdcBalance(d.wallet);
  const wd = await c.withdraw(user, 5_000_000n);
  console.log("  withdraw", explorerTx(wd.hash), "wallet", usd(wb), "→", usd(await c.usdcBalance(d.wallet)));
  console.log("  member at end", await c.member(d.wallet));
})();
