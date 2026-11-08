/**
 * Hugshire world engine (PixiJS v8).
 *
 * Scale strategy (why a world with thousands of causes stays smooth):
 *  - Tiles are generated deterministically from coordinates (gen.ts) — nothing to download.
 *  - Only tiles around the camera exist on the GPU. Each tile's ground is baked to ONE texture;
 *    tall props are pooled sprites in a single y-sorted layer. Far tiles are destroyed.
 *  - Building is time-sliced: at most a few tiles are baked per frame, nearest first.
 *  - Two levels of detail: zoomed in = full tiles + characters; zoomed out (map view) = one small
 *    baked thumbnail per tile, no characters, so hundreds of tiles cost a few hundred sprites.
 *  - Characters are spawned only for active tiles and capped; all supporters still exist in data.
 *  - Pathfinding is bounded A* with a per-frame budget. The HUD is updated at 4 Hz, not per frame.
 *  - The ticker stops while the tab is hidden.
 */
import { Application, ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import { CELL, TILE_CELLS, TILE_PX, World, hash2, key, rng, type WorldCause } from "./gen";
import { MASCOTS, type Mascot } from "./mascots";
import { findPath, simplify, type Cell } from "./path";
import { WorldTextures, drawTileGround, type Baked } from "./worldArt";

export type MyWorker = { id: string; mascot: Mascot; name: string; homeCauseId: string };

export type HudState = {
  fps: number;
  zoom: number;
  overview: boolean;
  tiles: number;
  sprites: number;
  simulated: number;
  player: { x: number; y: number; tx: number; ty: number };
  mode: "manual" | "auto";
  clock: number; // minutes of day 0..1439
  day: number;
};

export type WorldEvents = {
  onHud: (h: HudState) => void;
  onNear: (c: WorldCause | null) => void;
  onSelect: (c: WorldCause) => void;
  onArrive: (c: WorldCause) => void;
  onAutoDeliver: (workerId: string, c: WorldCause) => void;
};

type Ent = {
  id: string;
  kind: "helper" | "sheep" | "truck" | "mine";
  mascot: Mascot;
  x: number;
  y: number;
  path: Cell[];
  pathAt: number;
  state: "idle" | "walk";
  timer: number;
  speed: number;
  facing: 1 | -1;
  back: boolean;
  side?: boolean;
  tileKey: string;
  homeTx: number;
  homeTy: number;
  carry: number;
  spr: Sprite | null;
  load: Sprite[];
  tag: Container | null;
  vx?: number;
  onDone?: () => void;
  target?: string; // cause id it is walking to (player / my workers)
  bounds?: { x0: number; y0: number; x1: number; y1: number };
};

type TileView = { k: string; tx: number; ty: number; ground: Sprite | null; props: Sprite[]; ents: Ent[]; truckIn: number };

const LOD_ZOOM = 0.42;
const walkingNow = (e: { state: string }) => e.state === "walk";
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 1.8;
const PLAYER_SPEED = 150;
const AUTO_AFTER_S = 45; // demo: idle → auto (production default is 1 hour)

const CAT_COLOR: Record<string, string> = {
  square: "#F58A3C", animals: "#E46F3E", food: "#7FB86F", health: "#E98C9A", education: "#5E8FD9",
  arts: "#9C7BC9", community: "#3FA3B5", nature: "#5BA37A", homes: "#C98A4B",
};

export class WorldGame {
  private app = new Application();
  private tex!: WorldTextures;
  readonly world: World;
  private cam = new Container();
  private thumbLayer = new Container();
  private groundLayer = new Container();
  private actors = new Container();
  private fx = new Container();
  private labelLayer = new Container();
  private tint = new Graphics();
  private vignette: Sprite | null = null;
  private tiles = new Map<string, TileView>();
  private groundCache = new Map<string, Texture>();
  private thumbs = new Map<string, Sprite>();
  private thumbCache = new Map<string, Texture>();
  private labels = new Map<string, Container>();
  private buildQueue: string[] = [];
  private pool: Sprite[] = [];
  private mine = new Map<string, Ent>();
  private controlledId: string;
  private keys = new Set<string>();
  private pathBudget = 0;
  private speed = 1;
  private clock = 9 * 60;
  private day = 1;
  private lastInput = performance.now();
  private auto = false;
  private follow = true;
  private zoom = 0.95;
  private overview = false;
  private fpsAcc: number[] = [];
  private hudAt = 0;
  private nearId: string | null = null;
  private destroyed = false;
  private cleanup: (() => void)[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = 0;
  private pinch = 0;
  private hearts: { g: Graphics; life: number; vy: number }[] = [];
  private lowPower = false;
  private entCap = 160;

  constructor(
    causes: WorldCause[],
    private workers: MyWorker[],
    controlledId: string,
    private ev: WorldEvents,
  ) {
    this.world = new World(causes);
    this.controlledId = controlledId;
  }

  async mount(el: HTMLElement) {
    this.lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || matchMedia("(pointer: coarse)").matches;
    if (this.lowPower) this.entCap = 70;
    await this.app.init({
      resizeTo: el,
      background: "#BFE0A6",
      antialias: !this.lowPower,
      resolution: Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.25 : 2),
      autoDensity: true,
      preference: "webgl",
    });
    if (this.destroyed) return this.app.destroy(true);
    el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = "none";
    this.tex = new WorldTextures(this.app.renderer);
    await this.tex.loadManifest();
    this.actors.sortableChildren = true;
    this.cam.addChild(this.thumbLayer, this.groundLayer, this.actors, this.fx, this.labelLayer);
    this.app.stage.addChild(this.cam, this.tint);
    this.cozyGrade();

    for (const w of this.workers) this.spawnMine(w);
    const p = this.player();
    this.centerOn(p.x, p.y);
    this.bindInput(el);
    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
    const onVis = () => (document.hidden ? this.app.ticker.stop() : this.app.ticker.start());
    document.addEventListener("visibilitychange", onVis);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onVis));
  }

  destroy() {
    this.destroyed = true;
    this.cleanup.forEach((f) => f());
    try {
      for (const t of this.groundCache.values()) t.destroy(true);
      for (const t of this.thumbCache.values()) t.destroy(true);
      this.tex?.destroy();
      this.app.destroy(true, { children: true });
    } catch {
      /* not initialised */
    }
  }

  /** Development aid: PNG data URL of the current frame (works even when the tab isn't painted). */
  async snapshot(): Promise<string> {
    this.app.renderer.render(this.app.stage);
    return this.app.renderer.extract.base64({ target: this.app.stage, frame: new Rectangle(0, 0, this.app.screen.width, this.app.screen.height), resolution: 1 });
  }

  // ───────────────────────────── public API (React HUD) ─────────────────────────────

  setControlled(id: string) {
    if (!this.mine.has(id)) return;
    this.controlledId = id;
    const p = this.player();
    p.path = [];
    p.state = "idle";
    this.follow = true;
    this.touch();
  }
  setSpeed(s: number) {
    this.speed = s;
  }
  zoomBy(f: number) {
    this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, f);
  }
  /** World Map button: jump between the close-up view and the whole-world map. */
  toggleOverview() {
    const p = this.player();
    if (this.overview) {
      this.zoom = 0.95;
      this.follow = true;
      this.centerOn(p.x, p.y);
    } else {
      const s = this.cam.scale.x;
      const cx = (-this.cam.x + this.app.screen.width / 2) / s, cy = (-this.cam.y + this.app.screen.height / 2) / s;
      this.zoom = 0.22;
      this.follow = false;
      this.centerOn(cx, cy);
    }
  }
  panTo(x: number, y: number) {
    this.follow = false;
    this.centerOn(x, y);
  }
  panToCause(id: string) {
    const c = this.world.causes.find((x) => x.id === id);
    if (!c) return;
    const h = this.world.tile(c.tx, c.ty).hall;
    this.zoom = Math.max(this.zoom, 0.7);
    this.panTo(h?.x ?? c.tx * TILE_PX + 320, (h?.y ?? c.ty * TILE_PX + 320) - 60);
  }
  walkToCause(id: string) {
    const c = this.world.causes.find((x) => x.id === id);
    if (!c) return;
    const h = this.world.tile(c.tx, c.ty).hall!;
    const p = this.player();
    this.follow = true;
    this.touch();
    this.routeTo(p, h.x, h.y, 60000);
    p.target = id;
  }
  fastTravel(id: string) {
    const c = this.world.causes.find((x) => x.id === id);
    if (!c) return;
    const h = this.world.tile(c.tx, c.ty).hall!;
    const p = this.player();
    this.burst(p.x, p.y - 30, "#FFFFFF", 10);
    p.x = h.x;
    p.y = h.y + 8;
    p.path = [];
    p.state = "idle";
    p.tileKey = key(c.tx, c.ty);
    this.follow = true;
    this.zoom = Math.max(this.zoom, 0.85);
    this.centerOn(p.x, p.y);
    this.burst(p.x, p.y - 30, "#F6C76C", 14);
    this.touch();
  }
  setCarry(workerId: string, n: number) {
    const e = this.mine.get(workerId);
    if (e) e.carry = n;
  }
  setWorkerHome(workerId: string, causeId: string) {
    const e = this.mine.get(workerId);
    const c = this.world.causes.find((x) => x.id === causeId);
    if (!e || !c) return;
    e.homeTx = c.tx;
    e.homeTy = c.ty;
  }
  /** Hearts rising from a cause hall (delivery celebration). */
  celebrate(causeId: string) {
    const c = this.world.causes.find((x) => x.id === causeId);
    const h = c && this.world.tile(c.tx, c.ty).hall;
    if (h) this.burst(h.x, h.y - 60, "#E2523F", 16);
  }
  /**
   * A delivery truck drives along the road network from one cause to another (support moved).
   * Resolves when it arrives. The camera follows it if `follow` is true.
   */
  sendTruck(fromId: string, toId: string, follow = true): Promise<void> {
    const a = this.world.causes.find((x) => x.id === fromId), b = this.world.causes.find((x) => x.id === toId);
    if (!a || !b) return Promise.resolve();
    const ha = this.world.tile(a.tx, a.ty).hall!, hb = this.world.tile(b.tx, b.ty).hall!;
    const sa = this.nearestRoad(Math.floor(ha.x / CELL), Math.floor(ha.y / CELL));
    const sb = this.nearestRoad(Math.floor(hb.x / CELL), Math.floor(hb.y / CELL));
    const raw = sa && sb ? findPath(sa, sb, (x, y) => this.world.isRoad(x, y), 40000) : null;
    const path = raw ? simplify(raw) : [sb ?? { x: Math.floor(hb.x / CELL), y: Math.floor(hb.y / CELL) }];
    return new Promise((resolve) => {
      const t: Ent = {
        id: `move-${Date.now()}`, kind: "truck", mascot: "cat", x: (sa?.x ?? 0) * CELL + 16, y: (sa?.y ?? 0) * CELL + 16, path, pathAt: 0,
        state: "walk", timer: 0, speed: 260, facing: 1, back: false, tileKey: "global", homeTx: a.tx, homeTy: a.ty, carry: 1, spr: null, load: [], tag: null,
        onDone: () => {
          this.burst(hb.x, hb.y - 50, "#E2523F", 14);
          resolve();
        },
      };
      this.mine.set(t.id, t);
      if (follow) {
        this.follow = false;
        this.truckCam = t;
      }
    });
  }
  private truckCam: Ent | null = null;

  /** Minimap data: tile kinds around the populated area + player + view rectangle (tile units). */
  minimap() {
    const b = this.world.bounds;
    const p = this.player();
    const s = this.cam.scale.x;
    return {
      bounds: b,
      kindAt: (tx: number, ty: number) => this.world.kindAt(tx, ty),
      player: { x: p.x / TILE_PX, y: p.y / TILE_PX },
      view: { x: -this.cam.x / s / TILE_PX, y: -this.cam.y / s / TILE_PX, w: this.app.screen.width / s / TILE_PX, h: this.app.screen.height / s / TILE_PX },
    };
  }

  // ───────────────────────────── entities ─────────────────────────────

  private player() {
    return this.mine.get(this.controlledId)!;
  }

  private spawnMine(w: MyWorker) {
    const c = this.world.causes.find((x) => x.id === w.homeCauseId) ?? this.world.causes[0];
    const h = this.world.tile(c.tx, c.ty).hall!;
    const r = rng(Math.floor(hash2(w.id.length, w.mascot.length) * 1e9));
    const e: Ent = {
      id: w.id, kind: "mine", mascot: w.mascot, x: h.x + (r() - 0.5) * 60, y: h.y + 20 + r() * 30, path: [], pathAt: 0, state: "idle", timer: 1,
      speed: PLAYER_SPEED, facing: 1, back: false, tileKey: key(c.tx, c.ty), homeTx: c.tx, homeTy: c.ty, carry: 0, spr: null, load: [], tag: null,
    };
    this.mine.set(w.id, e);
  }

  /** Demo inhabitants for a tile, deterministic per tile; capped by the global budget. */
  private spawnTileEnts(v: TileView) {
    const t = this.world.tile(v.tx, v.ty);
    const r = rng(Math.floor(hash2(v.tx, v.ty, 41) * 1e9));
    if (t.cause) {
      const n = Math.min(3 + t.cause.stage * 2, Math.ceil(t.cause.helpers / 8), 12);
      for (let i = 0; i < n; i++) {
        const m = MASCOTS[Math.floor(r() * MASCOTS.length)];
        const p = this.randomSpot(v.tx, v.ty, r);
        v.ents.push(this.npc(`${v.k}:h${i}`, "helper", m, p.x, p.y, v));
      }
      if (t.paddock) for (let i = 0; i < 5; i++) {
        const e = this.npc(`${v.k}:s${i}`, "sheep", "cat", t.paddock.x0 + r() * (t.paddock.x1 - t.paddock.x0), t.paddock.y0 + r() * (t.paddock.y1 - t.paddock.y0), v);
        e.bounds = t.paddock;
        e.speed = 22;
        v.ents.push(e);
      }
    } else if (t.kind === "meadow" || t.kind === "grove") {
      if (r() < 0.5) {
        const p = this.randomSpot(v.tx, v.ty, r);
        v.ents.push(this.npc(`${v.k}:w0`, "helper", MASCOTS[Math.floor(r() * 8)], p.x, p.y, v));
      }
    }
  }

  private npc(id: string, kind: Ent["kind"], m: Mascot, x: number, y: number, v: TileView): Ent {
    return { id, kind, mascot: m, x, y, path: [], pathAt: 0, state: "idle", timer: 0.5 + Math.random() * 3, speed: 55 + Math.random() * 25, facing: 1, back: false, tileKey: v.k, homeTx: v.tx, homeTy: v.ty, carry: 0, spr: null, load: [], tag: null };
  }

  private randomSpot(tx: number, ty: number, r: () => number) {
    for (let i = 0; i < 30; i++) {
      const cx = tx * TILE_CELLS + 2 + Math.floor(r() * (TILE_CELLS - 3));
      const cy = ty * TILE_CELLS + 2 + Math.floor(r() * (TILE_CELLS - 3));
      if (this.world.walkable(cx, cy)) return { x: cx * CELL + 16, y: cy * CELL + 24 };
    }
    return { x: tx * TILE_PX + 48, y: ty * TILE_PX + 48 };
  }

  private routeTo(e: Ent, x: number, y: number, budget = 3000) {
    const s = { x: Math.floor(e.x / CELL), y: Math.floor((e.y - 4) / CELL) };
    let g = { x: Math.floor(x / CELL), y: Math.floor(y / CELL) };
    if (!this.world.walkable(g.x, g.y)) g = this.nearestWalkable(g) ?? g;
    const p = findPath(s, g, (cx, cy) => this.world.walkable(cx, cy), budget);
    e.path = p ? simplify(p) : [];
    e.pathAt = 0;
    e.state = e.path.length ? "walk" : "idle";
  }

  private nearestWalkable(c: Cell) {
    for (let r = 1; r < 6; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (this.world.walkable(c.x + dx, c.y + dy)) return { x: c.x + dx, y: c.y + dy };
    return null;
  }
  private nearestRoad(cx: number, cy: number) {
    for (let r = 0; r < 26; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if ((Math.abs(dx) === r || Math.abs(dy) === r) && this.world.isRoad(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
    return null;
  }

  /** Moves along the path; returns true on arrival. */
  private follow1(e: Ent, dt: number) {
    if (e.pathAt >= e.path.length) return true;
    const c = e.path[e.pathAt];
    const tx = c.x * CELL + 16, ty = c.y * CELL + 26;
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    const step = e.speed * dt;
    if (d <= step) {
      e.x = tx;
      e.y = ty;
      e.pathAt++;
    } else {
      e.x += (dx / d) * step;
      e.y += (dy / d) * step;
    }
    if (Math.abs(dx) > 1) e.facing = dx > 0 ? 1 : -1;
    e.side = Math.abs(dx) > Math.abs(dy) * 1.1;
    e.back = !e.side && dy < 0;
    return e.pathAt >= e.path.length;
  }

  private stepNpc(e: Ent, dt: number) {
    if (e.kind === "truck") {
      e.x += (e.vx ?? 0) * dt;
      return;
    }
    if (e.state === "walk") {
      if (this.follow1(e, dt)) {
        e.state = "idle";
        e.timer = 1 + Math.random() * 3;
        if (e.kind === "helper" && Math.random() < 0.4) e.carry = e.carry ? 0 : 1;
      }
      return;
    }
    e.timer -= dt;
    if (e.timer > 0) return;
    if (e.bounds) {
      // sheep: short straight hops inside the paddock
      const b = e.bounds;
      e.path = [{ x: Math.floor((b.x0 + Math.random() * (b.x1 - b.x0)) / CELL), y: Math.floor((b.y0 + Math.random() * (b.y1 - b.y0)) / CELL) }];
      e.pathAt = 0;
      e.state = "walk";
      return;
    }
    if (this.pathBudget <= 0) return;
    this.pathBudget--;
    const t = this.world.tile(e.homeTx, e.homeTy);
    const r = Math.random;
    // most helpers potter around their town; a few visit the hall, spreading out in front of it
    const goHall = t.hall && r() < 0.12;
    const p = goHall ? { x: t.hall!.x + (r() - 0.5) * 120, y: t.hall!.y + 20 + r() * 50 } : this.randomSpot(e.homeTx, e.homeTy, r);
    this.routeTo(e, p.x, p.y, 900);
    if (e.state === "idle") e.timer = 2;
  }

  private stepMine(e: Ent, dt: number, controlled: boolean) {
    if (e.kind === "truck") {
      if (this.follow1(e, dt)) {
        e.onDone?.();
        this.release(e);
        this.mine.delete(e.id);
        if (this.truckCam === e) {
          this.truckCam = null;
          this.follow = true;
        }
      }
      return;
    }
    if (controlled && !this.auto) {
      // keyboard movement with wall sliding
      const k = this.keys;
      let vx = (k.has("arrowright") || k.has("d") ? 1 : 0) - (k.has("arrowleft") || k.has("a") ? 1 : 0);
      let vy = (k.has("arrowdown") || k.has("s") ? 1 : 0) - (k.has("arrowup") || k.has("w") ? 1 : 0);
      if (vx || vy) {
        e.path = [];
        e.target = undefined;
        const len = Math.hypot(vx, vy);
        vx /= len;
        vy /= len;
        const nx = e.x + vx * e.speed * dt, ny = e.y + vy * e.speed * dt;
        if (this.world.walkable(Math.floor(nx / CELL), Math.floor((e.y - 4) / CELL))) e.x = nx;
        if (this.world.walkable(Math.floor(e.x / CELL), Math.floor((ny - 4) / CELL))) e.y = ny;
        if (vx) e.facing = vx > 0 ? 1 : -1;
        e.side = Math.abs(vx) >= Math.abs(vy);
        e.back = !e.side && vy < 0;
        e.state = "walk";
        return;
      }
      if (e.path.length && e.pathAt < e.path.length) {
        e.state = "walk";
        if (this.follow1(e, dt)) {
          e.state = "idle";
          if (e.target) {
            const c = this.world.causes.find((x) => x.id === e.target);
            e.target = undefined;
            if (c) this.ev.onArrive(c);
          }
        }
      } else e.state = "idle";
      return;
    }
    // autonomous own worker: deliver parcels at its home hall, otherwise potter around home
    if (e.state === "walk") {
      if (this.follow1(e, dt)) {
        e.state = "idle";
        e.timer = 2 + Math.random() * 2;
        const t = this.world.tile(e.homeTx, e.homeTy);
        if (e.carry > 0 && t.cause && t.hall && Math.hypot(e.x - t.hall.x, e.y - t.hall.y) < 60) this.ev.onAutoDeliver(e.id, t.cause);
      }
      return;
    }
    e.timer -= dt;
    if (e.timer > 0) return;
    const t = this.world.tile(e.homeTx, e.homeTy);
    if (e.carry > 0 && t.hall) this.routeTo(e, t.hall.x, t.hall.y, 20000);
    else {
      const p = this.randomSpot(e.homeTx, e.homeTy, Math.random);
      const far = Math.abs(e.x / TILE_PX - e.homeTx - 0.5) > 1.5 || Math.abs(e.y / TILE_PX - e.homeTy - 0.5) > 1.5;
      this.routeTo(e, p.x, p.y, far ? 20000 : 1200);
    }
    if (e.state === "idle") e.timer = 3;
  }

  // ───────────────────────────── tiles ─────────────────────────────

  private viewTiles(margin: number) {
    const s = this.cam.scale.x;
    const x0 = -this.cam.x / s, y0 = -this.cam.y / s;
    const x1 = x0 + this.app.screen.width / s, y1 = y0 + this.app.screen.height / s;
    return {
      tx0: Math.floor(x0 / TILE_PX) - margin,
      ty0: Math.floor(y0 / TILE_PX) - margin,
      tx1: Math.floor(x1 / TILE_PX) + margin,
      ty1: Math.floor(y1 / TILE_PX) + margin,
      cx: (x0 + x1) / 2 / TILE_PX,
      cy: (y0 + y1) / 2 / TILE_PX,
    };
  }

  private syncTiles() {
    const v = this.viewTiles(this.overview ? 0 : 1);
    const want = new Set<string>();
    const list: { k: string; d: number }[] = [];
    for (let ty = v.ty0; ty <= v.ty1; ty++)
      for (let tx = v.tx0; tx <= v.tx1; tx++) {
        const k = key(tx, ty);
        want.add(k);
        const have = this.overview ? this.thumbs.has(k) : this.tiles.get(k)?.ground;
        if (!have) list.push({ k, d: Math.hypot(tx + 0.5 - v.cx, ty + 0.5 - v.cy) });
      }
    list.sort((a, b) => a.d - b.d);
    this.buildQueue = list.map((l) => l.k);

    // unload what is no longer wanted
    if (this.overview) {
      for (const [k, t] of this.tiles) this.unloadTile(k, t);
      for (const [k, s] of this.thumbs) if (!want.has(k)) {
        s.destroy();
        this.thumbs.delete(k);
      }
    } else {
      for (const [k, s] of this.thumbs) {
        s.destroy();
        this.thumbs.delete(k);
      }
      for (const [k, t] of this.tiles) if (!want.has(k)) this.unloadTile(k, t);
    }

    // time-sliced building, nearest first
    const perFrame = this.overview ? 6 : 1; // a full tile bake costs ~11 ms; one per frame avoids hitches
    for (let i = 0; i < perFrame && this.buildQueue.length; i++) {
      const k = this.buildQueue.shift()!;
      const [tx, ty] = k.split(",").map(Number);
      if (this.overview) this.buildThumb(k, tx, ty);
      else this.buildTile(k, tx, ty);
    }

    // labels for cause tiles in view
    const lv = this.viewTiles(0);
    const seen = new Set<string>();
    for (let ty = lv.ty0; ty <= lv.ty1; ty++)
      for (let tx = lv.tx0; tx <= lv.tx1; tx++) {
        const c = this.world.causeAt(tx, ty);
        if (!c) continue;
        seen.add(c.id);
        if (!this.labels.has(c.id)) this.labels.set(c.id, this.makeLabel(c));
      }
    for (const [id, l] of this.labels) if (!seen.has(id)) {
      l.destroy({ children: true });
      this.labels.delete(id);
    }
    const ls = Math.max(0.85, Math.min(4.2, 0.95 / this.cam.scale.x));
    for (const l of this.labels.values()) l.scale.set(this.overview ? ls * 0.58 : Math.max(0.9, Math.min(1.6, ls * 0.8)));
  }

  private groundTexture(k: string, tx: number, ty: number) {
    let t = this.groundCache.get(k);
    if (t) {
      this.groundCache.delete(k);
      this.groundCache.set(k, t);
      return t;
    }
    const g = drawTileGround(this.world.tile(tx, ty), true, this.tex.ground);
    t = this.app.renderer.generateTexture({ target: g, frame: new Rectangle(0, 0, TILE_PX, TILE_PX), resolution: this.lowPower ? 0.75 : 1 });
    g.destroy();
    this.groundCache.set(k, t);
    if (this.groundCache.size > 40) {
      const [ok, ot] = this.groundCache.entries().next().value!;
      if (!this.tiles.get(ok)?.ground) {
        ot.destroy(true);
        this.groundCache.delete(ok);
      }
    }
    return t;
  }

  private buildTile(k: string, tx: number, ty: number) {
    const data = this.world.tile(tx, ty);
    const v: TileView = this.tiles.get(k) ?? { k, tx, ty, ground: null, props: [], ents: [], truckIn: 4 + Math.random() * 10 };
    const gs = new Sprite(this.groundTexture(k, tx, ty));
    gs.position.set(tx * TILE_PX, ty * TILE_PX);
    this.groundLayer.addChild(gs);
    v.ground = gs;
    for (const p of data.props) {
      const b = this.tex.prop(p.k, p.v);
      const s = this.sprite(b);
      s.position.set(p.x, p.y);
      s.scale.set(b.scale * p.s);
      s.zIndex = p.y;
      v.props.push(s);
    }
    this.tiles.set(k, v);
    this.spawnTileEnts(v);
  }

  private unloadTile(k: string, v: TileView) {
    v.ground?.destroy();
    v.ground = null;
    for (const s of v.props) this.recycle(s);
    v.props = [];
    for (const e of v.ents) this.release(e);
    v.ents = [];
    this.tiles.delete(k);
  }

  private buildThumb(k: string, tx: number, ty: number) {
    let t = this.thumbCache.get(k);
    if (!t) {
      const data = this.world.tile(tx, ty);
      const c = new Container();
      c.addChild(drawTileGround(data, false, this.tex.ground));
      for (const p of data.props) {
        const b = this.tex.prop(p.k, p.v);
        const s = new Sprite(b.tex);
        s.anchor.set(b.ax, b.ay);
        s.scale.set(b.scale * p.s);
        s.position.set(p.x - tx * TILE_PX, p.y - ty * TILE_PX);
        c.addChild(s);
      }
      t = this.app.renderer.generateTexture({ target: c, frame: new Rectangle(0, 0, TILE_PX, TILE_PX), resolution: 0.18 });
      c.destroy({ children: true });
      this.thumbCache.set(k, t);
      if (this.thumbCache.size > 500) {
        const [ok, ot] = this.thumbCache.entries().next().value!;
        if (!this.thumbs.has(ok)) {
          ot.destroy(true);
          this.thumbCache.delete(ok);
        }
      }
    }
    const s = new Sprite(t);
    s.position.set(tx * TILE_PX, ty * TILE_PX);
    s.width = TILE_PX;
    s.height = TILE_PX;
    this.thumbLayer.addChild(s);
    this.thumbs.set(k, s);
  }

  private makeLabel(c: WorldCause) {
    const t = this.world.tile(c.tx, c.ty);
    const box = new Container();
    const name = new Text({ text: c.name, style: { fontFamily: "Manrope, sans-serif", fontSize: 15, fontWeight: "800", fill: "#3A2A22" } });
    const sub = new Text({ text: `${c.subtitle} · ${c.helpers} helpers`, style: { fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: "600", fill: "#7B6A5C" } });
    const w = Math.max(name.width, sub.width) + 44;
    const plate = new Graphics().roundRect(-w / 2, -24, w, 46, 18).fill("#FFF9F0").stroke({ color: "#8A6448", width: 2.5 });
    plate.poly([-7, 21, 0, 30, 7, 21]).fill("#FFF9F0");
    const dot = new Graphics().circle(-w / 2 + 20, -1, 9).fill(CAT_COLOR[c.category] ?? "#F58A3C");
    dot.circle(-w / 2 + 17, -2, 3.2).fill("#FFFFFF").circle(-w / 2 + 23, -2, 3.2).fill("#FFFFFF").poly([-w / 2 + 13.8, -1, -w / 2 + 20, 5, -w / 2 + 26.2, -1]).fill("#FFFFFF");
    name.position.set(-w / 2 + 34, -18);
    sub.position.set(-w / 2 + 34, 1);
    box.addChild(plate, dot, name, sub);
    box.position.set(t.hall ? t.hall.x : c.tx * TILE_PX + TILE_PX / 2, c.ty * TILE_PX + 26);
    box.eventMode = "static";
    box.cursor = "pointer";
    box.on("pointertap", (e) => {
      e.stopPropagation();
      if (this.dragMoved < 8) this.ev.onSelect(c);
    });
    this.labelLayer.addChild(box);
    return box;
  }

  // ───────────────────────────── sprites (pooled) ─────────────────────────────

  private sprite(b: Baked) {
    const s = this.pool.pop() ?? new Sprite();
    s.texture = b.tex;
    s.anchor.set(b.ax, b.ay);
    s.scale.set(b.scale);
    s.visible = true;
    s.alpha = 1;
    s.rotation = 0;
    if (s.parent !== this.actors) this.actors.addChild(s);
    return s;
  }
  private recycle(s: Sprite) {
    s.visible = false;
    if (this.pool.length < 800) this.pool.push(s);
    else s.destroy();
  }
  private release(e: Ent) {
    if (e.spr) this.recycle(e.spr);
    e.spr = null;
    for (const l of e.load) this.recycle(l);
    e.load = [];
    e.tag?.destroy({ children: true });
    e.tag = null;
  }

  // ───────────────────────────── camera & input ─────────────────────────────

  private centerOn(x: number, y: number) {
    const s = this.zoom;
    this.cam.scale.set(s);
    this.cam.position.set(this.app.screen.width / 2 - x * s, this.app.screen.height / 2 - y * s);
  }

  private zoomAt(sx: number, sy: number, f: number) {
    const old = this.cam.scale.x;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, old * f));
    const wx = (sx - this.cam.x) / old, wy = (sy - this.cam.y) / old;
    this.zoom = next;
    this.cam.scale.set(next);
    this.cam.position.set(sx - wx * next, sy - wy * next);
    if (next < LOD_ZOOM) this.follow = false;
  }

  private touch() {
    this.lastInput = performance.now();
    if (this.auto) {
      this.auto = false;
      const p = this.player();
      p.path = [];
      p.state = "idle";
    }
  }

  private bindInput(el: HTMLElement) {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    stage.on("pointerdown", (e: FederatedPointerEvent) => {
      this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      this.dragMoved = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    stage.on("globalpointermove", (e: FederatedPointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.global.x, y: e.global.y };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch);
        this.pinch = d;
        this.dragMoved += 20;
        return;
      }
      this.dragMoved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      if (this.dragMoved > 6) {
        this.follow = false;
        this.truckCam = null;
        this.cam.x += cur.x - prev.x;
        this.cam.y += cur.y - prev.y;
      }
    });
    const end = (e: FederatedPointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
    };
    stage.on("pointerup", end);
    stage.on("pointerupoutside", end);
    stage.on("pointertap", (e: FederatedPointerEvent) => {
      if (this.dragMoved > 8) return;
      const w = this.cam.toLocal(e.global);
      if (this.overview) {
        // map view: tap a tile to zoom into it
        this.zoom = 0.85;
        this.follow = false;
        this.centerOn(w.x, w.y);
        return;
      }
      this.touch();
      const tx = Math.floor(w.x / TILE_PX), ty = Math.floor(w.y / TILE_PX);
      const t = this.world.tile(tx, ty);
      const p = this.player();
      this.follow = true;
      // tapping a cause's main building walks to its door and opens it
      if (t.cause && t.hall && Math.abs(w.x - t.hall.x) < 130 && w.y < t.hall.y && w.y > t.hall.y - 230) {
        this.routeTo(p, t.hall.x, t.hall.y, 20000);
        p.target = t.cause.id;
      } else {
        this.routeTo(p, w.x, w.y, 6000);
        p.target = undefined;
      }
      this.marker(w.x, w.y);
    });
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
        e.preventDefault();
        this.keys.add(k);
        this.follow = true;
        this.truckCam = null;
        this.touch();
      }
      if (k === "e" && this.nearId) {
        const c = this.world.causes.find((x) => x.id === this.nearId);
        if (c) this.ev.onSelect(c);
      }
      if (k === "m") this.toggleOverview();
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    this.cleanup.push(
      () => el.removeEventListener("wheel", wheel),
      () => window.removeEventListener("keydown", kd),
      () => window.removeEventListener("keyup", ku),
      () => window.removeEventListener("blur", blur),
    );
  }

  private marker(x: number, y: number) {
    const g = new Graphics().ellipse(0, 0, 12, 6).stroke({ color: "#F58A3C", width: 3 });
    g.position.set(x, y);
    this.fx.addChild(g);
    this.hearts.push({ g, life: 0.7, vy: 0 });
  }
  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      g.circle(-2.6, 0, 3.2).fill(color).circle(2.6, 0, 3.2).fill(color).poly([-5.6, 1, 0, 7, 5.6, 1]).fill(color);
      g.position.set(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 20);
      g.scale.set(0.8 + Math.random() * 0.8);
      this.fx.addChild(g);
      this.hearts.push({ g, life: 1.2 + Math.random() * 0.6, vy: 30 + Math.random() * 40 });
    }
  }

  // ───────────────────────────── frame ─────────────────────────────

  private tick(rawDt: number) {
    const dt = Math.min(rawDt, 0.1);
    this.fpsAcc.push(1 / Math.max(rawDt, 1e-3));
    const sim = dt * this.speed;
    this.clock += sim * 2; // 1 real second = 2 game minutes at 1×
    if (this.clock >= 1440) {
      this.clock -= 1440;
      this.day++;
    }
    if (!this.auto && performance.now() - this.lastInput > AUTO_AFTER_S * 1000) this.auto = true;

    const s = this.zoom;
    if (Math.abs(this.cam.scale.x - s) > 1e-4) this.cam.scale.set(s);
    const wasOverview = this.overview;
    this.overview = s < LOD_ZOOM;
    this.groundLayer.visible = this.actors.visible = this.fx.visible = !this.overview;
    this.thumbLayer.visible = this.overview;
    this.labelLayer.visible = s >= 0.15; // below this, labels would only be clutter
    if (wasOverview !== this.overview) this.buildQueue = [];

    // simulate (only in detail mode, only active tiles)
    let simulated = 0;
    const p = this.player();
    if (!this.overview && sim > 0) {
      this.pathBudget = 4;
      for (const e of this.mine.values()) this.stepMine(e, sim, e.id === this.controlledId);
      for (const v of this.tiles.values()) {
        for (const e of v.ents) {
          this.stepNpc(e, sim);
          simulated++;
        }
        // ambient delivery trucks along the top road of civilised tiles
        if (this.world.isRoad(v.tx * TILE_CELLS + 5, v.ty * TILE_CELLS) && this.world.isCivilized(v.tx, v.ty)) {
          v.truckIn -= sim;
          if (v.truckIn <= 0) {
            v.truckIn = 18 + Math.random() * 30;
            const dir = Math.random() < 0.5 ? 1 : -1;
            const truck = this.npc(`${v.k}:t${Date.now()}`, "truck", "cat", dir > 0 ? v.tx * TILE_PX : (v.tx + 1) * TILE_PX, v.ty * TILE_PX + 34, v);
            truck.vx = dir * 90;
            truck.facing = dir as 1 | -1;
            truck.timer = TILE_PX / 90;
            v.ents.push(truck);
          }
        }
        v.ents = v.ents.filter((e) => {
          if (e.kind !== "truck") return true;
          e.timer -= sim;
          if (e.timer > 0) return true;
          this.release(e);
          return false;
        });
      }
    }

    // camera follow (smooth)
    const followTarget = this.truckCam ?? (this.follow ? p : null);
    if (followTarget && !this.overview) {
      const tx = this.app.screen.width / 2 - followTarget.x * s;
      const ty = this.app.screen.height / 2 - (followTarget.y - 30) * s;
      const k = 1 - Math.pow(0.0015, dt);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }

    this.syncTiles();
    if (!this.overview) this.render(dt);
    this.updateFx(dt);
    this.updateTint();

    // nearby cause prompt
    const ptx = Math.floor(p.x / TILE_PX), pty = Math.floor(p.y / TILE_PX);
    const pt = this.world.tile(ptx, pty);
    const near = pt.cause && pt.hall && Math.hypot(p.x - pt.hall.x, p.y - pt.hall.y) < 80 ? pt.cause : null;
    if ((near?.id ?? null) !== this.nearId) {
      this.nearId = near?.id ?? null;
      this.ev.onNear(near);
    }

    const now = performance.now();
    if (now - this.hudAt > 250) {
      this.hudAt = now;
      const fps = this.fpsAcc.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsAcc.length);
      this.fpsAcc = [];
      if (fps < 35 && this.entCap > 40) this.entCap -= 10;
      this.ev.onHud({
        fps: Math.round(fps),
        zoom: s,
        overview: this.overview,
        tiles: this.overview ? this.thumbs.size : this.tiles.size,
        sprites: this.actors.children.filter((c) => c.visible).length + this.thumbLayer.children.length,
        simulated,
        player: { x: p.x, y: p.y, tx: ptx, ty: pty },
        mode: this.auto ? "auto" : "manual",
        clock: Math.floor(this.clock),
        day: this.day,
      });
    }
  }

  /** Sync sprites for characters on screen; offscreen and over-budget characters have no sprite. */
  private render(dt: number) {
    const s = this.cam.scale.x;
    const vx0 = -this.cam.x / s - 64, vy0 = -this.cam.y / s - 96;
    const vx1 = vx0 + this.app.screen.width / s + 128, vy1 = vy0 + this.app.screen.height / s + 192;
    const t = performance.now() / 1000;
    let budget = this.entCap;
    const draw = (e: Ent, important: boolean) => {
      const onScreen = e.x > vx0 && e.x < vx1 && e.y > vy0 && e.y < vy1;
      if (!onScreen || (!important && budget <= 0)) {
        if (e.spr) this.release(e);
        return;
      }
      budget--;
      let b: Baked;
      if (e.kind === "sheep") b = this.tex.sheep();
      else if (e.kind === "truck") b = this.tex.truck();
      else {
        const walking = e.state === "walk";
        const frame = walking ? 2 + (Math.floor(t * 7 + e.x * 0.01) % 2) : Math.floor(t * 2 + e.y * 0.01) % 2;
        // 4-frame walk cycle at about 8 fps, offset per character so a crowd does not step in sync
        const wf = walking ? Math.floor(t * 8 + (e.x + e.y) * 0.013) % 4 : -1;
        b = this.tex.mascot(e.mascot, frame, e.back && walking, !!e.side && walking, wf);
      }
      if (!e.spr) e.spr = this.sprite(b);
      e.spr.texture = b.tex;
      e.spr.anchor.set(b.ax, b.ay);
      const base = b.art ? 1 : e.kind === "truck" ? 0.9 : e.kind === "sheep" ? 1 : 0.78;
      let bob = e.kind === "truck" ? Math.sin(t * 20) * 0.6 : 0;
      let squash = 1;
      if (b.art && (e.kind === "helper" || e.kind === "mine")) {
        // one image per pose: a hop while walking and a slow breath while idle
        const ph = t * 9 + e.x * 0.05;
        if (walkingNow(e)) {
          // real walk frames carry the motion; keep only a hint of bounce
          bob = -Math.abs(Math.sin(ph)) * (b.walk ? 1 : 3.5);
          squash = 1 + Math.sin(ph * 2) * (b.walk ? 0.01 : 0.03);
        } else squash = 1 + Math.sin(t * 2.4 + e.y) * 0.015;
      }
      const flip = e.kind === "truck" || !b.art || e.side ? e.facing : 1;
      e.spr.scale.set(base * b.scale * flip, base * b.scale * squash);
      e.spr.position.set(e.x, e.y + bob);
      e.spr.zIndex = e.y;
      // carried parcels
      const want = e.kind === "truck" ? 0 : Math.min(e.carry, 4);
      while (e.load.length < want) e.load.push(this.sprite(this.tex.parcel()));
      while (e.load.length > want) this.recycle(e.load.pop()!);
      e.load.forEach((l, i) => {
        l.position.set(e.x, e.y - 50 - i * 12);
        l.zIndex = e.y + 0.1 + i * 0.01;
        l.scale.set(0.8);
      });
      // name tag over my workers
      if (important && e.kind === "mine" && !e.tag) {
        const w = this.workers.find((x) => x.id === e.id);
        const tag = new Container();
        const txt = new Text({ text: w?.name ?? "", style: { fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: "800", fill: "#FFFFFF" } });
        const bg = new Graphics().roundRect(-txt.width / 2 - 8, -10, txt.width + 16, 20, 10).fill(e.id === this.controlledId ? "#F58A3C" : "#8A6448");
        txt.anchor.set(0.5);
        tag.addChild(bg, txt);
        e.tag = tag;
        this.labelLayer.addChild(tag);
      }
      if (e.tag) {
        e.tag.position.set(e.x, e.y - 62 - Math.min(e.carry, 4) * 12);
        (e.tag.children[0] as Graphics).tint = e.id === this.controlledId ? 0xffffff : 0xcccccc;
      }
    };
    const p = this.player();
    draw(p, true);
    for (const e of this.mine.values()) if (e !== p) draw(e, true);
    for (const v of this.tiles.values()) for (const e of v.ents) draw(e, false);
    void dt;
  }

  private updateFx(dt: number) {
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.life -= dt;
      h.g.y -= h.vy * dt;
      h.g.alpha = Math.max(0, Math.min(1, h.life * 1.5));
      if (h.life <= 0) {
        h.g.destroy();
        this.hearts.splice(i, 1);
      }
    }
  }

  /**
   * Cozy look: a gentle colour grade (slightly softer saturation, warm lift) and a soft vignette.
   * One filter pass over the world plus one screen-space sprite; skipped on low-power devices.
   */
  private cozyGrade() {
    if (!this.lowPower) {
      const cm = new ColorMatrixFilter();
      cm.saturate(-0.1, false);
      // warm lift: nudge reds up and blues down a touch
      const m = cm.matrix;
      m[0] *= 1.03; m[12] *= 0.96; m[4] += 0.01; m[14] -= 0.005;
      cm.matrix = m;
      this.cam.filters = [cm];
    }
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d")!;
    const grd = x.createRadialGradient(128, 128, 70, 128, 128, 182);
    grd.addColorStop(0, "rgba(74,52,36,0)");
    grd.addColorStop(1, "rgba(74,52,36,0.28)");
    x.fillStyle = grd;
    x.fillRect(0, 0, 256, 256);
    this.vignette = new Sprite(Texture.from(c));
    this.app.stage.addChild(this.vignette);
  }

  /** Gentle day/night light: a single translucent overlay, no per-sprite cost. */
  private updateTint() {
    const m = this.clock;
    let color = 0x1d2a5a, a = 0;
    if (m < 300 || m > 1260) a = 0.32;
    else if (m < 420) a = 0.32 * (1 - (m - 300) / 120);
    else if (m > 1080) {
      color = m < 1170 ? 0xf08a3e : 0x1d2a5a;
      a = m < 1170 ? ((m - 1080) / 90) * 0.12 : 0.12 + ((m - 1170) / 90) * 0.2;
    }
    if (this.vignette) {
      this.vignette.width = this.app.screen.width;
      this.vignette.height = this.app.screen.height;
    }
    this.tint.clear();
    if (a > 0.005) this.tint.rect(0, 0, this.app.screen.width, this.app.screen.height).fill({ color, alpha: a });
  }
}
