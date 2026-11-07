/**
 * Money primitives. All amounts are bigint micro-USDC (1 USDC = 1_000_000 micro).
 * Never use floating point for money. These helpers are shared by client and server.
 */
export const USDC_DECIMALS = 6;
export const MICRO = 1_000_000n;
/** 1e18 fixed-point scale used for rates (APR) and pro-rata maths. */
export const WAD = 10n ** 18n;
export const SECONDS_PER_YEAR = 31_536_000n;

export type Micro = bigint;

/** Parse a user-entered dollar string like "25", "25.5", "1,000.25" into micro-USDC. */
export function parseUsd(input: string): Micro {
  const s = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(s)) throw new Error("Enter an amount like 25 or 25.50");
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * MICRO + BigInt((frac + "000000").slice(0, 6));
}

/** Format micro-USDC as dollars. `precise` shows up to 6 decimals for small yields. */
export function formatUsd(micro: Micro | string | number, opts: { precise?: boolean; sign?: boolean } = {}): string {
  const v = typeof micro === "bigint" ? micro : BigInt(micro);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / MICRO;
  const frac = abs % MICRO;
  let decimals = 2;
  if (opts.precise && abs > 0n) {
    // show enough decimals that tiny amounts are not rendered as $0.00
    decimals = abs > 0n && abs < 10_000n ? 6 : abs < 1_000_000n ? 4 : 2;
  }
  const fracStr = frac.toString().padStart(6, "0").slice(0, decimals);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = neg ? "-" : opts.sign && v > 0n ? "+" : "";
  return `${sign}$${wholeStr}${decimals ? "." + fracStr : ""}`;
}

/** Convert a decimal string (e.g. "0.0896842689") to a WAD-scaled bigint, truncating. */
export function decimalToWad(dec: string): bigint {
  const s = dec.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid decimal: ${dec}`);
  const [w, f = ""] = s.split(".");
  return BigInt(w) * WAD + BigInt((f + "0".repeat(18)).slice(0, 18));
}

export function wadToPercentString(wad: bigint, dp = 2): string {
  const scaled = (wad * 100n * 10n ** BigInt(dp)) / WAD;
  const s = scaled.toString().padStart(dp + 1, "0");
  return `${s.slice(0, -dp) || "0"}.${s.slice(-dp)}%`;
}

/** Simple-interest yield for `principal` over `seconds` at `aprWad`. Floors to micro. */
export function simpleInterest(principal: Micro, aprWad: bigint, seconds: bigint): Micro {
  if (principal <= 0n || seconds <= 0n || aprWad <= 0n) return 0n;
  return (principal * aprWad * seconds) / (WAD * SECONDS_PER_YEAR);
}

/**
 * Split `total` across `weights` exactly (largest remainder method).
 * The parts always sum to `total`. Ties are broken by input order, deterministically.
 */
export function allocateProRata(total: bigint, weights: bigint[]): bigint[] {
  if (total < 0n) throw new Error("allocateProRata: negative total");
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n || total === 0n) return weights.map(() => 0n);
  const base = weights.map((w) => (total * w) / sum);
  const rema = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - base.reduce((a, b) => a + b, 0n);
  rema.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rema) {
    if (left === 0n) break;
    if (weights[i] === 0n) continue;
    base[i] += 1n;
    left -= 1n;
  }
  return base;
}

export const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);

/** Serialize bigint for JSON responses (as decimal string). */
export const toStr = (v: bigint) => v.toString();
