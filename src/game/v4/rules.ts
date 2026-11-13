/**
 * Hugshire mini-game rules. Shared by the server (authoritative) and the browser (instant feedback
 * only). Everything that affects a reward is integer / fixed-point; no floats are used for amounts.
 *
 * WOOD = one timing bar, one button. An indicator moves across the bar; the player stops it.
 *        Green zone = Perfect (2×), yellow zone = Hit (1×), anywhere else = Miss.
 *        Difficulty rises with progress (never with deposit size). Each round reveals a small batch
 *        of attempts generated from a secret server seed; the server re-judges every stop time.
 *
 * Stone has been removed: buildings are built from Wood only.
 */

export type Resource = "wood" | "stone";

/** 1 Wood = 1,000,000 µWood. */
export const RES_UNIT = 1_000_000n;

export const RULES = {
  hearts: 3,
  /** Max Wood one session can earn (Perfect and combo bonuses count toward it). */
  sessionCapMicro: 50_000n * RES_UNIT,
  /** Default cooldown after a session. 0 = off. The live value is the admin setting `gameCooldownSeconds`. */
  cooldownSeconds: 0,
  /** A session can never stay open longer than this. */
  sessionMaxSeconds: 600,
  /** Daily safeguard per supporter (rolling 24 h). */
  dailyCapMicro: 500_000n * RES_UNIT,
  /** comboMultiplier = min(1 + floor(combo / 5) × 0.05, 1.5) */
  comboStepBps: 500n,
  comboEvery: 5,
  comboMaxBps: 15_000n,
  perfectQuality: 2n,
  hitQuality: 1n,
  /** Free play (no deposit): a tiny flat reward per Hit and a small daily allowance. */
  freeBaseMicro: 500_000n, // 0.5 per Hit
  freeDailyCapMicro: 500n * 1_000_000n, // 500 per rolling 24 h
  /** Smallest verified principal that produces Wood at the deposit rate ($1). */
  minEligiblePrincipalMicro: 1_000_000n,
  /** µWood per $1 of principal per Hit, below the knee. $10 → 0.5 per Hit. */
  rewardPerUsdMicro: 50_000n,
  /** Above this principal, rewards grow with the square root (diminishing returns). */
  kneePrincipalMicro: 1_000n * 1_000_000n,
  /** Manual baseline: Hit quality, ~40 chops per session, ~6 sessions/hour → ~240 base per hour. */
  manualBaselineBasePerHour: 240n,
  /** Auto workers: 240 / 10 ≈ 24 base per hour → ~10× slower than baseline play (spec: 10–50×). */
  autoBasePerHour: 24n,
  /** Attempts revealed per round (one network round-trip per batch). */
  attemptsPerRound: 5,
  /** A round cannot be submitted sooner than the stop times it claims, minus this slack (ms). */
  submitSlackMs: 1500,
  /** An attempt with no chop within this long is a Miss. */
  attemptTimeoutMs: 8000,
} as const;

// ───────────────────────────── deposit → reward ─────────────────────────────

export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

/**
 * Base Wood per Hit (µWood) for a verified principal (µUSDC).
 * Linear up to the knee ($1,000 → 1 Wood per Hit), then grows with √(principal / knee).
 * Computed from the supporter's TOTAL principal, so splitting funds across deposits never helps.
 */
export function baseReward(principalMicro: bigint): bigint {
  if (principalMicro < RULES.minEligiblePrincipalMicro) return 0n;
  const knee = RULES.kneePrincipalMicro;
  const linear = ((principalMicro < knee ? principalMicro : knee) * RULES.rewardPerUsdMicro) / 1_000_000n;
  if (principalMicro <= knee) return linear;
  const kneeReward = (knee * RULES.rewardPerUsdMicro) / 1_000_000n;
  const ratioSqrt = isqrt((principalMicro * 1_000_000_000_000n) / knee); // √(p/knee) × 1e6
  return (kneeReward * ratioSqrt) / 1_000_000n;
}

/** comboMultiplier = min(1 + floor(combo / 5) × 0.05, 1.5), in basis points. */
export function comboBps(combo: number): bigint {
  const bps = 10_000n + BigInt(Math.floor(Math.max(0, combo) / RULES.comboEvery)) * RULES.comboStepBps;
  return bps > RULES.comboMaxBps ? RULES.comboMaxBps : bps;
}

export function actionReward(base: bigint, quality: "perfect" | "hit", combo: number): bigint {
  const q = quality === "perfect" ? RULES.perfectQuality : RULES.hitQuality;
  return (base * q * comboBps(combo)) / 10_000n;
}

