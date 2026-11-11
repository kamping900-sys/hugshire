import { Application, Container, Graphics, Sprite, Text, type FederatedPointerEvent } from "pixi.js";
import { TextureBank } from "./art";
import {
  adaptCap,
  CITY_H,
  CITY_W,
  COLS,
  ROWS,
  TILE,
  buildCityLayout,
  commandMove,
  makeAgent,
  near,
  rng,
  selectVisibleHelpers,
  stepAgent,
  type Agent,
  type CityLayout,
  type HelperRow,
  type MapType,
} from "./sim";

export type CitySceneData = {
  seed: number;
  mapType: MapType;
  stage: number;
  helpers: HelperRow[];
  myHelperId: string | null;
  parcels: number;
  mode: "manual" | "auto";
  renderCap: number;
};

export type CitySceneEvents = {
  /** Any real player input (throttled by the React layer before it reaches the server). */
  onPlayerAction: () => void;
  /** Player carried parcels to the Cause Hall: React asks the server to deliver eligible yield. */
  onArriveAtHall: () => void;
  onPickup: () => void;
  onStats?: (s: { fps: number; visible: number; total: number }) => void;
};

const HELPER_SCALE = 0.85;
const GROUND = "#CFE6B8";
const GROUND_DARK = "#C2DDA9";
const PATH = "#EBD9BC";
const WATER = "#9CCFE6";

export class CityScene {
  private app = new Application();
  private bank!: TextureBank;
  private world = new Container();
  private actors = new Container();
  private overlay = new Container();
  private layout!: CityLayout;
  private agents = new Map<string, { a: Agent; spr: Sprite; tag?: Text; load: Sprite[] }>();
  private pool: Sprite[] = [];
  private parcelSprites: Sprite[] = [];
  private puffs: { g: Graphics; life: number }[] = [];
  private marker = new Graphics();
  private keys = new Set<string>();
  private data!: CitySceneData;
  private cap = 24;
  private rotation = 0;
  private rand = rng(1);
  private frameClock = 0;
  private fpsSamples: number[] = [];
  private destroyed = false;
  private arrivedNotified = false;
  private cleanup: (() => void)[] = [];

  constructor(private events: CitySceneEvents) {}

