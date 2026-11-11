import { Application, Container, Graphics, Sprite, Text, type FederatedPointerEvent } from "pixi.js";
import { TextureBank } from "./art";
import { rng, type MapType } from "./sim";

export type WorldCity = { slug: string; name: string; x: number; y: number; stage: number; mapType: MapType; helpers: number; sample: boolean };

export const WORLD_W = 3200;
export const WORLD_H = 2400;

/**
 * The Hugshire overworld. Lightweight on purpose: the land and scenery are baked once,
 * each city is a handful of sprites, and nothing animates per-supporter here.
 */
export class WorldScene {
  private app = new Application();
  private bank!: TextureBank;
  private cam = new Container();
  private cities: WorldCity[] = [];
  private destroyed = false;
  private cleanup: (() => void)[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = 0;
  private pinchDist = 0;
  private labels: Container[] = [];

  constructor(private onOpen: (slug: string) => void) {}

  async mount(el: HTMLElement, cities: WorldCity[], focus?: string) {
    this.cities = cities;
    await this.app.init({ resizeTo: el, background: "#A9D7EA", antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    if (this.destroyed) {
      this.app.destroy({ removeView: true });
      return;
    }
    el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = "none";
    this.bank = new TextureBank(this.app.renderer);
    this.app.stage.addChild(this.cam);
    this.drawLand();
    this.drawCities();
    this.bindPanZoom(el);
    const f = cities.find((c) => c.slug === focus) ?? cities[0];
    this.centerOn(f ? f.x : WORLD_W / 2, f ? f.y : WORLD_H / 2, this.fitScale() * 1.6);
    const onVis = () => (document.hidden ? this.app.ticker.stop() : this.app.ticker.start());
    document.addEventListener("visibilitychange", onVis);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onVis));
  }

  destroy() {
    this.destroyed = true;
    this.cleanup.forEach((f) => f());
    try {
      this.bank?.destroy();
      this.app.destroy({ removeView: true }, { children: true });
    } catch {
      /* not initialised */
    }
  }

  zoomBy(f: number) {
    const w = this.app.screen.width / 2;
    const h = this.app.screen.height / 2;
    this.zoomAt(w, h, f);
  }

  private fitScale() {
    return Math.max(this.app.screen.width / WORLD_W, this.app.screen.height / WORLD_H);
  }

  private centerOn(x: number, y: number, s: number) {
    const sc = Math.max(this.fitScale(), Math.min(1.6, s));
    this.cam.scale.set(sc);
    this.cam.position.set(this.app.screen.width / 2 - x * sc, this.app.screen.height / 2 - y * sc);
    this.clamp();
  }

  /** Labels keep a readable on-screen size whatever the zoom. */
  private rescaleLabels() {
    const k = Math.max(0.7, Math.min(2.6, 0.62 / this.cam.scale.x));
    for (const l of this.labels) l.scale.set(k);
  }

  private clamp() {
    this.rescaleLabels();
    const s = this.cam.scale.x;
    const minX = this.app.screen.width - WORLD_W * s;
    const minY = this.app.screen.height - WORLD_H * s;
    this.cam.x = Math.min(0, Math.max(minX, this.cam.x));
    this.cam.y = Math.min(0, Math.max(minY, this.cam.y));
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const old = this.cam.scale.x;
    const next = Math.max(this.fitScale(), Math.min(1.6, old * factor));
    const wx = (sx - this.cam.x) / old;
    const wy = (sy - this.cam.y) / old;
    this.cam.scale.set(next);
    this.cam.position.set(sx - wx * next, sy - wy * next);
    this.clamp();
  }

  private drawLand() {
    const r = rng(20261107);
    const land = new Graphics();
    // soft island made of overlapping blobs
    const blobs: [number, number, number][] = [];
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 1;
      blobs.push([WORLD_W / 2 + Math.cos(a) * d * 1150, WORLD_H / 2 + Math.sin(a) * d * 800, 260 + r() * 260]);
    }
    for (const [x, y, rad] of blobs) land.circle(x, y, rad + 26).fill("#F3E3C3"); // beach
    for (const [x, y, rad] of blobs) land.circle(x, y, rad).fill("#BFE0A6");
    for (let i = 0; i < 40; i++) land.circle(800 + r() * 1600, 500 + r() * 1400, 60 + r() * 140).fill({ color: "#AED494", alpha: 0.6 });
    // a river and a lake
    land.moveTo(600, 300).bezierCurveTo(1100, 700, 900, 1300, 1500, 1500).bezierCurveTo(1900, 1650, 2300, 1500, 2700, 2050).stroke({ color: "#9CCFE6", width: 34, cap: "round" });
    land.ellipse(2250, 780, 170, 110).fill("#9CCFE6");
    // waves
    for (let i = 0; i < 90; i++) {
      const x = r() * WORLD_W;
      const y = r() * WORLD_H;
      land.moveTo(x, y).quadraticCurveTo(x + 10, y - 6, x + 20, y).stroke({ color: "#FFFFFF", width: 3, alpha: 0.35 });
    }
    const base = new Container();
    base.addChild(land);
    // scattered trees, baked together with the land
    for (let i = 0; i < 260; i++) {
      const x = 500 + r() * 2200;
      const y = 400 + r() * 1600;
      const b = this.bank.prop(r() < 0.6 ? "tree" : "pine", Math.floor(r() * 3), "nature");
      const s = new Sprite(b.tex);
      s.anchor.set(b.ax, b.ay);
      s.position.set(x, y);
      s.scale.set(0.8 + r() * 0.4);
      base.addChild(s);
    }
    base.cacheAsTexture({ resolution: 1 });
    this.cam.addChild(base);
  }

