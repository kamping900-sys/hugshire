/**
 * Moves test NEAR from extra faucet accounts into the ops account (which pays for players' wallets and gas).
 *   npx tsx scripts/testnet-sweep.ts <from.testnet> [<from2.testnet> ...]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { actionCreators } from "@near-js/transactions";
import { TestnetChain, MILLINEAR, explorerTx, type ChainConfig } from "../src/server/chain/testnet";

(async () => {
  const cfg = JSON.parse(fs.readFileSync(".data/chain/config.json", "utf8")) as ChainConfig;
  const c = new TestnetChain(cfg);
  for (const from of process.argv.slice(2)) {
    const key = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".near-credentials", "testnet", `${from}.json`), "utf8")).private_key;
    const acct = await c.rpc.call<{ amount: string }>("query", { request_type: "view_account", finality: "final", account_id: from });
    const amount = BigInt(acct.amount) - 150n * MILLINEAR; // keep a little for the account's own storage
    const h = await c.send(from, key, cfg.ops, [actionCreators.transfer(amount)]);
    console.log(`${from} → ${cfg.ops}: ${(Number(amount / MILLINEAR) / 1000).toFixed(2)} NEAR`, explorerTx(h));
  }
})();
