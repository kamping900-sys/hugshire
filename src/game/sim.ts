/**
 * Pure game logic (no PixiJS, no DOM) so it can be unit tested.
 * Nothing here can create or change money: parcels are a *view* of the server's eligible yield.
 */
import type { AnimalKind } from "@/lib/animals";

export const TILE = 32;
export const COLS = 26;
export const ROWS = 18;
export const CITY_W = COLS * TILE;
export const CITY_H = ROWS * TILE;

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MapType = "school" | "shelter" | "nature" | "care" | "food" | "rebuild";
export type PropKind =
  | "tree"
  | "pine"
  | "rock"
  | "ruin"
  | "stump"
  | "foundation"
  | "house"
  | "landmark"
  | "hall"
  | "hall_ruin"
  | "depot"
  | "garden"
  | "lamp"
  | "flower"
  | "well"
  | "fence"
  | "bench"
  | "banner";

export type Prop = { kind: PropKind; x: number; y: number; variant: number };
export type WorkSite = { x: number; y: number; kind: "chop" | "mine" | "build" | "tidy" };

export type CityLayout = {
  stage: number;
  mapType: MapType;
  paths: { x: number; y: number }[];
  water: { x: number; y: number }[];
  props: Prop[];
  depot: { x: number; y: number };
  hall: { x: number; y: number };
  workSites: WorkSite[];
};

/** Eight build plots around a central plaza (tile coords, top-left of a 3×2 footprint). */
const PLOTS = [
  { x: 4, y: 3 },
  { x: 9, y: 3 },
  { x: 16, y: 3 },
  { x: 20, y: 3 },
  { x: 4, y: 12 },
  { x: 9, y: 12 },
  { x: 16, y: 12 },
  { x: 20, y: 12 },
];

/**
 * Builds a deterministic city for (seed, stage). Stage 0 = abandoned … 5 = thriving.
 * Same inputs always give the same layout, so every visitor sees the same town.
 */
