/**
 * Deterministic, infinite, grid-based Hugshire world.
 *
 * The world is a grid of tiles (20×20 cells of 32 px). Each cause owns one tile. Everything about a
 * tile — ground, roads, buildings, trees — is generated from its coordinates and its cause, so the
 * client never downloads world geometry: the server only has to send the list of causes and where
 * they sit. Tiles are generated on demand and cached, which is what lets the world grow without limit.
 */

export const CELL = 32;
export const TILE_CELLS = 20;
export const TILE_PX = CELL * TILE_CELLS; // 640

export type Category = "square" | "animals" | "food" | "health" | "education" | "arts" | "community" | "nature" | "homes";
export type FillerKind = "forest" | "meadow" | "lake" | "hills" | "grove";
export type TileKind = Category | FillerKind | "expansion";

export type WorldCause = {
  id: string;
  name: string;
  subtitle: string;
  org: string;
  category: Category;
  tx: number;
  ty: number;
  /** 0 abandoned … 5 thriving (from real yield delivered) */
  stage: number;
  helpers: number;
  deliveredUsd: number;
};

/** Ground codes, baked into one texture per tile. */
export const G = { GRASS: 0, ROAD: 1, WATER: 2, SOIL: 3, PLAZA: 4, SAND: 5, DIRT: 6, PLANK: 7 } as const;

export type PropKind =
  | "tree" | "pine" | "blossom" | "bush" | "rock" | "rockBig" | "stump" | "mushroom" | "reeds" | "flowers"
  | "townHall" | "barn" | "house" | "clinic" | "school" | "bookshop" | "studio" | "greenhouse" | "windmill"
  | "stall" | "tent" | "lighthouse" | "gazebo" | "cottage" | "foundation" | "ruin" | "signNew" | "signCause"
  | "fountain" | "lamp" | "bench" | "fenceH" | "fenceV" | "hay" | "scarecrow" | "easel" | "boxes" | "well" | "flag" | "kennel";

/** Flat decorations baked into the ground texture (no sprite, no sorting cost). */
export type Decal = { k: "crops" | "picnic" | "lily" | "petals" | "dash" | "plusPad"; x: number; y: number; v: number };

export type Prop = { k: PropKind; x: number; y: number; v: number; s: number };

export type TileData = {
  tx: number;
  ty: number;
  kind: TileKind;
  cause: WorldCause | null;
  ground: Uint8Array; // TILE_CELLS²
  blocked: Uint8Array;
  props: Prop[]; // world px, anchor bottom-centre, sorted by y
  decals: Decal[];
  /** Walkable point in front of the cause's main building (world px). */
  hall: { x: number; y: number } | null;
  /** Paddock bounds for wandering sheep (world px). */
  paddock: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Streets touching this tile: top/left run inside it; bottom/right run inside the next tile. */
  edges: { top: boolean; left: boolean; bottom: boolean; right: boolean };
};

// ───────────────────────────── hashing ─────────────────────────────

export function hash2(x: number, y: number, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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

export const key = (tx: number, ty: number) => `${tx},${ty}`;

/** Spiral of tile coordinates around (0,0): 0,0 → 1,0 → 1,1 → 0,1 → … */
export function spiral(n: number): { x: number; y: number }[] {
  const out = [{ x: 0, y: 0 }];
  let x = 0, y = 0, dx = 1, dy = 0, len = 1;
  while (out.length < n) {
    for (let r = 0; r < 2 && out.length < n; r++) {
      for (let i = 0; i < len && out.length < n; i++) {
        x += dx;
        y += dy;
        out.push({ x, y });
      }
      [dx, dy] = [-dy, dx];
    }
    len++;
  }
  return out;
}

/** Where the n-th cause goes: spiral order, with natural filler tiles interleaved so towns breathe. */
export function causeSlots(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of spiral(n * 3 + 9)) {
    if (out.length >= n) break;
    const isCenter = p.x === 0 && p.y === 0;
    if (isCenter || hash2(p.x, p.y, 7) > 0.27) out.push(p);
  }
  return out;
}