  private drawCities() {
    const layer = new Container();
    layer.sortableChildren = true;
    for (const c of this.cities) {
      const g = new Container();
      g.position.set(c.x, c.y);
      g.zIndex = c.y;
      const pad = new Graphics().ellipse(0, 0, 120, 70).fill({ color: c.stage === 0 ? "#D9CBB4" : "#CFE6B8" });
      pad.ellipse(0, 0, 120, 70).stroke({ color: "#FFFFFF", width: 4, alpha: 0.7 });
      g.addChild(pad);
      const r = rng(hash(c.slug));
      const spots = [[-50, -8], [0, -22], [48, -6], [-22, 22], [30, 24], [-70, 18], [72, 16]];
      const built = [0, 0, 1, 3, 5, 7][c.stage] ?? 0;
      spots.forEach(([x, y], i) => {
        const kind = i < built ? (i === 0 ? "landmark" : "house") : c.stage === 0 ? (r() < 0.5 ? "ruin" : "rock") : c.stage === 1 ? "stump" : "foundation";
        const b = this.bank.prop(kind, Math.floor(r() * 4), c.mapType);
        const s = new Sprite(b.tex);
        s.anchor.set(b.ax, b.ay);
        s.position.set(x, y + 10);
        s.scale.set(kind === "foundation" ? 0.45 : 0.7);
        g.addChild(s);
      });
      const t = new Text({ text: c.name, style: { fontFamily: "Manrope, sans-serif", fontSize: 22, fontWeight: "800", fill: "#2B241E" } });
      t.anchor.set(0.5);
      const sub = new Text({
        text: `${["Abandoned", "Cleared", "Foundations", "Small Town", "Growing Town", "Thriving"][c.stage]} · ${c.helpers} helper${c.helpers === 1 ? "" : "s"}${c.sample ? " · sample" : ""}`,
        style: { fontFamily: "Manrope, sans-serif", fontSize: 15, fontWeight: "600", fill: "#7B7067" },
      });
      sub.anchor.set(0.5);
      const w = Math.max(t.width, sub.width) + 32;
      const plate = new Graphics().roundRect(-w / 2, -30, w, 60, 20).fill("#FFFFFF");
      plate.roundRect(-w / 2, -30, w, 60, 20).stroke({ color: "#F58A3C", width: 3 });
      const label = new Container();
      label.addChild(plate, t, sub);
      t.y = -9;
      sub.y = 14;
      label.position.set(0, -98);
      this.labels.push(label);
      g.addChild(label);
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointertap", () => {
        if (this.dragMoved < 8) this.onOpen(c.slug);
      });
      g.on("pointerover", () => g.scale.set(1.05));
      g.on("pointerout", () => g.scale.set(1));
      layer.addChild(g);
    }
    this.cam.addChild(layer);
  }

  private bindPanZoom(el: HTMLElement) {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    stage.on("pointerdown", (e: FederatedPointerEvent) => {
      this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      this.dragMoved = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
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
        if (this.pinchDist > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinchDist);
        this.pinchDist = d;
        this.dragMoved += 10;
        return;
      }
      this.dragMoved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      this.cam.x += cur.x - prev.x;
      this.cam.y += cur.y - prev.y;
      this.clamp();
    });
    const end = (e: FederatedPointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
    };
    stage.on("pointerup", end);
    stage.on("pointerupoutside", end);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => el.removeEventListener("wheel", wheel));
  }
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
