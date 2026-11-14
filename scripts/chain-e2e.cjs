/**
 * App-level onchain check (dev server in onchain mode on :3400): a new player deposits through the normal
 * test checkout and later withdraws; the NEAR testnet mirror should turn both into real transactions.
 *   node scripts/chain-e2e.cjs
 */
const B = process.env.BASE || "http://localhost:3400";
let cookie = "";
async function api(method, url, body) {
  const r = await fetch(B + url, { method, headers: { "content-type": "application/json", origin: B, cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label, fn, max = 180) {
  for (let i = 0; i < max / 5; i++) { const v = await fn(); if (v) return v; await sleep(5000); }
  throw new Error("timed out: " + label);
}
(async () => {
  const email = `chain-${Date.now().toString(36)}@hugshire.test`;
  const a = await api("POST", "/api/auth/dev/request", { email });
  await api("POST", "/api/auth/dev/verify", { email, code: a.devCode });
  const world = await api("GET", "/api/world");
  const fern = world.towns.find((t) => t.slug === "fernhollow");
  await api("POST", "/api/journey", { action: "onboard", animal: "cat", nickname: "Maple", homeCauseId: fern.id });
  await api("PUT", "/api/me", { acknowledgeRisk: true });
  const dep = await api("POST", "/api/deposits", { causeId: fern.id, amountUsd: "40", animal: "cat", nickname: "Maple", idempotencyKey: "e2e-" + Date.now() });
  const id = dep.checkoutUrl.match(/checkout\/([^/?#]+)/)[1];
  console.log("checkout", (await api("POST", `/api/deposits/${id}/sandbox-complete`, {})).status);
  const c1 = await waitFor("deposit onchain", async () => { const c = await api("GET", "/api/chain"); return c.onchain && BigInt(c.onchain.principalMicro) > 0n ? c : null; });
  console.log("wallet", c1.wallet.url);
  console.log("onchain after deposit", c1.onchain);
  for (const t of c1.txs) console.log("  ", t.step.padEnd(9), t.url);
  console.log("waiting 65 s (one Vault operation per supporter per minute)…");
  await sleep(65_000);
  const w = await api("POST", "/api/withdrawals", { amountUsd: "10", idempotencyKey: "e2e-w-" + Date.now() });
  console.log("withdraw request", w.withdrawal?.status ?? JSON.stringify(w).slice(0, 200));
  const c2 = await waitFor("withdrawal onchain", async () => { const c = await api("GET", "/api/chain"); return c.txs.find((t) => t.step === "withdraw") ? c : null; });
  console.log("onchain after withdrawal", c2.onchain);
  for (const t of c2.txs.filter((t) => t.step === "withdraw")) console.log("  withdraw ", t.url);
})().catch((e) => { console.error(e); process.exit(1); });