export function buildCityLayout(seed: number, mapType: MapType, stage: number): CityLayout {
  const r = rng(seed);
  const s = Math.max(0, Math.min(5, stage));
  const props: Prop[] = [];
  const paths: { x: number; y: number }[] = [];
  const water: { x: number; y: number }[] = [];
  const occupied = new Set<string>();
  const occ = (x: number, y: number, w = 1, h = 1) => {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) occupied.add(`${x + i},${y + j}`);
  };

  // a little stream along the bottom-right corner
  for (let x = 17; x < COLS; x++) {
    const y = ROWS - 2 + (x % 3 === 0 ? -1 : 0);
    water.push({ x, y });
    water.push({ x, y: y + 1 });
    occ(x, y, 1, 2);
  }

  // roads: main street + cross street; abandoned towns have broken roads
  const keepPath = (x: number, y: number) => s >= 2 || r() < (s === 0 ? 0.35 : 0.7) || (x === 13 && y === 8);
  for (let x = 1; x < COLS - 1; x++) for (const y of [8, 9]) if (keepPath(x, y)) paths.push({ x, y });
  for (let y = 1; y < ROWS - 3; y++) for (const x of [13, 14]) if (keepPath(x, y)) paths.push({ x, y });
  for (const p of paths) occ(p.x, p.y);

  const hall = { x: 13.5 * TILE + TILE / 2, y: 6 * TILE };
  const depot = { x: 3 * TILE, y: 9.6 * TILE };
  occ(12, 4, 4, 3);
  occ(1, 9, 3, 2);
  props.push({ kind: s >= 3 ? "hall" : "hall_ruin", x: 14 * TILE, y: 6.6 * TILE, variant: 0 });
  props.push({ kind: "depot", x: depot.x, y: depot.y, variant: 0 });

  const builtCount = [0, 0, 0, 3, 6, 8][s];
  PLOTS.forEach((p, i) => {
    occ(p.x, p.y, 3, 3);
    const cx = (p.x + 1.5) * TILE;
    const cy = (p.y + 2.2) * TILE;
    if (i < builtCount) {
      props.push({ kind: i === 0 ? "landmark" : "house", x: cx, y: cy, variant: Math.floor(r() * 4) });
      if (s >= 4) props.push({ kind: "garden", x: cx + 40, y: cy + 8, variant: Math.floor(r() * 3) });
    } else if (s >= 2) {
      props.push({ kind: "foundation", x: cx, y: cy, variant: 0 });
    } else if (s === 1) {
      props.push({ kind: r() < 0.5 ? "stump" : "rock", x: cx, y: cy - 6, variant: 0 });
    } else {
      props.push({ kind: r() < 0.5 ? "ruin" : r() < 0.5 ? "rock" : "tree", x: cx, y: cy, variant: Math.floor(r() * 3) });
    }
  });

  // wild scenery: dense when abandoned, tidy when thriving
  const wild = [70, 48, 34, 26, 22, 20][s];
  for (let k = 0, tries = 0; k < wild && tries < 800; tries++) {
    const x = 1 + Math.floor(r() * (COLS - 2));
    const y = 1 + Math.floor(r() * (ROWS - 2));
    if (occupied.has(`${x},${y}`)) continue;
    occ(x, y);
    const roll = r();
    const nearCenter = Math.abs(x - 13.5) < 7 && Math.abs(y - 8.5) < 5;
    let kind: PropKind;
    if (s <= 1 && nearCenter) kind = roll < 0.4 ? "rock" : roll < 0.7 ? "tree" : s === 0 ? "ruin" : "stump";
    else kind = roll < 0.55 ? "tree" : roll < 0.75 ? "pine" : roll < 0.9 ? (s >= 3 ? "flower" : "rock") : s >= 4 ? "flower" : "rock";
    props.push({ kind, x: (x + 0.5) * TILE, y: (y + 0.9) * TILE, variant: Math.floor(r() * 3) });
    k++;
  }

  if (s >= 4) {
    for (const x of [6, 11, 17, 22]) props.push({ kind: "lamp", x: x * TILE, y: 7.7 * TILE, variant: 0 });
    props.push({ kind: "bench", x: 11 * TILE, y: 10.9 * TILE, variant: 0 });
  }
  if (s >= 5) {
    props.push({ kind: "well", x: 17 * TILE, y: 10.8 * TILE, variant: 0 });
    for (const x of [12, 16]) props.push({ kind: "banner", x: x * TILE, y: 4.4 * TILE, variant: 0 });
    for (let x = 2; x < 8; x++) props.push({ kind: "fence", x: x * TILE, y: 16.4 * TILE, variant: 0 });
  }

  const workSites: WorkSite[] = props
    .filter((p) => ["tree", "pine", "rock", "ruin", "stump", "foundation"].includes(p.kind))
    .map((p) => ({
      x: p.x + (r() < 0.5 ? -18 : 18),
      y: p.y + 4,
      kind: p.kind === "rock" ? ("mine" as const) : p.kind === "foundation" ? ("build" as const) : p.kind === "ruin" || p.kind === "stump" ? ("tidy" as const) : ("chop" as const),
    }))
    .filter((w) => w.x > 16 && w.x < CITY_W - 16 && w.y > 16 && w.y < CITY_H - 16);

  props.sort((a, b) => a.y - b.y);
  return { stage: s, mapType, paths, water, props, depot, hall, workSites };
}

// ───────────────────────────── helper agents ─────────────────────────────

export type AgentState = "idle" | "walk" | "work" | "carry";
export type Agent = {
  id: string;
  animal: AnimalKind;
  nickname: string;
  mine: boolean;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: AgentState;
  site: WorkSite | null;
  timer: number;
  carrying: number; // parcels carried (purely visual)
  facing: 1 | -1;
  /** true while the player steers this helper */
  controlled: boolean;
};

export const SPEED = 70; // px/s
const WORK_SECONDS = 3.2;

export function makeAgent(a: { id: string; animal: AnimalKind; nickname: string; mine: boolean }, layout: CityLayout, seed: number): Agent {
  const r = rng(seed);
  return {
    ...a,
    x: layout.depot.x + 30 + r() * 120,
    y: layout.depot.y - 20 + r() * 60,
    tx: 0,
    ty: 0,
    state: "idle",
    site: null,
    timer: r() * 1.5,
    carrying: 0,
    facing: 1,
    controlled: false,
  };
}