// ───────────────────────────── world index ─────────────────────────────

export class World {
  private byTile = new Map<string, WorldCause>();
  private cache = new Map<string, TileData>();
  readonly causes: WorldCause[];
  readonly bounds: { x0: number; y0: number; x1: number; y1: number };

  constructor(causes: WorldCause[], private cacheSize = 160) {
    this.causes = causes;
    for (const c of causes) this.byTile.set(key(c.tx, c.ty), c);
    const xs = causes.map((c) => c.tx), ys = causes.map((c) => c.ty);
    this.bounds = { x0: Math.min(0, ...xs) - 2, y0: Math.min(0, ...ys) - 2, x1: Math.max(0, ...xs) + 2, y1: Math.max(0, ...ys) + 2 };
  }

  causeAt(tx: number, ty: number) {
    return this.byTile.get(key(tx, ty)) ?? null;
  }

  /** Empty plots next to towns, ready for a new cause. */
  isExpansion(tx: number, ty: number) {
    if (this.causeAt(tx, ty)) return false;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.causeAt(tx + dx, ty + dy));
    return near && hash2(tx, ty, 3) < 0.45;
  }

  isCivilized(tx: number, ty: number) {
    return !!this.causeAt(tx, ty) || this.isExpansion(tx, ty);
  }

  kindAt(tx: number, ty: number): TileKind {
    const c = this.causeAt(tx, ty);
    if (c) return c.category;
    if (this.isExpansion(tx, ty)) return "expansion";
    const h = hash2(tx, ty, 11);
    return h < 0.3 ? "forest" : h < 0.55 ? "meadow" : h < 0.7 ? "lake" : h < 0.85 ? "grove" : "hills";
  }

  /** Generates (or returns the cached) tile. LRU-bounded so memory stays flat while exploring. */
  tile(tx: number, ty: number): TileData {
    const k = key(tx, ty);
    const hit = this.cache.get(k);
    if (hit) {
      this.cache.delete(k);
      this.cache.set(k, hit);
      return hit;
    }
    const t = generateTile(this, tx, ty);
    this.cache.set(k, t);
    if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    return t;
  }

  /** Walkability of a world cell (used by pathfinding). */
  walkable(cx: number, cy: number) {
    const tx = Math.floor(cx / TILE_CELLS), ty = Math.floor(cy / TILE_CELLS);
    const t = this.tile(tx, ty);
    const lx = cx - tx * TILE_CELLS, ly = cy - ty * TILE_CELLS;
    return t.blocked[ly * TILE_CELLS + lx] === 0;
  }

  /** Whether a world cell is road (vehicles drive on these). */
  isRoad(cx: number, cy: number) {
    const tx = Math.floor(cx / TILE_CELLS), ty = Math.floor(cy / TILE_CELLS);
    const t = this.tile(tx, ty);
    return t.ground[(cy - ty * TILE_CELLS) * TILE_CELLS + (cx - tx * TILE_CELLS)] === G.ROAD;
  }
}

// ───────────────────────────── tile builder ─────────────────────────────

