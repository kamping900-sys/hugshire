/**
 * Integer reference model of the v2 share accounting (same formulas as the contract).
 * Prints the worked examples used in docs/VAULT_V2.md.  node contracts/vault/model/examples.cjs
 */
const VS = 1_000_000n, VA = 1n; // virtual shares / virtual assets (inflation-attack guard)
const U = 1_000_000n; // 1 USDC in micro units
const ceilDiv = (a, b) => (a + b - 1n) / b;
class Vault {
  constructor() { this.A = 0n; this.S = 0n; this.u = {}; this.causes = {}; }
  user(n) { return (this.u[n] ??= { shares: 0n, principal: 0n, donated: 0n }); }
  toShares(x) { return (x * (this.S + VS)) / (this.A + VA); } // floor: mint
  toAssets(s) { return (s * (this.A + VA)) / (this.S + VS); } // floor: redeem
  sharesFor(x) { return ceilDiv(x * (this.S + VS), this.A + VA); } // ceil: burn for exact assets
  value(n) { return this.toAssets(this.user(n).shares); }
  yieldOf(n) { const v = this.value(n), p = this.user(n).principal; return v > p ? v - p : 0n; }
  withdrawable(n) { const v = this.value(n), p = this.user(n).principal; return v < p ? v : p; }
  deposit(n, x) { const s = this.toShares(x); const a = this.user(n); a.shares += s; a.principal += x; this.S += s; this.A += x; return s; }
  accrue(bps) { this.A = this.A + (this.A * BigInt(bps)) / 10000n; }
  lose(bps) { this.A = this.A - (this.A * BigInt(bps)) / 10000n; }
  donate(n, cause, x) {
    if (x > this.yieldOf(n)) throw new Error("exceeds yield");
    const a = this.user(n); let s = this.sharesFor(x); if (s > a.shares) s = a.shares;
    a.shares -= s; this.S -= s; this.A -= x; a.donated += x; this.causes[cause] = (this.causes[cause] ?? 0n) + x; return s;
  }
  withdraw(n, x) {
    const a = this.user(n), v = this.value(n), wd = this.withdrawable(n);
    if (x > wd) throw new Error("exceeds withdrawable");
    let s = this.sharesFor(x); if (s > a.shares) s = a.shares;
    const pr = v >= a.principal ? x : ceilDiv(x * a.principal, v); // loss: reduce basis pro-rata
    a.shares -= s; this.S -= s; this.A -= x; a.principal -= pr > a.principal ? a.principal : pr; return { s, pr };
  }
  price() { return Number((this.A + VA) * 10n ** 12n / (this.S + VS)) / 1e6; }
}
const fmt = (x) => (Number(x) / 1e6).toFixed(6);
const show = (v, label) => {
  console.log(`  ${label}: A=${fmt(v.A)} S=${v.S} price(µUSDC/share×1e6)=${v.price().toFixed(6)}`);
  for (const [n, a] of Object.entries(v.u)) console.log(`    ${n}: shares=${a.shares} principal=${fmt(a.principal)} value=${fmt(v.value(n))} yield=${fmt(v.yieldOf(n))} donated=${fmt(a.donated)}`);
};
const sumCheck = (v) => { const sumS = Object.values(v.u).reduce((s, a) => s + a.shares, 0n); const sumV = Object.keys(v.u).reduce((s, n) => s + v.value(n), 0n); console.log(`    check Σshares==S: ${sumS === v.S}, Σvalue<=A: ${sumV <= v.A} (dust ${v.A - sumV} µ)`); };

console.log("Example 1 — unequal deposit times");
let v = new Vault();
v.deposit("alice", 1000n * U); show(v, "Alice deposits 1,000");
v.accrue(1000); show(v, "pool earns +10%");
v.deposit("bob", 1000n * U); show(v, "Bob deposits 1,000");
v.accrue(500); show(v, "pool earns +5%"); sumCheck(v);

console.log("\nExample 2 — Alice donates all her yield; Bob is unaffected");
const bobBefore = v.value("bob");
const ay = v.yieldOf("alice"); v.donate("alice", "shelter.near", ay); show(v, `Alice donates ${fmt(ay)}`);
console.log(`    Bob value before ${fmt(bobBefore)} after ${fmt(v.value("bob"))}`); sumCheck(v);

console.log("\nExample 3 — Bob withdraws 400 of principal in profit (his yield stays)");
const byBefore = v.yieldOf("bob"); v.withdraw("bob", 400n * U); show(v, "Bob withdraws 400");
console.log(`    Bob yield before ${fmt(byBefore)} after ${fmt(v.yieldOf("bob"))}`); sumCheck(v);

console.log("\nExample 4 — 20% protocol loss: no yield to donate, principal shared pro-rata");
v.lose(2000); show(v, "pool loses 20%");
console.log(`    Alice withdrawable ${fmt(v.withdrawable("alice"))}, Bob withdrawable ${fmt(v.withdrawable("bob"))}`);
try { v.donate("bob", "shelter.near", 1n); } catch (e) { console.log(`    Bob donate 0.000001 → refused: ${e.message}`); }
const r = v.withdraw("alice", v.withdrawable("alice")); show(v, `Alice withdraws everything she can (basis reduced by ${fmt(r.pr)})`); sumCheck(v);

console.log("\nExample 5 — rounding always favours the vault");
v = new Vault(); v.deposit("a", 3n); v.accrue(3333); v.deposit("b", 7n);
show(v, "tiny amounts"); const s = v.sharesFor(1n); console.log(`    burning for 1 µ costs ${s} shares, which redeem for ${v.toAssets(s)} µ (≥ 1)`); sumCheck(v);

console.log("\nExample 6 — inflation attack is not profitable");
v = new Vault(); v.deposit("attacker", 1n); v.A += 1_000n * U; // attacker 'donates' 1,000 USDC directly
const victimShares = v.deposit("victim", 999n * U); show(v, "attacker front-runs victim");
console.log(`    victim got ${victimShares} shares; victim value ${fmt(v.value("victim"))} of 999 deposited`);
