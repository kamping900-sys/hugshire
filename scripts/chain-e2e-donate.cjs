/**
 * App-level onchain donation check (:3400, onchain mode, Fay backfilled): Fay sends ripe Heart Tree fruit
 * to Fernhollow through the normal delivery API; the mirror turns it into vault.donate → the cause's wallet.
 *   node scripts/chain-e2e-donate.cjs
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
async function waitFor(label, fn, max = 240) {
  for (let i = 0; i < max / 5; i++) { const v = await fn(); if (v) return v; await sleep(5000); }
  throw new Error("timed out: " + label);
}
(async () => {
  const email = "sample-fay@hugshire.test";
  const a = await api("POST", "/api/auth/dev/request", { email });
  await api("POST", "/api/auth/dev/verify", { email, code: a.devCode });
  const c0 = await waitFor("Fay's deposit mirrored", async () => { const c = await api("GET", "/api/chain"); return c.onchain && BigInt(c.onchain.principalMicro) > 0n ? c : null; });
  console.log("Fay onchain", c0.onchain, c0.wallet.url);
  const tree = await api("GET", "/api/heart-tree");
  const ripe = BigInt(tree.red.eligibleMicro);
  console.log("ripe fruit $", Number(ripe) / 1e6);
  const world = await api("GET", "/api/world");
  const fern = world.towns.find((t) => t.slug === "fernhollow");
  console.log("waiting 65 s (one Vault operation per supporter per minute after the deposit)…");
  await sleep(65_000);
  const d = await api("POST", "/api/deliveries", { causeId: fern.id, idempotencyKey: "e2e-d-" + Date.now(), capMicro: (ripe > 60000n ? 60000n : ripe).toString() });
  console.log("delivery", JSON.stringify(d).slice(0, 160));
  const c1 = await waitFor("donation onchain", async () => { const c = await api("GET", "/api/chain"); return c.txs.find((t) => t.step === "donate") ? c : null; });
  for (const t of c1.txs.filter((t) => t.step === "donate")) console.log("  donate", t.amountMicro, t.url);
  console.log("Fay onchain after donation", c1.onchain);
})().catch((e) => { console.error(e); process.exit(1); });