class Builder {
  ground = new Uint8Array(TILE_CELLS * TILE_CELLS);
  blocked = new Uint8Array(TILE_CELLS * TILE_CELLS);
  props: Prop[] = [];
  decals: Decal[] = [];
  hall: { x: number; y: number } | null = null;
  paddock: TileData["paddock"] = null;
  ox: number;
  oy: number;
  constructor(public tx: number, public ty: number, public r: () => number) {
    this.ox = tx * TILE_PX;
    this.oy = ty * TILE_PX;
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < TILE_CELLS && y < TILE_CELLS;
  }
  setG(x: number, y: number, g: number) {
    if (this.inside(x, y)) this.ground[y * TILE_CELLS + x] = g;
  }
  getG(x: number, y: number) {
    return this.inside(x, y) ? this.ground[y * TILE_CELLS + x] : -1;
  }
  block(x: number, y: number, w = 1, h = 1) {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (this.inside(x + i, y + j)) this.blocked[(y + j) * TILE_CELLS + x + i] = 1;
  }
  free(x: number, y: number, w = 1, h = 1) {
    for (let i = 0; i < w; i++)
      for (let j = 0; j < h; j++) {
        if (!this.inside(x + i, y + j)) return false;
        const k = (y + j) * TILE_CELLS + x + i;
        if (this.blocked[k] || this.ground[k] === G.ROAD || this.ground[k] === G.WATER || this.ground[k] === G.PLANK) return false;
      }
    return true;
  }
  rect(x: number, y: number, w: number, h: number, g: number) {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) this.setG(x + i, y + j, g);
  }
  /** Prop anchored at the bottom-centre of a w×h cell footprint; solid footprints block movement. */
  put(k: PropKind, x: number, y: number, w = 1, h = 1, solid = true, v = 0, s = 1) {
    this.props.push({ k, x: this.ox + (x + w / 2) * CELL, y: this.oy + (y + h) * CELL, v, s });
    if (solid) this.block(x, y, w, h);
  }
  /** Small prop at the centre of a cell. */
  dot(k: PropKind, x: number, y: number, solid = false, v = Math.floor(this.r() * 4), s = 0.85 + this.r() * 0.3) {
    this.props.push({ k, x: this.ox + (x + 0.5) * CELL + (this.r() - 0.5) * 10, y: this.oy + (y + 0.85) * CELL, v, s });
    if (solid) this.block(x, y);
  }
  decal(k: Decal["k"], x: number, y: number, v = 0) {
    this.decals.push({ k, x: this.ox + x * CELL, y: this.oy + y * CELL, v });
  }
  /** Path of plaza/dirt cells from (x,y) up to the road at the top. */
  pathUp(x: number, yFrom: number, g: number = G.PLAZA) {
    for (let y = yFrom; y >= 2; y--) if (this.getG(x, y) === G.GRASS) this.setG(x, y, g);
  }
  scatter(kinds: PropKind[], n: number, solidTrees = true, area = { x0: 2, y0: 2, x1: 19, y1: 19 }) {
    for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      const x = area.x0 + Math.floor(this.r() * (area.x1 - area.x0 + 1));
      const y = area.y0 + Math.floor(this.r() * (area.y1 - area.y0 + 1));
      if (!this.free(x, y)) continue;
      const kind = kinds[Math.floor(this.r() * kinds.length)];
      const tall = kind === "tree" || kind === "pine" || kind === "blossom" || kind === "rockBig";
      this.dot(kind, x, y, solidTrees && tall);
      k++;
    }
  }
  /** Building that turns into foundations/ruins while the cause is young. */
  building(k: PropKind, x: number, y: number, w: number, h: number, stage: number, minStage: number, v = 0) {
    if (stage >= minStage) this.put(k, x, y, w, h, true, v);
    else this.put(stage >= 1 ? "foundation" : "ruin", x, y, w, h, true, v);
  }
}

function roads(b: Builder, world: World) {
  const { tx, ty } = b;
  const civ = world.isCivilized(tx, ty);
  const top = civ || world.isCivilized(tx, ty - 1);
  const left = civ || world.isCivilized(tx - 1, ty);
  if (top) b.rect(0, 0, TILE_CELLS, 2, G.ROAD);
  if (left) b.rect(0, 0, 2, TILE_CELLS, G.ROAD);
  // corner piece so roads always join
  if (!top && !left && (world.isCivilized(tx - 1, ty - 1) || (world.isCivilized(tx, ty - 1) && world.isCivilized(tx - 1, ty)))) b.rect(0, 0, 2, 2, G.ROAD);
  return { top, left, bottom: civ || world.isCivilized(tx, ty + 1), right: civ || world.isCivilized(tx + 1, ty) };
}

