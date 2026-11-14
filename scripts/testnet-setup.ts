/**
 * One-time NEAR testnet setup for the onchain demo (testnet only, no real value).
 *   npx tsx scripts/testnet-setup.ts <root.testnet> <ops.testnet>
 * Uses the full-access keys near-cli-rs saved in ~/.near-credentials/testnet. Creates:
 *   usdc.<root>  mock USDC (minter = ops)      rhea.<root>  mock RHEA (admin = ops)
 *   vault.<root> Hugshire Vault (owner = root, keeper = keeper.<ops>)
 *   keeper.<ops> keeper hot key                <cause>.<ops> one receiving wallet per town
 * Writes .data/chain/config.json (gitignored) with the keys the server needs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { KeyPairEd25519 } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import { TestnetChain, MILLINEAR, NEAR, type ChainConfig, explorerAccount } from "../src/server/chain/testnet";

const [root, ops] = process.argv.slice(2);
if (!root?.endsWith(".testnet") || !ops?.endsWith(".testnet")) throw new Error("usage: testnet-setup.ts <root.testnet> <ops.testnet>");
const cred = (id: string) => JSON.parse(fs.readFileSync(path.join(os.homedir(), ".near-credentials", "testnet", `${id}.json`), "utf8")).private_key as string;
const WASM = path.join(__dirname, "..", "contracts", "target", "wasm32-unknown-unknown", "release");
const OUT = path.join(__dirname, "..", ".data", "chain");
fs.mkdirSync(OUT, { recursive: true });
const CAUSES = ["pawsbury", "inkwell-hollow", "fernhollow", "ladle-lane"];

(async () => {
  const keeperKp = KeyPairEd25519.fromRandom();
  const existing = fs.existsSync(path.join(OUT, "config.json")) ? (JSON.parse(fs.readFileSync(path.join(OUT, "config.json"), "utf8")) as ChainConfig) : null;
  const cfg: ChainConfig = existing ?? {
    rpcUrl: "https://test.rpc.fastnear.com",
    root, ops,
    usdc: `usdc.${root}`, rhea: `rhea.${root}`, vault: `vault.${root}`, keeper: `keeper.${ops}`,
    keys: { root: cred(root), ops: cred(ops), keeper: keeperKp.toString() },
    walletSecret: randomBytes(32).toString("hex"),
  };
  fs.writeFileSync(path.join(OUT, "config.json"), JSON.stringify(cfg, null, 2));
  const c = new TestnetChain(cfg);
  const step = async (label: string, f: () => Promise<string | void>) => { const h = await f(); console.log(`✓ ${label}${h ? `  ${h}` : ""}`); };

  // contracts: account + code + init in one transaction each
  const deploy = async (account: string, wasm: string, near: bigint, init: Record<string, unknown>) => {
    if (await c.exists(account)) return console.log(`= ${account} exists`);
    const kp = KeyPairEd25519.fromRandom();
    const code = fs.readFileSync(path.join(WASM, wasm));
    await step(`deploy ${account} (${(code.length / 1024).toFixed(0)} KB)`, () =>
      c.send(root, cfg.keys.root, account, [
        actionCreators.createAccount(),
        actionCreators.transfer(near),
        actionCreators.addKey(kp.getPublicKey(), actionCreators.fullAccessKey()),
        actionCreators.deployContract(new Uint8Array(code)),
        actionCreators.functionCall("new", init, 100n * 10n ** 12n, 0n),
      ]),
    );
  };
  await deploy(cfg.usdc, "mock_usdc.wasm", 2_100n * MILLINEAR, { minter: ops });
  await deploy(cfg.rhea, "mock_rhea.wasm", 2_100n * MILLINEAR, { admin: ops, usdc: cfg.usdc });
  await deploy(cfg.vault, "hugshire_vault.wasm", 3_900n * MILLINEAR, { owner_id: root, keeper_id: cfg.keeper, usdc: cfg.usdc, rhea: cfg.rhea });

  if (!(await c.exists(cfg.keeper))) await step(`create ${cfg.keeper}`, () => c.createSubAccount(ops, cfg.keys.ops, cfg.keeper, keeperKp.getPublicKey().toString(), 1n * NEAR));
  // storage: the Vault and the pool need USDC accounts; the Vault needs a RHEA account
  await step("usdc storage for vault", () => c.call(ops, cfg.keys.ops, cfg.usdc, "storage_deposit", { account_id: cfg.vault }, 30n, 13n * MILLINEAR));
  await step("usdc storage for rhea", () => c.call(ops, cfg.keys.ops, cfg.usdc, "storage_deposit", { account_id: cfg.rhea }, 30n, 13n * MILLINEAR));
  await step("rhea storage for vault", () => c.call(ops, cfg.keys.ops, cfg.rhea, "storage_deposit", { account_id: cfg.vault }, 30n, 100n * MILLINEAR));
  await step("open deposits", () => c.call(root, cfg.keys.root, cfg.vault, "set_deposits_public", { public: true }, 30n));
  for (const slug of CAUSES) await step(`cause wallet ${slug}`, async () => { await c.ensureCauseWallet(slug); });
  console.log("\nVault:", explorerAccount(cfg.vault));
  console.log("config written to .data/chain/config.json");
})();