/** The server picks the mini-game for a building. Only Wood exists now. */
export function pickResource(
  needs: Record<Resource, boolean>,
  coolingUntil: Record<Resource, number | null>,
  nowMs: number,
): { kind: "play"; resource: Resource } | { kind: "wait"; untilMs: number } | { kind: "done" } {
  if (!needs.wood) return { kind: "done" };
  const cd = coolingUntil.wood;
  if (cd && cd > nowMs) return { kind: "wait", untilMs: cd };
  return { kind: "play", resource: "wood" };
}

// ───────────────────────────── seeded randomness ─────────────────────────────

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const attemptSeed = (seed: number, n: number) => (Math.imul(seed ^ 0x9e3779b9, 31) + Math.imul(n + 1, 0x85ebca6b) + 17) >>> 0;

export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAMES = ["Easy", "Medium", "Hard", "Extreme"] as const;
/**
 * Difficulty by number of chops attempted in this session (never by deposit). It ramps quickly:
 * chops 1–3 still · 4–10 the target slides · 11–20 double targets + fading marker · 21+ triple targets.
 */
export const tierOf = (attempt: number): Tier => (attempt < 3 ? 0 : attempt < 10 ? 1 : attempt < 20 ? 2 : 3);

// ───────────────────────────── the timing bar ─────────────────────────────

/**
 * Configurable difficulty. Widths and positions are fractions of the bar (0..1); speeds are bar-widths
 * per second; timeouts in ms. `groups` is how the 5 attempts of a round chain into multi-target bars
 * (e.g. [2, 1, 2] = double, single, double). `fade` is the chance the marker briefly vanishes.
 */
export const BAR_TIERS = [
  { yellow: [0.3, 0.3], green: [0.11, 0.11], speed: [0.55, 0.55], zoneSpeed: [0, 0], accel: [0, 0], randomPos: false, timeoutMs: 8000, groups: [1, 1, 1, 1, 1], fade: 0 },
  { yellow: [0.22, 0.26], green: [0.08, 0.09], speed: [0.7, 0.9], zoneSpeed: [0.08, 0.16], accel: [0, 0], randomPos: true, timeoutMs: 7000, groups: [1, 1, 1, 1, 1], fade: 0 },
  { yellow: [0.17, 0.2], green: [0.06, 0.07], speed: [0.8, 1.1], zoneSpeed: [0.1, 0.2], accel: [0, 0], randomPos: true, timeoutMs: 6000, groups: [2, 1, 2], fade: 0.35 },
  { yellow: [0.14, 0.16], green: [0.05, 0.055], speed: [0.9, 1.25], zoneSpeed: [0.1, 0.24], accel: [-0.2, 0.3], randomPos: true, timeoutMs: 5000, groups: [3, 2], fade: 0.6 },
] as const;
/** Readability floor: zones never shrink below these widths. */
export const MIN_YELLOW = 0.12;
export const MIN_GREEN = 0.04;

export type BarAttempt = {
  /** attempt number within the session (drives difficulty) */
  n: number;
  tier: Tier;
  /** indicator: start position (0..1), direction, speed, and acceleration (bar-widths / s²) */
  start: number;
  dir: 1 | -1;
  speed: number;
  accel: number;
  /** target: centre (0..1) and how fast it slides (0 = still) */
  zone: number;
  zoneSpeed: number;
  zoneDir: 1 | -1;
  yellow: number;
  green: number;
  /** multi-target bars: attempts sharing `group` run on ONE timeline (stop times measured from the group's start), hit in `seq` order */
  group?: number;
  seq?: number;
  size?: number;
  /** no chop within this long (from the group's start) = Miss */
  timeoutMs?: number;
  /** the marker is invisible between these times (ms from the group's start). Visual only. */
  fade?: { from: number; to: number } | null;
};
export type WoodRound = { game: "wood"; round: number; tier: Tier; attempts: BarAttempt[] };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
export const timeoutOf = (a: BarAttempt) => a.timeoutMs ?? RULES.attemptTimeoutMs;

/** Which group an attempt belongs to: the round's tier picks the pattern of chained targets. */
function groupOf(n: number) {
  const first = n - (n % RULES.attemptsPerRound);
  const pattern = BAR_TIERS[tierOf(first)].groups;
  let at = first;
  for (const size of pattern) {
    if (n < at + size) return { leader: at, seq: n - at, size };
    at += size;
  }
  return { leader: n, seq: 0, size: 1 };
}

