/**
 * Dev server in demo onchain mode (NEAR testnet), port 3400:
 *   node scripts/dev-chain.cjs
 * Reads .data/chain/config.json (from scripts/testnet-setup.ts) and passes it to the app as CHAIN_* env vars.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const APP = path.join(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(APP, ".data", "chain", "config.json"), "utf8"));
const env = {
  ...process.env,
  HUGSHIRE_MODE: "sandbox",
  APP_URL: "http://localhost:3400",
  CHAIN_MODE: "testnet",
  CHAIN_RPC_URL: cfg.rpcUrl,
  CHAIN_ROOT: cfg.root,
  CHAIN_OPS: cfg.ops,
  CHAIN_ROOT_KEY: cfg.keys.root,
  CHAIN_OPS_KEY: cfg.keys.ops,
  CHAIN_KEEPER_KEY: cfg.keys.keeper,
  CHAIN_WALLET_SECRET: cfg.walletSecret,
  CHAIN_SINCE: cfg.since || new Date().toISOString(),
  CHAIN_BACKFILL_EMAILS: process.env.CHAIN_BACKFILL_EMAILS || "sample-fay@hugshire.test",
};
const p = spawn(process.execPath, [path.join(APP, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", "3400"], { cwd: APP, env, stdio: "inherit" });
p.on("exit", (c) => process.exit(c ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => p.kill(s));