/** Street lamps and planters along the sidewalks of town tiles. */
function streetFurniture(b: Builder, e: { top: boolean; left: boolean }) {
  if (e.top)
    for (const x of [5, 11, 17])
      if (b.free(x, 2) && b.free(x + 1, 2)) b.props.push({ k: "lamp", x: b.ox + x * CELL + 6, y: b.oy + 2 * CELL + 20, v: 0, s: 1 });
  if (e.left)
    for (const y of [6, 12, 18])
      if (b.free(2, y)) b.props.push({ k: "lamp", x: b.ox + 2 * CELL + 10, y: b.oy + y * CELL + 6, v: 0, s: 1 });
  if (e.top)
    for (const x of [8, 14])
      if (b.free(x, 2)) b.props.push({ k: "bush", x: b.ox + x * CELL + 16, y: b.oy + 2 * CELL + 22, v: 1, s: 0.75 });
}

export function generateTile(world: World, tx: number, ty: number): TileData {
  const cause = world.causeAt(tx, ty);
  const kind = world.kindAt(tx, ty);
  const b = new Builder(tx, ty, rng(Math.floor(hash2(tx, ty, 99) * 2 ** 31)));
  const edges = roads(b, world);
  const stage = cause?.stage ?? 0;

  switch (kind) {
    case "square": square(b); break;
    case "animals": animals(b, stage); break;
    case "food": food(b, stage); break;
    case "health": health(b, stage); break;
    case "education": education(b, stage); break;
    case "arts": arts(b, stage); break;
    case "community": community(b, stage); break;
    case "nature": park(b, stage); break;
    case "homes": homes(b, stage); break;
    case "expansion": expansion(b); break;
    case "forest": b.scatter(["tree", "pine", "pine", "tree", "mushroom", "bush"], 70); break;
    case "meadow": b.scatter(["flowers", "flowers", "bush", "tree", "rock"], 34); break;
    case "grove": b.scatter(["blossom", "blossom", "tree", "flowers", "bush"], 40); break;
    case "hills": b.scatter(["rockBig", "rock", "pine", "pine", "bush"], 40); break;
    case "lake": lake(b); break;
  }

  // Young causes: abandoned plots are rough and overgrown.
  if (cause && stage <= 1) b.scatter(["rock", "stump", "bush", "rock"], stage === 0 ? 16 : 8, false);
  // A little life on every civilised tile
  if (cause && stage >= 2) b.scatter(["flowers", "bush"], 4 + stage * 2, false);

  if (cause) streetFurniture(b, edges);
  b.props.sort((p, q) => p.y - q.y);
  return { tx, ty, kind, cause, ground: b.ground, blocked: b.blocked, props: b.props, decals: b.decals, hall: b.hall, paddock: b.paddock, edges };
}

// ───────────────────────────── district layouts ─────────────────────────────
// Interior is cells 2..19 (roads occupy rows/cols 0-1). Main building near the top, door faces down.

function mainHall(b: Builder, k: PropKind, x: number, y: number, w: number, h: number, stage: number) {
  if (stage >= 1 || k === "townHall") b.put(k, x, y, w, h, true, 0);
  else {
    // abandoned: the old building is a ruin, with the cause sign out front
    b.put("ruin", x, y, w, h - 1, true, 0);
    b.put("signCause", x + Math.floor(w / 2) + 1, y + h - 1, 1, 1, true);
  }
  const doorX = x + Math.floor(w / 2);
  b.hall = { x: b.ox + (doorX + 0.5) * CELL, y: b.oy + (y + h + 0.9) * CELL };
  b.rect(doorX - 1, y + h, 3, 2, G.PLAZA);
  // footpath from the door to the road on the tile's left edge
  for (let px = 2; px < doorX; px++) if (b.getG(px, y + h + 1) === G.GRASS) b.setG(px, y + h + 1, G.PLAZA);
}