export function barAttempt(seed: number, n: number): BarAttempt {
  const g = groupOf(n);
  const lead = g.leader;
  const tier = tierOf(lead);
  const P = BAR_TIERS[tier];
  // motion comes from the group leader so every target in a group shares one moving marker
  const r = mulberry(attemptSeed(seed, lead));
  const yellow0 = Math.max(MIN_YELLOW, lerp(P.yellow[0], P.yellow[1], r()));
  const green0 = Math.min(yellow0 * 0.6, Math.max(MIN_GREEN, lerp(P.green[0], P.green[1], r())));
  const zone0 = P.randomPos ? lerp(yellow0 / 2 + 0.05, 1 - yellow0 / 2 - 0.05, r()) : 0.62;
  const speed = round3(lerp(P.speed[0], P.speed[1], r()));
  const accel = round3(lerp(P.accel[0], P.accel[1], r()));
  const zoneSpeed0 = lerp(P.zoneSpeed[0], P.zoneSpeed[1], r());
  const zoneDir: 1 | -1 = r() < 0.5 ? 1 : -1;
  const fadeRoll = r(), fadeFrom = 500 + r() * 900, fadeLen = 450 + r() * 450;
  let zone = zone0, yellow = yellow0, green = green0, zoneSpeed = zoneSpeed0;
  if (g.size > 1) {
    // targets sit left → right in their own slice of the bar and stand still, so the order is readable
    const own = mulberry(attemptSeed(seed, n) ^ 0x5bd1e995);
    const slice = 1 / g.size;
    yellow = Math.max(MIN_YELLOW, Math.min(yellow0, slice * 0.7));
    green = Math.min(yellow * 0.6, Math.max(MIN_GREEN, green0));
    const lo = g.seq * slice + yellow / 2 + 0.02, hi = (g.seq + 1) * slice - yellow / 2 - 0.02;
    zone = hi > lo ? lerp(lo, hi, own()) : (g.seq + 0.5) * slice;
    zoneSpeed = 0;
  }
  return {
    n,
    tier,
    start: 0,
    dir: 1,
    speed,
    accel,
    zone: round3(zone),
    zoneSpeed: round3(zoneSpeed),
    zoneDir,
    yellow: round3(yellow),
    green: round3(green),
    group: lead,
    seq: g.seq,
    size: g.size,
    timeoutMs: P.timeoutMs,
    fade: fadeRoll < P.fade ? { from: Math.round(fadeFrom), to: Math.round(fadeFrom + fadeLen) } : null,
  };
}

export function woodRound(seed: number, round: number): WoodRound {
  const first = round * RULES.attemptsPerRound;
  const attempts = Array.from({ length: RULES.attemptsPerRound }, (_, k) => barAttempt(seed, first + k));
  return { game: "wood", round, tier: attempts[0].tier, attempts };
}

/** Bounce a running position back and forth inside [lo, hi]. */
function pingPong(x: number, lo: number, hi: number) {
  const span = hi - lo;
  if (span <= 0) return lo;
  let u = (x - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u <= span ? u : 2 * span - u);
}

/** Where the indicator and the target are `tMs` after the attempt (group) started. Same maths on client and server. */
export function barAt(a: BarAttempt, tMs: number) {
  const t = Math.max(0, tMs) / 1000;
  // distance travelled with acceleration, never slower than 35% of the base speed
  const vMin = a.speed * 0.35;
  let dist: number;
  if (a.accel >= 0) dist = a.speed * t + 0.5 * a.accel * t * t;
  else {
    const tSlow = (a.speed - vMin) / -a.accel; // time until the speed floor is reached
    dist = t <= tSlow ? a.speed * t + 0.5 * a.accel * t * t : a.speed * tSlow + 0.5 * a.accel * tSlow * tSlow + vMin * (t - tSlow);
  }
  const indicator = pingPong(a.start + a.dir * dist, 0, 1);
  const zone = a.zoneSpeed ? pingPong(a.zone + a.zoneDir * a.zoneSpeed * t, a.yellow / 2, 1 - a.yellow / 2) : a.zone;
  return { indicator, zone };
}

/** Is the marker hidden at this moment (fading attempts)? Visual only: judging never looks at it. */
export function markerHidden(a: BarAttempt, tMs: number) {
  return !!a.fade && tMs >= a.fade.from && tMs <= a.fade.to;
}

export type Judgement = { t: number; result: "perfect" | "hit" | "miss"; reason?: "outside" | "timeout" | "order"; ref: number; offset: number };