  async mount(el: HTMLElement, data: CitySceneData) {
    this.data = data;
    this.cap = data.renderCap;
    const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || matchMedia("(pointer: coarse)").matches;
    if (lowPower) this.cap = Math.min(this.cap, 12);
    await this.app.init({
      resizeTo: el,
      background: GROUND,
      antialias: !lowPower,
      resolution: Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2),
      autoDensity: true,
    });
    if (this.destroyed) {
      this.app.destroy({ removeView: true });
      return;
    }
    el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = "none";
    this.bank = new TextureBank(this.app.renderer);
    this.app.stage.addChild(this.world);
    this.build();
    this.fit();
    this.bindInput(el);
    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));

    const onVis = () => (document.hidden ? this.app.ticker.stop() : this.app.ticker.start());
    document.addEventListener("visibilitychange", onVis);
    const onResize = () => this.fit();
    window.addEventListener("resize", onResize);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onVis), () => window.removeEventListener("resize", onResize));
  }

  /** New server data (stage, parcels, mode, helper list). */
  update(next: CitySceneData) {
    const rebuild = next.stage !== this.data.stage || next.seed !== this.data.seed;
    this.data = next;
    if (rebuild) {
      this.world.removeChildren();
      this.agents.clear();
      this.build();
      return;
    }
    this.syncHelpers();
    this.syncParcels();
    const mine = this.myAgent();
    if (mine && next.mode === "auto") mine.a.controlled = false;
  }

  /** The server accepted (or refused) the delivery. */
  deliveryResolved(ok: boolean) {
    const mine = this.myAgent();
    if (!mine) return;
    if (ok) {
      for (let k = 0; k < Math.min(8, mine.a.carrying); k++) this.puff(this.layout.hall.x + (k - 4) * 6, this.layout.hall.y - 40, "#F6C76C");
      mine.a.carrying = 0;
      mine.a.state = "idle";
    }
    this.arrivedNotified = false;
    this.renderLoad(mine);
  }

  takeControl() {
    const mine = this.myAgent();
    if (mine) {
      mine.a.controlled = true;
      mine.a.state = mine.a.carrying ? "carry" : "idle";
      mine.a.tx = mine.a.x;
      mine.a.ty = mine.a.y;
    }
  }

  destroy() {
    this.destroyed = true;
    this.cleanup.forEach((f) => f());
    try {
      this.bank?.destroy();
      this.app.destroy({ removeView: true }, { children: true });
    } catch {
      /* not initialised yet */
    }
  }

  // ───────────────────────────── build ─────────────────────────────

  private build() {
    const d = this.data;
    this.layout = buildCityLayout(d.seed, d.mapType, d.stage);
    this.rand = rng(d.seed ^ 0x5bd1e995);

    // Static ground baked once into a texture.
    const ground = new Graphics();
    ground.rect(0, 0, CITY_W, CITY_H).fill(GROUND);
    const r = rng(d.seed);
    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if (r() < 0.22) ground.circle(x * TILE + r() * TILE, y * TILE + r() * TILE, 2 + r() * 3).fill(GROUND_DARK);
    // stream: a smooth curve through the water cells
    const wpts = this.layout.water.filter((_, i) => i % 2 === 0).map((w) => ({ x: w.x * TILE + TILE / 2, y: w.y * TILE + TILE }));
    if (wpts.length > 1) {
      ground.moveTo(wpts[0].x - TILE, wpts[0].y);
      for (let i = 1; i < wpts.length; i++) {
        const a = wpts[i - 1], b = wpts[i];
        ground.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      ground.lineTo(CITY_W + TILE, wpts[wpts.length - 1].y);
      ground.stroke({ color: "#B7DDEA", width: TILE * 2.2, cap: "round", join: "round" });
      ground.moveTo(wpts[0].x - TILE, wpts[0].y);
      for (let i = 1; i < wpts.length; i++) {
        const a = wpts[i - 1], b = wpts[i];
        ground.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      ground.lineTo(CITY_W + TILE, wpts[wpts.length - 1].y);
      ground.stroke({ color: WATER, width: TILE * 1.6, cap: "round", join: "round" });
    }
    for (const p of this.layout.paths) ground.roundRect(p.x * TILE, p.y * TILE, TILE, TILE, 6).fill(PATH);
    ground.roundRect(11 * TILE, 4.2 * TILE, 6 * TILE, 3 * TILE, 18).fill(PATH); // plaza
    const groundLayer = new Container();
    groundLayer.addChild(ground);
    groundLayer.cacheAsTexture(true);
    this.world.addChild(groundLayer);

    this.actors = new Container();
    this.actors.sortableChildren = true;
    this.world.addChild(this.actors);
    for (const p of this.layout.props) {
      const b = this.bank.prop(p.kind, p.variant, d.mapType);
      const s = new Sprite(b.tex);
      s.anchor.set(b.ax, b.ay);
      s.position.set(p.x, p.y);
      s.zIndex = p.y;
      this.actors.addChild(s);
    }

    this.overlay = new Container();
    this.world.addChild(this.overlay);
    this.marker = new Graphics().circle(0, 0, 9).stroke({ color: "#F58A3C", width: 3 }).circle(0, 0, 3).fill("#F58A3C");
    this.marker.visible = false;
    this.overlay.addChild(this.marker);

    const label = (text: string, x: number, y: number) => {
      const t = new Text({ text, style: { fontFamily: "Manrope, sans-serif", fontSize: 12, fontWeight: "800", fill: "#2B241E" } });
      t.anchor.set(0.5);
      const bg = new Graphics().roundRect(-t.width / 2 - 8, -11, t.width + 16, 22, 11).fill({ color: "#FFFFFF", alpha: 0.92 });
      const c = new Container();
      c.addChild(bg, t);
      c.position.set(x, y);
      this.overlay.addChild(c);
    };
    label(d.stage >= 3 ? "Cause Hall · deliver here" : "Cause sign · deliver here", this.layout.hall.x, this.layout.hall.y - 104);
    label("Reward depot", this.layout.depot.x, this.layout.depot.y - 62);

    this.parcelSprites = [];
    this.syncHelpers();
    this.syncParcels();
  }

  private fit() {
    const w = this.app.renderer.width / this.app.renderer.resolution;
    const h = this.app.renderer.height / this.app.renderer.resolution;
    const s = Math.min(w / CITY_W, h / CITY_H);
    this.world.scale.set(s);
    this.world.position.set((w - CITY_W * s) / 2, (h - CITY_H * s) / 2);
  }

  // ───────────────────────────── helpers (pooled) ─────────────────────────────

  private myAgent() {
    return this.data.myHelperId ? this.agents.get(this.data.myHelperId) : undefined;
  }

  private syncHelpers() {
    const visible = selectVisibleHelpers(this.data.helpers, this.cap, this.rotation);
    const keep = new Set(visible.map((h) => h.id));
    for (const [id, v] of this.agents) {
      if (keep.has(id)) continue;
      v.spr.visible = false;
      this.pool.push(v.spr);
      v.tag?.destroy();
      v.load.forEach((l) => l.destroy());
      this.agents.delete(id);
    }
    for (const h of visible) {
      if (this.agents.has(h.id)) continue;
      const a = makeAgent(h, this.layout, hashId(h.id));
      const spr = this.pool.pop() ?? new Sprite();
      const b = this.bank.animal(h.animal, 0);
      spr.texture = b.tex;
      spr.anchor.set(b.ax, b.ay);
      spr.scale.set(HELPER_SCALE);
      spr.visible = true;
      if (!spr.parent) this.actors.addChild(spr);
      let tag: Text | undefined;
      if (h.mine) {
        tag = new Text({ text: `${h.nickname} (you)`, style: { fontFamily: "Manrope, sans-serif", fontSize: 11, fontWeight: "800", fill: "#E67624", stroke: { color: "#FFFFFF", width: 4 } } });
        tag.anchor.set(0.5, 1);
        this.overlay.addChild(tag);
        a.controlled = this.data.mode === "manual";
        a.tx = a.x;
        a.ty = a.y;
      }
      this.agents.set(h.id, { a, spr, tag, load: [] });
    }
  }

  private syncParcels() {
    const n = this.data.parcels;
    while (this.parcelSprites.length < n) {
      const b = this.bank.parcel();
      const s = new Sprite(b.tex);
      s.anchor.set(b.ax, b.ay);
      s.scale.set(0.9);
      this.actors.addChild(s);
      this.parcelSprites.push(s);
    }
    const mine = this.myAgent();
    const pickedUp = mine?.a.carrying ?? 0;
    this.parcelSprites.forEach((s, i) => {
      s.visible = i < n - pickedUp;
      const col = i % 6;
      const row = Math.floor(i / 6);
      s.position.set(this.layout.depot.x - 22 + col * 9, this.layout.depot.y - 20 - row * 8);
      s.zIndex = this.layout.depot.y + 1 + i;
    });
  }

  private renderLoad(v: { a: Agent; load: Sprite[] }) {
    const want = Math.min(v.a.carrying, 5);
    while (v.load.length < want) {
      const b = this.bank.parcel();
      const s = new Sprite(b.tex);
      s.anchor.set(b.ax, b.ay);
      s.scale.set(0.7);
      this.overlay.addChild(s);
      v.load.push(s);
    }
    v.load.forEach((s, i) => (s.visible = i < want));
  }

  // ───────────────────────────── input ─────────────────────────────

  private bindInput(el: HTMLElement) {
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointertap", (e: FederatedPointerEvent) => {
      const mine = this.myAgent();
      if (!mine) return;
      const p = this.world.toLocal(e.global);
      commandMove(mine.a, p.x, p.y);
      this.marker.position.set(mine.a.tx, mine.a.ty);
      this.marker.visible = true;
      this.events.onPlayerAction();
    });
    const down = (e: KeyboardEvent) => {
      if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(e.key.toLowerCase())) return;
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (!el.matches(":hover") && document.activeElement !== el && !el.contains(document.activeElement)) return;
      e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      this.events.onPlayerAction();
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    this.cleanup.push(() => window.removeEventListener("keydown", down), () => window.removeEventListener("keyup", up));
  }

  // ───────────────────────────── loop ─────────────────────────────

  private tick(dt: number) {
    dt = Math.min(dt, 0.1);
    this.frameClock += dt;
    this.fpsSamples.push(1 / Math.max(dt, 1e-3));

    const mine = this.myAgent();
    if (mine && this.keys.size) {
      const k = this.keys;
      const vx = (k.has("arrowright") || k.has("d") ? 1 : 0) - (k.has("arrowleft") || k.has("a") ? 1 : 0);
      const vy = (k.has("arrowdown") || k.has("s") ? 1 : 0) - (k.has("arrowup") || k.has("w") ? 1 : 0);
      if (vx || vy) commandMove(mine.a, mine.a.x + vx * 40, mine.a.y + vy * 40);
    }

    for (const v of this.agents.values()) {
      const a = v.a;
      stepAgent(a, dt, this.layout, this.rand);
      const walking = a.state === "walk" || a.state === "carry";
      const frame = walking ? 2 + (Math.floor(this.frameClock * 6) % 2) : Math.floor(this.frameClock * 2) % 2;
      const b = this.bank.animal(a.animal, frame);
      v.spr.texture = b.tex;
      v.spr.position.set(a.x, a.y);
      v.spr.scale.x = HELPER_SCALE * a.facing;
      v.spr.zIndex = a.y;
      if (a.state === "work" && Math.random() < dt * 3) this.puff(a.x + a.facing * 14, a.y - 18, a.site?.kind === "mine" ? "#D3CBC2" : a.site?.kind === "build" ? "#F6C76C" : "#A8D49A");
      if (v.tag) v.tag.position.set(a.x, a.y - 46);
      if (!a.mine && a.carrying !== v.load.length) this.renderLoad(v);
      v.load.forEach((s, i) => s.position.set(a.x, a.y - 40 - i * 7));
    }

    // Player flow: pick up parcels at the depot, carry them to the hall.
    if (mine && mine.a.controlled) {
      if (mine.a.carrying === 0 && this.data.parcels > 0 && near(mine.a, this.layout.depot, 44)) {
        mine.a.carrying = this.data.parcels;
        this.renderLoad(mine);
        this.syncParcels();
        this.events.onPickup();
      }
      if (mine.a.carrying > 0 && near(mine.a, { x: this.layout.hall.x, y: this.layout.hall.y + 20 }, 50) && !this.arrivedNotified) {
        this.arrivedNotified = true;
        this.events.onArriveAtHall();
      }
      if (this.marker.visible && near(mine.a, { x: mine.a.tx, y: mine.a.ty }, 4)) this.marker.visible = false;
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      p.g.y -= dt * 18;
      p.g.alpha = Math.max(0, p.life / 0.8);
      if (p.life <= 0) {
        p.g.destroy();
        this.puffs.splice(i, 1);
      }
    }

    // Every 3 s: adapt quality and rotate which other supporters are shown.
    if (this.fpsSamples.length >= 180) {
      const fps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      this.fpsSamples = [];
      const next = adaptCap(this.cap, fps, this.data.renderCap);
      this.rotation++;
      if (next !== this.cap || this.data.helpers.length > this.cap) {
        this.cap = next;
        this.syncHelpers();
      }
      this.events.onStats?.({ fps: Math.round(fps), visible: this.agents.size, total: this.data.helpers.length });
    }
  }

  private puff(x: number, y: number, color: string) {
    if (this.puffs.length > 40) return;
    const g = new Graphics().circle(0, 0, 3 + Math.random() * 2).fill(color);
    g.position.set(x, y);
    this.overlay.addChild(g);
    this.puffs.push({ g, life: 0.8 });
  }
}

function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
