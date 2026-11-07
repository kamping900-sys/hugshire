/**
 * Read-only checks against the real external services. Moves no money and signs nothing.
 *   npm run verify:live
 * Run it after each setup step in SETUP_GUIDE.md; it tells you what is still missing.
 */
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { env } from "../src/server/env";
import { NearRpc, readRheaSupplied } from "../src/server/providers/near";
import { ASSET_BASE_USDC, ASSET_NEAR_USDC } from "../src/server/providers/live";
import { wadToPercentString, decimalToWad } from "../src/lib/money";

const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => console.log(`  ! ${m}`);
const bad = (m: string) => console.log(`  ✗ ${m}`);

async function main() {
  const e = env();
  const rpc = new NearRpc(e.NEAR_RPC_URL);
  console.log(`Hugshire live verification (mode: ${e.HUGSHIRE_MODE})\n`);

  console.log("NEAR / RHEA");
  try {
    const asset = await rpc.view<{ supply_apr: string; config: { can_deposit: boolean; can_withdraw: boolean; extra_decimals: number } }>(e.RHEA_LENDING_CONTRACT, "get_asset", { token_id: e.NEAR_USDC_CONTRACT });
    ok(`RHEA USDC supply APR ${wadToPercentString(decimalToWad(asset.supply_apr))}`);
    asset.config.can_deposit ? ok("RHEA accepts USDC deposits") : bad("RHEA USDC deposits are DISABLED");
    asset.config.can_withdraw ? ok("RHEA allows USDC withdrawals") : bad("RHEA USDC withdrawals are DISABLED");
    asset.config.extra_decimals === 12 ? ok("extra_decimals = 12 (matches the Vault)") : bad(`extra_decimals = ${asset.config.extra_decimals}; the Vault assumes 12 — do not deploy`);
    const md = await rpc.view<{ decimals: number; symbol: string }>(e.NEAR_USDC_CONTRACT, "ft_metadata");
    md.decimals === 6 ? ok(`${md.symbol} has 6 decimals`) : bad(`USDC decimals ${md.decimals}`);
  } catch (err) {
    bad(`NEAR RPC: ${(err as Error).message}`);
  }

  console.log("\nNEAR Intents 1Click");
  try {
    const tokens = (await (await fetch(`${e.ONECLICK_BASE_URL}/v0/tokens`)).json()) as { assetId: string }[];
    tokens.some((t) => t.assetId === ASSET_BASE_USDC) ? ok("Base USDC listed") : bad("Base USDC not listed");
    tokens.some((t) => t.assetId === ASSET_NEAR_USDC) ? ok("NEAR USDC listed") : bad("NEAR USDC not listed");
    const res = await fetch(`${e.ONECLICK_BASE_URL}/v0/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(e.ONECLICK_API_KEY ? { "X-API-Key": e.ONECLICK_API_KEY } : {}) },
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_INPUT",
        slippageTolerance: 50,
        originAsset: ASSET_BASE_USDC,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: ASSET_NEAR_USDC,
        amount: "10000000",
        refundTo: "0x1111111111111111111111111111111111111111", // placeholder; 1Click rejects the burn address
        refundType: "ORIGIN_CHAIN",
        recipient: e.NEAR_VAULT_CONTRACT ?? "contract.main.burrow.near",
        recipientType: "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });
    const txt = await res.text();
    if (res.ok) {
      const q = JSON.parse(txt).quote;
      ok(`Dry quote 10 USDC Base → NEAR: receive ${q.amountOutFormatted} in ~${q.timeEstimate}s`);
    } else warn(`Dry quote HTTP ${res.status}: ${txt.slice(0, 160)}`);
    e.ONECLICK_API_KEY ? ok("API key set (0.01% stablecoin fee)") : warn("No ONECLICK_API_KEY: +0.25% fee on every swap (partners.near-intents.org)");
  } catch (err) {
    bad(`1Click: ${(err as Error).message}`);
  }

  console.log("\nCoinbase Developer Platform");
  if (e.CDP_API_KEY_ID && e.CDP_API_KEY_SECRET) {
    try {
      const jwt = await generateJwt({ apiKeyId: e.CDP_API_KEY_ID, apiKeySecret: e.CDP_API_KEY_SECRET, requestMethod: "POST", requestHost: "api.developer.coinbase.com", requestPath: "/onramp/v1/token", expiresIn: 120 });
      const res = await fetch("https://api.developer.coinbase.com/onramp/v1/token", {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({ addresses: [{ address: "0x000000000000000000000000000000000000dEaD", blockchains: ["base"] }], assets: ["USDC"], clientIp: "192.0.2.1" }),
      });
      res.ok ? ok("Onramp session token created (credentials work)") : bad(`Session token HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    } catch (err) {
      bad(`CDP: ${(err as Error).message}`);
    }
  } else warn("CDP_API_KEY_ID / CDP_API_KEY_SECRET not set");
  e.CDP_WEBHOOK_SECRET ? ok("Webhook secret set") : warn("CDP_WEBHOOK_SECRET not set");

  console.log("\nHugshire Vault");
  if (e.NEAR_VAULT_CONTRACT) {
    try {
      const t = await rpc.view<{ total_principal: string; paused: boolean }>(e.NEAR_VAULT_CONTRACT, "get_totals");
      ok(`Vault reachable: total principal ${t.total_principal}, paused=${t.paused}`);
      const [owner, operator] = await rpc.view<[string, string]>(e.NEAR_VAULT_CONTRACT, "get_roles");
      ok(`Owner ${owner}, operator ${operator}`);
      operator === e.NEAR_OPERATOR_ACCOUNT ? ok("Operator matches NEAR_OPERATOR_ACCOUNT") : bad("Operator does not match NEAR_OPERATOR_ACCOUNT");
      owner === operator ? bad("Owner and operator are the same account — use a multisig owner") : ok("Owner and operator are separate");
      const sb = await rpc.view<{ total: string } | null>(e.RHEA_LENDING_CONTRACT, "storage_balance_of", { account_id: e.NEAR_VAULT_CONTRACT });
      sb ? ok("Vault is registered with RHEA") : bad("Vault has no RHEA storage deposit (0.1 NEAR) — supply will fail");
      const usb = await rpc.view<{ total: string } | null>(e.NEAR_USDC_CONTRACT, "storage_balance_of", { account_id: e.NEAR_VAULT_CONTRACT });
      usb ? ok("Vault is registered with USDC") : bad("Vault has no USDC storage deposit — deposits will bounce");
      ok(`Vault supplied in RHEA: ${await readRheaSupplied(rpc, e.RHEA_LENDING_CONTRACT, e.NEAR_VAULT_CONTRACT, e.NEAR_USDC_CONTRACT)} micro-USDC`);
    } catch (err) {
      bad(`Vault: ${(err as Error).message}`);
    }
  } else warn("NEAR_VAULT_CONTRACT not set (deploy contracts/vault first)");

  console.log("\nAuth");
  e.PRIVY_APP_ID && e.PRIVY_VERIFICATION_KEY ? ok("Privy configured") : warn("Privy not configured (live sign-in and wallets)");
}

main().then(() => process.exit(0));