function square(b: Builder) {
  b.rect(4, 8, 14, 9, G.PLAZA);
  b.rect(10, 2, 3, 6, G.PLAZA);
  mainHall(b, "townHall", 7, 2, 8, 5, 5);
  b.put("fountain", 9, 10, 4, 4, true);
  for (const [x, y] of [[4, 8], [17, 8], [4, 16], [17, 16]]) b.put("lamp", x, y, 1, 1, true);
  b.put("stall", 5, 11, 2, 2, true, 0);
  b.put("stall", 16, 11, 2, 2, true, 1);
  b.put("stall", 6, 14, 2, 2, true, 2);
  b.put("bench", 14, 15, 2, 1, true);
  b.put("flag", 15, 2, 1, 1, true);
  b.put("bookshop", 2, 3, 4, 4, true);
  b.put("house", 16, 3, 3, 3, true, 1);
  b.scatter(["blossom", "tree", "bush"], 10, true, { x0: 2, y0: 17, x1: 19, y1: 19 });
  b.scatter(["flowers"], 8, false);
}

function animals(b: Builder, s: number) {
  mainHall(b, "barn", 6, 2, 6, 5, s);
  b.building("kennel", 14, 4, 2, 2, s, 2);
  b.building("kennel", 16, 4, 2, 2, s, 3, 1);
  // paddock with fences
  const x0 = 3, y0 = 11, x1 = 17, y1 = 18;
  if (s >= 2) {
    for (let x = x0; x <= x1; x++) {
      b.put("fenceH", x, y0, 1, 1, true);
      b.put("fenceH", x, y1, 1, 1, true);
    }
    for (let y = y0 + 1; y < y1; y++) {
      b.put("fenceV", x0, y, 1, 1, true);
      b.put("fenceV", x1, y, 1, 1, true);
    }
    b.paddock = { x0: b.ox + (x0 + 1.2) * CELL, y0: b.oy + (y0 + 1.4) * CELL, x1: b.ox + (x1 - 0.2) * CELL, y1: b.oy + (y1 - 0.1) * CELL };
    b.put("hay", 5, 13, 1, 1, true);
    b.put("hay", 14, 16, 1, 1, true);
  }
  b.scatter(["tree", "bush", "flowers"], 8, true, { x0: 2, y0: 2, x1: 5, y1: 10 });
  b.scatter(["tree", "flowers"], 6, true, { x0: 18, y0: 2, x1: 19, y1: 19 });
}

function food(b: Builder, s: number) {
  mainHall(b, "greenhouse", 3, 2, 6, 4, s);
  b.building("windmill", 13, 2, 4, 6, s, 2);
  // crop rows
  for (let y = 10; y <= 17; y += 2) {
    b.rect(3, y, 14, 1, G.SOIL);
    if (s >= 2) for (let x = 3; x < 17; x++) b.decal("crops", x, y, (x + y) % 3);
  }
  if (s >= 3) b.put("scarecrow", 10, 13, 1, 1, true);
  b.put("hay", 18, 9, 1, 1, true);
  b.scatter(["tree", "bush"], 6, true, { x0: 18, y0: 10, x1: 19, y1: 19 });
}

function health(b: Builder, s: number) {
  mainHall(b, "clinic", 6, 2, 6, 5, s);
  // pond + gazebo
  b.rect(4, 12, 6, 4, G.WATER);
  b.rect(5, 11, 4, 1, G.WATER);
  b.block(4, 11, 6, 5);
  b.decal("lily", 6, 13, 0);
  b.decal("lily", 8, 14, 1);
  b.building("gazebo", 13, 11, 4, 4, s, 2);
  b.put("bench", 12, 16, 2, 1, true);
  b.scatter(["blossom", "blossom", "flowers"], 12, true, { x0: 2, y0: 8, x1: 19, y1: 19 });
}

function education(b: Builder, s: number) {
  mainHall(b, "school", 5, 2, 8, 5, s);
  b.building("bookshop", 14, 3, 4, 4, s, 2);
  b.rect(4, 11, 12, 6, G.PLAZA);
  b.put("bench", 5, 12, 2, 1, true);
  b.put("bench", 12, 12, 2, 1, true);
  if (s >= 3) b.put("flag", 9, 13, 1, 1, true);
  b.decal("picnic", 6, 15, 0);
  b.scatter(["tree", "blossom", "bush"], 10, true, { x0: 2, y0: 17, x1: 19, y1: 19 });
}

