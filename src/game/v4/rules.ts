/**
 * Hugshire V4 mini-game rules. Shared by the server (authoritative) and the browser (instant
 * feedback only). Everything that affects a reward is integer / fixed-point; no floats are used
 * for amounts. Charts are generated from a secret server seed and revealed one round at a time.
 *
 * WOOD  = player-driven rhythm execution. The NPC presents logs; the player times each swing.
 *         Fake-outs must NOT be swung at. No memorisation.
 * STONE = call-and-response memory. The NPC demonstrates a rhythm; the player repeats it
 *         (right button + right timing). 1 → 4 buttons as difficulty rises.
 */

export type Resource = "wood" | "stone";

/** 1 Wood (or Stone) = 1,000,000 µ units. */
export const RES_UNIT = 1_000_000n;

export const RULES = {
  hearts: 3,
  /** Max resources one session can earn (Perfect and combo bonuses count toward it). */
  sessionCapMicro: 1000n * RES_UNIT,
  /** Independent per-resource cooldown after a session ends (any reason, including quit). */
  cooldownSeconds: 300,
  /** A session can never stay open longer than this. */
  sessionMaxSeconds: 360,
  /** Daily safeguard per supporter per resource (rolling 24 h). */
  dailyCapMicro: 10_000n * RES_UNIT,
  /** Combo multiplier: +5% per consecutive success after the first, capped at +100% (2×). */
  comboStepBps: 500n,
  comboMaxSteps: 20,
  perfectQuality: 2n,
  hitQuality: 1n,
  /** Smallest verified principal that produces resources ($1). */
  minEligiblePrincipalMicro: 1_000_000n,
  /** µresource per $1 of principal per Hit, below the knee. $10 → 0.01 per Hit. */
  rewardPerUsdMicro: 1_000n,
  /** Above this principal, rewards grow with the square root (diminishing returns). */
  kneePrincipalMicro: 1_000n * 1_000_000n,
  /** Manual baseline: Hit quality, avg combo ×1.5, 60 actions/session, ~8.5 min/session incl. cooldown. */
  manualBaselineBasePerHour: 635n,
  /** Auto workers produce this many base rewards per hour: 635 / 25 ≈ 25× slower than baseline play. */
  autoBasePerHour: 25n,
  /** A round cannot be submitted sooner than its real duration minus this slack (ms). */
  submitSlackMs: 1500,
  /** Latency compensation: median offset is removed, clamped to this many ms. */
  maxOffsetCompMs: { wood: 60, stone: 120 } as Record<Resource, number>,
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
 * Base reward per Hit (µresource) for a verified principal (µUSDC).
 * Linear up to the knee ($1,000 → 1 resource per Hit), then grows with √(principal / knee).
 * Computed from the supporter's TOTAL principal, so splitting funds across deposits or helpers
 * never increases output. (Splitting across separate accounts is covered by the linear region,
 * per-account daily caps and real play time; see docs/GAME_ECONOMY.md.)
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

export function comboBps(combo: number): bigint {
  const steps = Math.max(0, Math.min(RULES.comboMaxSteps, combo - 1));
  return 10_000n + BigInt(steps) * RULES.comboStepBps;
}

export function actionReward(base: bigint, quality: "perfect" | "hit", combo: number): bigint {
  const q = quality === "perfect" ? RULES.perfectQuality : RULES.hitQuality;
  return (base * q * comboBps(combo)) / 10_000n;
}

/** Wood and Stone the server picks for a building (never the client). */
export function pickResource(
  needs: Record<Resource, boolean>,
  coolingUntil: Record<Resource, number | null>,
  nowMs: number,
  coin: number,
): { kind: "play"; resource: Resource } | { kind: "wait"; untilMs: number } | { kind: "done" } {
  const need = (["wood", "stone"] as Resource[]).filter((r) => needs[r]);
  if (!need.length) return { kind: "done" };
  const ready = need.filter((r) => !coolingUntil[r] || coolingUntil[r]! <= nowMs);
  if (!ready.length) return { kind: "wait", untilMs: Math.min(...need.map((r) => coolingUntil[r]!)) };
  if (ready.length === 1) return { kind: "play", resource: ready[0] };
  return { kind: "play", resource: coin < 0.5 ? "wood" : "stone" };
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
const roundSeed = (seed: number, round: number, salt: number) => (Math.imul(seed ^ 0x9e3779b9, 31) + Math.imul(round + 1, 0x85ebca6b) + salt) >>> 0;

export type Tier = 0 | 1 | 2 | 3;
export const TIER_NAMES = ["Early", "Medium", "Hard", "Extreme"] as const;
export const tierOf = (round: number): Tier => (round < 3 ? 0 : round < 6 ? 1 : round < 10 ? 2 : 3);

// ───────────────────────────── WOOD charts ─────────────────────────────

export type WoodEvent = {
  i: number;
  /** ms from round start when the log is at the chopping point (or the fake's would-be moment). */
  t: number;
  kind: "log" | "fake";
  variant: "normal" | "fast" | "delayed" | "burst";
  /** The indicator sweeps for this long; the target zone sits at `zoneAt` of the sweep. */
  approachMs: number;
  zoneAt: number;
  perfectMs: number;
  hitMs: number;
  /** Fakes only: fraction of the approach at which the NPC visibly pulls back (the tell). */
  tellAt?: number;
};
export type WoodRound = { game: "wood"; round: number; tier: Tier; durationMs: number; events: WoodEvent[]; hint?: string };

const WOOD_TIERS = [
  { beat: 950, approach: 1150, hit: 150, perfect: 60, n: 5, fake: 0, delay: 0.1, fast: 0, burst: 0, tell: 0.3, speedVar: 0 },
  { beat: 760, approach: 950, hit: 125, perfect: 48, n: 6, fake: 0.15, delay: 0.2, fast: 0.2, burst: 0, tell: 0.4, speedVar: 0.1 },
  { beat: 620, approach: 820, hit: 105, perfect: 40, n: 7, fake: 0.2, delay: 0.22, fast: 0.25, burst: 0.18, tell: 0.5, speedVar: 0.18 },
  { beat: 500, approach: 700, hit: 90, perfect: 34, n: 8, fake: 0.26, delay: 0.25, fast: 0.3, burst: 0.28, tell: 0.58, speedVar: 0.25 },
];

export function woodRound(seed: number, round: number): WoodRound {
  const tier = tierOf(round);
  const P = WOOD_TIERS[tier];
  const r = mulberry(roundSeed(seed, round, 11));
  const events: WoodEvent[] = [];
  let t = 1400 + P.approach; // lead-in so the first sweep is fully visible
  const n = P.n + Math.floor(r() * 2);
  // Round 2 (still "Early") gently introduces exactly one well-telegraphed fake-out.
  const forcedFake = round === 2 ? 2 + Math.floor(r() * 2) : -1;
  let prevKind = "log" as WoodEvent["kind"];
  for (let i = 0; i < n; i++) {
    let variant: WoodEvent["variant"] = "normal";
    let gap = P.beat;
    const x = r();
    if (i > 0) {
      if (x < P.burst) {
        variant = "burst";
        gap = Math.round(P.beat * 0.5);
      } else if (x < P.burst + P.fast) {
        variant = "fast";
        gap = Math.round(P.beat * 0.7);
      } else if (x < P.burst + P.fast + P.delay) {
        variant = "delayed";
        gap = Math.round(P.beat * (1.45 + r() * 0.35));
      }
    }
    const isFake: boolean = i === forcedFake || (i > 0 && prevKind !== "fake" && variant !== "burst" && r() < P.fake);
    const hit = P.hit;
    // Fairness: windows of neighbouring events never overlap.
    gap = Math.max(gap, hit * 2 + 120);
    if (i > 0) t += gap;
    const speed = 1 + (r() * 2 - 1) * P.speedVar;
    events.push({
      i,
      t,
      kind: isFake ? "fake" : "log",
      variant,
      approachMs: Math.round(P.approach * speed),
      zoneAt: Math.round((0.6 + r() * 0.25) * 100) / 100,
      perfectMs: P.perfect,
      hitMs: hit,
      tellAt: isFake ? Math.round((round === 2 ? 0.3 : P.tell + r() * 0.08) * 100) / 100 : undefined,
    });
    prevKind = isFake ? "fake" : "log";
  }
  if (!events.some((e) => e.kind === "log")) events[0].kind = "log";
  const last = events[events.length - 1];
  return {
    game: "wood",
    round,
    tier,
    durationMs: last.t + last.hitMs + 700,
    events,
    hint: round === 0 ? "Swing when the log lands in the green." : round === 2 ? "Watch the helper: if they pull the log back, don't swing!" : undefined,
  };
}

// ───────────────────────────── STONE charts ─────────────────────────────

export type StoneNote = { t: number; b: number };
export type StoneRound = {
  game: "stone";
  round: number;
  tier: Tier;
  buttons: number;
  beatMs: number;
  /** NPC demonstration, ms from round start. */
  demo: StoneNote[];
  /** When the player's turn begins (after a two-beat count-in). */
  turnStartMs: number;
  /** What the player must reproduce, ms from round start. */
  expected: StoneNote[];
  perfectMs: number;
  hitMs: number;
  durationMs: number;
};

const STONE_TIERS = [
  { buttons: [1, 1, 1], len: [3, 4], beat: 640, half: false, pause: 0.25, hit: 170, perfect: 70 },
  { buttons: [2, 2, 2], len: [4, 5], beat: 560, half: true, pause: 0.25, hit: 145, perfect: 58 },
  { buttons: [2, 3, 3, 3], len: [5, 6], beat: 500, half: true, pause: 0.3, hit: 125, perfect: 48 },
  { buttons: [3, 4, 4], len: [6, 8], beat: 440, half: true, pause: 0.3, hit: 110, perfect: 42 },
];

export const MAX_STONE_BUTTONS = 4;

export function stoneRound(seed: number, round: number): StoneRound {
  const tier = tierOf(round);
  const P = STONE_TIERS[tier];
  const r = mulberry(roundSeed(seed, round, 23));
  const firstOfTier = [0, 3, 6, 10][tier];
  const buttons = Math.min(MAX_STONE_BUTTONS, P.buttons[Math.min(P.buttons.length - 1, round - firstOfTier)]);
  const len = P.len[0] + Math.floor(r() * (P.len[1] - P.len[0] + 1));
  const lead = 900;
  const notes: StoneNote[] = [];
  let pos = 0; // in half-beats
  for (let k = 0; k < len; k++) {
    if (k > 0) {
      let step = 2;
      const x = r();
      if (P.half && x < 0.35) step = 1;
      else if (x > 1 - P.pause) step = 4; // a clear pause
      pos += step;
    }
    let b = Math.floor(r() * buttons);
    // early rounds and the first note: keep it readable (button 1 to start)
    if (k === 0) b = 0;
    notes.push({ t: lead + Math.round((pos * P.beat) / 2), b });
  }
  const span = notes[notes.length - 1].t - notes[0].t;
  const demoEnd = notes[notes.length - 1].t + P.beat;
  const turnStartMs = demoEnd + 2 * P.beat;
  const expected = notes.map((n) => ({ t: turnStartMs + (n.t - notes[0].t), b: n.b }));
  return {
    game: "stone",
    round,
    tier,
    buttons,
    beatMs: P.beat,
    demo: notes,
    turnStartMs,
    expected,
    perfectMs: P.perfect,
    hitMs: P.hit,
    durationMs: turnStartMs + span + P.hit + 900,
  };
}

// ───────────────────────────── judging ─────────────────────────────

export type Judgement = { t: number; result: "perfect" | "hit" | "miss" | "fake_read"; reason?: "early_late" | "missed" | "fake_swing" | "stray" | "wrong_button"; ref: number };

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function sanitise(times: number[], maxMs: number): number[] {
  return times
    .filter((x) => Number.isFinite(x) && x >= 0 && x <= maxMs)
    .map((x) => Math.round(x))
    .sort((a, b) => a - b)
    .slice(0, 64);
}

/**
 * Judges a Wood round. `swings` are ms from round start. Real logs need a swing inside their
 * window; a swing inside a fake-out's window is a Miss; a fake-out with no swing is a "read"
 * (keeps the combo, earns nothing); any other swing is a stray Miss.
 */
export function judgeWood(chart: WoodRound, rawSwings: number[]): { judgements: Judgement[]; offsetMs: number } {
  let swings = sanitise(rawSwings, chart.durationMs + 2000);
  // latency compensation from the swings that are near a real log
  const offs: number[] = [];
  for (const s of swings) {
    const e = chart.events.find((ev) => ev.kind === "log" && Math.abs(s - ev.t) <= ev.hitMs * 1.6);
    if (e) offs.push(s - e.t);
  }
  const offsetMs = offs.length >= 3 ? clamp(Math.round(median(offs)), -RULES.maxOffsetCompMs.wood, RULES.maxOffsetCompMs.wood) : 0;
  swings = swings.map((s) => s - offsetMs);
  const used = new Array(swings.length).fill(false);
  const out: Judgement[] = [];
  for (const e of chart.events) {
    if (e.kind === "log") {
      let best = -1;
      for (let k = 0; k < swings.length; k++) {
        if (used[k]) continue;
        const d = Math.abs(swings[k] - e.t);
        if (d <= e.hitMs && (best < 0 || d < Math.abs(swings[best] - e.t))) best = k;
      }
      if (best >= 0) {
        used[best] = true;
        out.push({ t: e.t, result: Math.abs(swings[best] - e.t) <= e.perfectMs ? "perfect" : "hit", ref: e.i });
      } else out.push({ t: e.t, result: "miss", reason: "missed", ref: e.i });
    }
  }
  for (const e of chart.events) {
    if (e.kind !== "fake") continue;
    const from = e.t - e.approachMs * e.zoneAt * (1 - (e.tellAt ?? 0.5)) - 40;
    const to = e.t + e.hitMs;
    const k = swings.findIndex((s, idx) => !used[idx] && s >= from && s <= to);
    if (k >= 0) {
      used[k] = true;
      out.push({ t: swings[k], result: "miss", reason: "fake_swing", ref: e.i });
    } else out.push({ t: e.t, result: "fake_read", ref: e.i });
  }
  // Stray swings: one Miss per stray (debounced by the client to ≥120 ms apart).
  for (let k = 0; k < swings.length; k++) if (!used[k]) out.push({ t: swings[k], result: "miss", reason: "stray", ref: -1 });
  out.sort((a, b) => a.t - b.t);
  return { judgements: out, offsetMs };
}

/** Judges a Stone round: each expected strike needs the right button inside its timing window. */
export function judgeStone(chart: StoneRound, rawInputs: { t: number; b: number }[]): { judgements: Judgement[]; offsetMs: number } {
  const inputs0 = rawInputs
    .filter((x) => Number.isFinite(x.t) && x.t >= chart.turnStartMs - 600 && x.t <= chart.durationMs + 2000 && Number.isInteger(x.b) && x.b >= 0 && x.b < MAX_STONE_BUTTONS)
    .map((x) => ({ t: Math.round(x.t), b: x.b }))
    .sort((a, b) => a.t - b.t)
    .slice(0, 48);
  const offs: number[] = [];
  for (const x of inputs0) {
    const e = chart.expected.find((ev) => Math.abs(x.t - ev.t) <= chart.hitMs * 1.6);
    if (e) offs.push(x.t - e.t);
  }
  const offsetMs = offs.length >= 2 ? clamp(Math.round(median(offs)), -RULES.maxOffsetCompMs.stone, RULES.maxOffsetCompMs.stone) : 0;
  const inputs = inputs0.map((x) => ({ t: x.t - offsetMs, b: x.b }));
  const used = new Array(inputs.length).fill(false);
  const out: Judgement[] = [];
  chart.expected.forEach((e, i) => {
    let best = -1;
    for (let k = 0; k < inputs.length; k++) {
      if (used[k]) continue;
      const d = Math.abs(inputs[k].t - e.t);
      if (d <= chart.hitMs && (best < 0 || d < Math.abs(inputs[best].t - e.t))) best = k;
    }
    if (best < 0) return void out.push({ t: e.t, result: "miss", reason: "missed", ref: i });
    used[best] = true;
    if (inputs[best].b !== e.b) return void out.push({ t: e.t, result: "miss", reason: "wrong_button", ref: i });
    out.push({ t: e.t, result: Math.abs(inputs[best].t - e.t) <= chart.perfectMs ? "perfect" : "hit", ref: i });
  });
  for (let k = 0; k < inputs.length; k++) if (!used[k] && inputs[k].t >= chart.turnStartMs - chart.hitMs) out.push({ t: inputs[k].t, result: "miss", reason: "stray", ref: -1 });
  out.sort((a, b) => a.t - b.t);
  return { judgements: out, offsetMs };
}

// ───────────────────────────── applying a round ─────────────────────────────

export type SessionState = { hearts: number; combo: number; bestCombo: number; earnedMicro: bigint };
export type Applied = Judgement & { rewardMicro: bigint; combo: number; hearts: number };

/**
 * Applies judgements in time order: Perfect/Hit pay base × quality × combo; Miss costs a heart and
 * resets the combo; a read fake-out keeps the combo and pays nothing. Stops at 0 hearts or when the
 * session budget (cap and the building's remaining need) is used up.
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
    } else if (j.result === "miss") {
      s.hearts -= 1;
      s.combo = 0;
    }
    applied.push({ ...j, rewardMicro: reward, combo: s.combo, hearts: s.hearts });
  }
  if (s.hearts <= 0) stopped = "hearts";
  else if (s.earnedMicro >= budgetMicro) stopped = "cap";
  return { state: s, applied, stopped };
}

/** Anti-automation heuristic: inhumanly consistent timing across a round. */
export function suspiciouslyPrecise(deltas: number[]): boolean {
  if (deltas.length < 8) return false;
  const m = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - m) * (b - m), 0) / deltas.length);
  return sd < 2.5;
}

/** Display helper: µresource → "12.3456". */
export function formatRes(micro: bigint | string, dp = 4): string {
  const v = typeof micro === "string" ? BigInt(micro) : micro;
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / RES_UNIT;
  const frac = (a % RES_UNIT).toString().padStart(6, "0").slice(0, dp).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