/**
 * Judges one stop. `stopMs` is time since the attempt's group started; null = no chop (timeout).
 * In a multi-target group, `prevStop` is the previous target's stop: this one must come after it.
 */
export function judgeStop(a: BarAttempt, stopMs: number | null, prevStop?: number | null): Judgement {
  const limit = timeoutOf(a);
  if (stopMs === null || !Number.isFinite(stopMs) || stopMs < 0 || stopMs > limit) return { t: stopMs ?? limit, result: "miss", reason: "timeout", ref: a.n, offset: 1 };
  if ((a.seq ?? 0) > 0 && (prevStop === null || prevStop === undefined || stopMs <= prevStop)) return { t: stopMs, result: "miss", reason: "order", ref: a.n, offset: 1 };
  const { indicator, zone } = barAt(a, stopMs);
  const d = Math.abs(indicator - zone);
  if (d <= a.green / 2) return { t: stopMs, result: "perfect", ref: a.n, offset: d };
  if (d <= a.yellow / 2) return { t: stopMs, result: "hit", ref: a.n, offset: d };
  return { t: stopMs, result: "miss", reason: "outside", ref: a.n, offset: d };
}

/** Judges a whole round of stop times (one per attempt, in order). Missing entries count as timeouts. */
export function judgeRound(chart: WoodRound, stops: (number | null)[]): Judgement[] {
  return chart.attempts.map((a, i) => {
    const s = i < stops.length ? stops[i] : null;
    const prev = (a.seq ?? 0) > 0 && i > 0 ? (stops[i - 1] ?? null) : undefined;
    return judgeStop(a, s, prev);
  });
}

/** The least time a round of stops could have taken to play: one timeline per group (its last stop, or its timeout). */
export function claimedMs(chart: WoodRound, stops: (number | null)[]) {
  const byGroup = new Map<number, number>();
  chart.attempts.forEach((a, i) => {
    const x = i < stops.length ? stops[i] : null;
    const lim = timeoutOf(a);
    const t = x === null || !Number.isFinite(x) ? lim : Math.min(lim, Math.max(0, x));
    const g = a.group ?? a.n;
    byGroup.set(g, Math.max(byGroup.get(g) ?? 0, t));
  });
  return [...byGroup.values()].reduce((a, b) => a + b, 0);
}

// ───────────────────────────── applying a round ─────────────────────────────

export type SessionState = { hearts: number; combo: number; bestCombo: number; earnedMicro: bigint };
export type Applied = Judgement & { rewardMicro: bigint; combo: number; hearts: number };

/**
 * Applies judgements in order: Perfect/Hit pay base × quality × combo; Miss costs a heart and resets
 * the combo. Stops at 0 hearts or when the session budget (cap and the building's need) is used up.
 */
export function applyRound(state: SessionState, judgements: Judgement[], base: bigint, budgetMicro: bigint) {
  const s = { ...state };
  const applied: Applied[] = [];
  let stopped: "hearts" | "cap" | null = null;
  for (const j of judgements) {
    if (s.hearts <= 0 || s.earnedMicro >= budgetMicro) break;
    let reward = 0n;
    if (j.result === "perfect" || j.result === "hit") {
      s.combo += 1;
      s.bestCombo = Math.max(s.bestCombo, s.combo);
      reward = actionReward(base, j.result, s.combo);
      if (s.earnedMicro + reward > budgetMicro) reward = budgetMicro - s.earnedMicro;
      s.earnedMicro += reward;
    } else {
      s.hearts -= 1;
      s.combo = 0;
    }
    applied.push({ ...j, rewardMicro: reward, combo: s.combo, hearts: s.hearts });
  }
  if (s.hearts <= 0) stopped = "hearts";
  else if (s.earnedMicro >= budgetMicro) stopped = "cap";
  return { state: s, applied, stopped };
}

/** Anti-automation heuristic: every chop dead-centre, again and again, is not a human. */
export function suspiciouslyPrecise(js: Judgement[]): boolean {
  const ok = js.filter((j) => j.result !== "miss");
  if (ok.length < RULES.attemptsPerRound) return false;
  return ok.every((j) => j.offset < 0.0015);
}

/** Display helper: µWood → "12.3456". */
export function formatRes(micro: bigint | string, dp = 4): string {
  const v = typeof micro === "string" ? BigInt(micro) : micro;
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / RES_UNIT;
  const frac = (a % RES_UNIT).toString().padStart(6, "0").slice(0, dp).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