function arts(b: Builder, s: number) {
  mainHall(b, "studio", 6, 2, 6, 5, s);
  for (const [x, y] of [[4, 11], [8, 12], [13, 11], [16, 13]]) if (s >= 2) b.put("easel", x, y, 1, 1, true);
  b.decal("picnic", 10, 15, 1);
  b.scatter(["flowers", "flowers", "blossom", "bush"], 18, true, { x0: 2, y0: 9, x1: 19, y1: 19 });
}

function community(b: Builder, s: number) {
  // harbour: water along the bottom with a dock
  // harbour: a rounded bay inside the tile, with a dock
  b.rect(3, 15, 16, 4, G.WATER);
  b.rect(4, 14, 14, 1, G.SAND);
  b.block(3, 15, 16, 4);
  for (let y = 14; y <= 17; y++) {
    b.setG(9, y, G.PLANK);
    b.setG(10, y, G.PLANK);
    b.blocked[y * TILE_CELLS + 9] = 0;
    b.blocked[y * TILE_CELLS + 10] = 0;
  }
  mainHall(b, "tent", 7, 3, 6, 4, s);
  b.building("lighthouse", 16, 9, 2, 5, s, 3);
  b.put("boxes", 4, 11, 1, 1, true);
  b.put("boxes", 13, 12, 1, 1, true, 1);
  b.building("stall", 3, 7, 2, 2, s, 2, 1);
  b.scatter(["tree", "bush"], 5, true, { x0: 2, y0: 8, x1: 6, y1: 13 });
}

function park(b: Builder, s: number) {
  mainHall(b, "gazebo", 8, 2, 4, 4, s);
  b.rect(5, 10, 9, 5, G.WATER);
  b.rect(6, 9, 6, 1, G.WATER);
  b.block(5, 9, 9, 6);
  b.decal("lily", 7, 11, 0);
  b.decal("lily", 11, 12, 1);
  b.put("bench", 15, 9, 2, 1, true);
  b.decal("picnic", 15, 15, 1);
  b.scatter(["tree", "tree", "blossom", "pine", "flowers", "bush"], 26, true);
}

function homes(b: Builder, s: number) {
  mainHall(b, "cottage", 7, 2, 5, 4, s);
  const spots = [[3, 9], [9, 9], [15, 9], [3, 14], [9, 14], [15, 14]];
  spots.forEach(([x, y], i) => b.building("house", x, y, 3, 3, s, 1 + Math.floor(i / 2), i % 4));
  b.scatter(["tree", "flowers", "bush"], 10, true);
}

function expansion(b: Builder) {
  b.rect(3, 3, 15, 15, G.DIRT); // drawn as a soft, lighter lawn with a dashed plot outline
  b.decal("dash", 3, 3, 0);
  b.put("signNew", 10, 9, 1, 1, true);
  b.scatter(["rock", "stump", "bush"], 8, false, { x0: 3, y0: 3, x1: 17, y1: 17 });
}

function lake(b: Builder) {
  const r = b.r;
  const cx = 10 + Math.floor(r() * 3) - 1, cy = 10 + Math.floor(r() * 3) - 1;
  for (let x = 2; x < TILE_CELLS; x++)
    for (let y = 2; y < TILE_CELLS; y++) {
      const d = Math.hypot((x - cx) / 6.5, (y - cy) / 5);
      if (d < 1) {
        b.setG(x, y, G.WATER);
        b.block(x, y);
      } else if (d < 1.18) b.setG(x, y, G.SAND);
    }
  b.decal("lily", cx - 2, cy, 0);
  b.decal("lily", cx + 2, cy + 1, 1);
  b.scatter(["reeds", "tree", "pine", "flowers", "bush"], 22, true);
}