/** Advances one helper by dt seconds. Autonomous helpers loop: work site → work → carry to depot. */
export function stepAgent(a: Agent, dt: number, layout: CityLayout, pick: () => number): Agent {
  const moveToward = () => {
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const st = Math.min(d, SPEED * dt);
    a.x += (dx / d) * st;
    a.y += (dy / d) * st;
    if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
    return false;
  };

  if (a.controlled) {
    if (a.state === "walk" || a.state === "carry") {
      if (moveToward()) a.state = a.carrying > 0 ? "carry" : "idle";
    }
    return a;
  }

  switch (a.state) {
    case "idle":
      a.timer -= dt;
      if (a.timer <= 0) {
        const sites = layout.workSites;
        a.site = sites.length ? sites[Math.floor(pick() * sites.length)] : null;
        if (a.site) {
          a.tx = a.site.x;
          a.ty = a.site.y;
          a.state = "walk";
        } else {
          a.tx = layout.depot.x + 40 + pick() * 200;
          a.ty = layout.depot.y + (pick() - 0.5) * 80;
          a.state = "walk";
        }
      }
      break;
    case "walk":
      if (moveToward()) {
        if (a.site) {
          a.state = "work";
          a.timer = WORK_SECONDS;
        } else {
          a.state = "idle";
          a.timer = 1 + pick() * 2;
        }
      }
      break;
    case "work":
      a.timer -= dt;
      if (a.timer <= 0) {
        a.state = "carry";
        a.carrying = 1;
        a.tx = layout.depot.x + 12;
        a.ty = layout.depot.y + 10;
      }
      break;
    case "carry":
      if (moveToward()) {
        a.carrying = 0;
        a.site = null;
        a.state = "idle";
        a.timer = 0.6 + pick() * 1.8;
      }
      break;
  }
  return a;
}

export function commandMove(a: Agent, x: number, y: number) {
  a.controlled = true;
  a.tx = Math.max(12, Math.min(CITY_W - 12, x));
  a.ty = Math.max(20, Math.min(CITY_H - 12, y));
  a.state = a.carrying > 0 ? "carry" : "walk";
  a.site = null;
}

export const near = (a: { x: number; y: number }, b: { x: number; y: number }, r = 36) => Math.hypot(a.x - b.x, a.y - b.y) <= r;

// ───────────────────────────── rendering budget ─────────────────────────────

export type HelperRow = { id: string; animal: AnimalKind; nickname: string; mine: boolean };

/**
 * Chooses which helpers to draw. All supporters exist in the database; only `cap` are animated.
 * The viewer's own helpers always come first; the rest rotate over time so everyone gets seen.
 */
export function selectVisibleHelpers(all: HelperRow[], cap: number, rotation: number): HelperRow[] {
  const mine = all.filter((h) => h.mine);
  const others = all.filter((h) => !h.mine);
  const room = Math.max(0, cap - mine.length);
  if (others.length <= room) return [...mine.slice(0, cap), ...others];
  const start = ((rotation % others.length) + others.length) % others.length;
  const rotated = [...others.slice(start), ...others.slice(0, start)];
  return [...mine.slice(0, cap), ...rotated.slice(0, room)];
}

/** Adaptive quality: halve the helper cap when frames are slow, recover slowly when fast. */
export function adaptCap(current: number, fps: number, max: number, min = 4) {
  if (fps < 40) return Math.max(min, Math.floor(current / 2));
  if (fps > 55 && current < max) return Math.min(max, current + 2);
  return current;
}

/** Heart parcels shown at the depot: a picture of eligible yield, capped for the screen. */
export function parcelCount(eligibleMicro: bigint, parcelSizeMicro: bigint, maxShown = 24) {
  if (parcelSizeMicro <= 0n) return 0;
  const n = eligibleMicro / parcelSizeMicro;
  return Number(n > BigInt(maxShown) ? BigInt(maxShown) : n);
}
