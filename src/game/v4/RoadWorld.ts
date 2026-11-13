/**
 * Level 1 (V4.1): a 2D side-scrolling overworld. The player drives a van left and right along one
 * long road; every real organisation town sits beside the road and can be entered. Built for fast
 * navigation: quick acceleration, a high top speed, a boost, and auto-drive to any town.
 *
 * Performance: one Pixi app, a fixed number of parallax layers that wrap, and per-town containers that
 * are culled when off screen.
 */
import { Application, Assets, Container, Graphics, Sprite, Text, TilingSprite, type Texture } from "pixi.js";
import { WorldTextures, type Baked } from "@/game/world/worldArt";

export type RoadTown = {
  id: string;
  slug: string | null; // null = decorative stop (not a cause)
  name: string;
  subtitle: string;
  category: string;
  completed: number;
  underConstruction: number;
  constructionBps: number;
  real: boolean;
};

type Ev = { onNear: (t: RoadTown | null) => void; onHud: (h: { x: number; speed: number; worldW: number; boosting: boolean }) => void; onEnter: (t: RoadTown) => void };

export const TOWN_GAP = 1100;
const START = 700;
const ROAD_Y = 600; // road surface (logical units; the view is scaled to fit height)
const VIEW_H = 760;
const MAX_SPEED = 1100; // px/s
const BOOST_SPEED = 1900;
const ACCEL = 2600;
const BRAKE = 4200;
const FRICTION = 1500;
/** Title-screen cruising speed: a slow, cozy drive. */
const ATTRACT_SPEED = 230;
/** 1 if the truck art faces right, -1 if it faces left. */
const SPRITE_FACING = 1;

export const ROAD_SLOTS = ["sky", "clouds", "mountains", "hills", "treeline", "road", "foreground", "van", "gate"] as const;
type RoadSlot = (typeof ROAD_SLOTS)[number];
/** Horizontal widening per background layer (1 = as painted). */
const STRETCH: Partial<Record<RoadSlot, number>> = { clouds: 1.2, mountains: 1.35, hills: 1.4, treeline: 1.4, foreground: 1.25 };

const BUILDINGS: Record<string, string[]> = {
  square: ["prop:townHall", "prop:fountain", "prop:gazebo"],
  education: ["prop:school", "prop:bookshop", "prop:house:1"],
  animals: ["prop:barn", "prop:kennel", "prop:house:2"],
  nature: ["prop:greenhouse", "prop:windmill", "prop:cottage"],
  health: ["prop:clinic", "prop:house:0", "prop:gazebo"],
  food: ["prop:stall", "prop:barn", "prop:house:3"],
  community: ["prop:townHall", "prop:studio", "prop:house:1"],
  arts: ["prop:studio", "prop:easel", "prop:cottage"],
  coast: ["prop:lighthouse", "prop:house:0", "prop:boxes"],
};

export class RoadWorld {
  private app = new Application();
  private tex!: WorldTextures;
  private root = new Container();
  /** drift = constant sideways speed in px/s (clouds float even when the van is parked). */
  private layers: { c: Container; factor: number; w: number; drift?: number }[] = [];
  private world = new Container(); // moves with the camera 1:1
  private towns: { t: RoadTown; x: number; c: Container; badge: Graphics }[] = [];
  private van = new Container();
  private vanLayer = new Container();
  private vanBody!: Sprite | Graphics;
  private wheels: Graphics[] = [];
  private dust: { g: Graphics; vx: number; vy: number; life: number }[] = [];
  private x = START;
  private v = 0;
  private dir: 1 | -1 = 1;
  private keys = new Set<string>();
  private touch = 0; // -1 / 0 / 1 from on-screen pedals
  private auto: number | null = null;
  private near: RoadTown | null = null;
  private destroyed = false;
  private worldW = 0;
  private t = 0;
  private scale = 1;
  private hudAt = 0;
  private cleanup: (() => void)[] = [];

  /**
   * attract = title-screen mode: the van drives itself slowly to the right and loops, with no
   * keyboard input, town cards or HUD callbacks (used behind the landing page).
   */
  constructor(private list: RoadTown[], private ev: Ev, private opts: { attract?: boolean } = {}) {}

  async mount(el: HTMLElement) {
    const low = (navigator.hardwareConcurrency ?? 8) <= 4 || matchMedia("(pointer: coarse)").matches;
    await this.app.init({ resizeTo: el, background: "#BFE3F2", antialias: !low, resolution: Math.min(window.devicePixelRatio || 1, low ? 1.25 : 2), autoDensity: true, preference: "webgl" });
    if (this.destroyed) return this.app.destroy({ removeView: true });
    el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = "none";
    this.tex = new WorldTextures(this.app.renderer);
    await this.tex.loadManifest();
    if (this.destroyed) return;
    this.worldW = START + this.list.length * TOWN_GAP + 900;
    this.app.stage.addChild(this.root);
    await this.loadRoadArt();
    this.buildParallax();
    this.root.addChild(this.world);
    this.buildRoad();
    this.list.forEach((t, i) => this.buildTown(t, START + 500 + i * TOWN_GAP));
    this.buildNpcs();
    this.buildVan();
    this.buildForeground();
    this.root.addChild(this.vanLayer); // the van is drawn above every layer, including the foreground
    if (!this.opts.attract) this.bindInput();
    this.app.ticker.add((tk) => this.tick(Math.min(0.05, tk.deltaMS / 1000)));
  }

  // ───────────────────────────── art slots ─────────────────────────────
  // Drop-in images (public/game/sprites/road/*.png). Each is optional: if it is missing, the drawn
  // fallback is used. Strips must tile horizontally (left and right edges match).
  private road: Partial<Record<RoadSlot, Texture>> = {};
  private skySprite: Sprite | null = null;
  private boardY = 0;
  private async loadRoadArt() {
    await Promise.all(
      ROAD_SLOTS.map(async (k) => {
        try {
          const r = await fetch(`/game/sprites/road/${k}.png`, { method: "HEAD" });
          if (!r.ok) return;
          const t = (await Assets.load(`/game/sprites/road/${k}.png`)) as Texture;
          t.source.scaleMode = "linear";
          /* smooth downscaling (mipmaps): painted art is drawn far smaller than its source */
          t.source.autoGenerateMipmaps = true;
          t.source.updateMipmaps();
          this.road[k] = t;
        } catch {
          /* not generated yet */
        }
      }),
    );
  }
  /** A horizontally tiling strip, bottom edge at `bottom`, scaled to `height`. */
  private strip(k: RoadSlot, bottom: number, height: number, factor: number, parent?: Container) {
    const tex = this.road[k];
    if (!tex) return false;
    const sc = height / tex.height;
    // the generated layers read a little tall and narrow: widen them so trees and houses look rounder
    const tw = tex.width * sc * (STRETCH[k] ?? 1);
    // side-by-side sprites (not a TilingSprite): no vertical wrap, so no bleed line at the top edge
    const c = new Container();
    // enough copies to cover ultra-wide screens (up to ~5000 logical px) plus one for wrapping
    const copies = Math.ceil(5200 / (tw - 1)) + 1;
    const sx = sc * (STRETCH[k] ?? 1);
    for (let i = 0; i < copies; i++) {
      const sp = new Sprite(tex);
      sp.scale.set(sx, sc);
      sp.position.set(i * tw - i, bottom - height);
      c.addChild(sp);
    }
    (parent ?? this.root).addChild(c);
    if (!parent) this.layers.push({ c, factor, w: tw - 1 });
    return true;
  }

  // ───────────────────────────── scenery ─────────────────────────────

  private repeatLayer(factor: number, w: number, draw: (c: Container) => void) {
    const c = new Container();
    for (let k = 0; k < Math.ceil(5200 / w) + 1; k++) {
      const part = new Container();
      draw(part);
      part.x = k * w;
      c.addChild(part);
    }
    this.root.addChild(c);
    this.layers.push({ c, factor, w });
  }

  private buildParallax() {
    if (this.road.sky) {
      const s = new Sprite(this.road.sky);
      s.height = VIEW_H;
      this.skySprite = s;
      this.root.addChild(s);
      this.layers.push({ c: s as unknown as Container, factor: 0, w: 0 });
    }
    const hasArt = (k: RoadSlot) => !!this.road[k];
    if (hasArt("sky")) {
      if (this.strip("clouds", 300, 260, 0.04)) this.layers[this.layers.length - 1].drift = 9; // clouds drift slowly to the left
      if (!this.strip("mountains", 470, 330, 0.12)) void 0;
      this.strip("hills", 545, 260, 0.28);
      this.strip("treeline", 585, 230, 0.55);
      return;
    }
    const sky = new Graphics();
    ["#BFE3F2", "#CBE8F2", "#D8EDEF", "#E6F1E6", "#F3F0D8"].forEach((c, i) => sky.rect(-10, i * 110, 6000, 112).fill(c));
    this.root.addChild(sky);
    this.layers.push({ c: sky as unknown as Container, factor: 0, w: 0 });
    // sun
    const sun = new Graphics().circle(0, 0, 70).fill({ color: "#FFF4C8", alpha: 0.5 }).circle(0, 0, 48).fill("#FFF1B8");
    sun.position.set(260, 130);
    this.root.addChild(sun);
    this.layers.push({ c: sun as unknown as Container, factor: 0, w: 0 });
    this.repeatLayer(0.05, 1600, (c) => {
      for (const [x, y, s] of [[120, 120, 1], [600, 80, 0.8], [1100, 150, 1.1], [1450, 70, 0.7]]) {
        const g = new Graphics();
        for (const [dx, dy, r] of [[0, 0, 28], [30, -10, 34], [64, 0, 26], [32, 10, 28]]) g.circle(dx * s, dy * s, r * s).fill({ color: "#FFFFFF", alpha: 0.92 });
        g.position.set(x, y);
        c.addChild(g);
      }
    });
    this.layers[this.layers.length - 1].drift = 9;
    this.repeatLayer(0.15, 1800, (c) => {
      const g = new Graphics();
      g.poly([0, 470, 160, 300, 300, 420, 470, 250, 650, 430, 820, 320, 980, 440, 1150, 280, 1330, 430, 1500, 310, 1680, 440, 1800, 360, 1800, 520, 0, 520]).fill("#A9C9C9");
      g.poly([470, 250, 520, 300, 430, 290]).fill("#F4F7F4");
      g.poly([1150, 280, 1200, 330, 1110, 320]).fill("#F4F7F4");
      c.addChild(g);
    });
    this.repeatLayer(0.3, 1600, (c) => {
      const g = new Graphics();
      g.ellipse(200, 520, 380, 120).fill("#9CCB86");
      g.ellipse(800, 530, 420, 130).fill("#A6D190");
      g.ellipse(1400, 520, 360, 120).fill("#9CCB86");
      c.addChild(g);
    });
    if (this.strip("treeline", 585, 230, 0.55)) return;
    this.repeatLayer(0.55, 1400, (c) => {
      const trees = ["prop:tree:0", "prop:tree:1", "prop:tree:2", "prop:pine", "prop:tree:3", "prop:blossom"].map((k) => this.art(k)).filter(Boolean) as Baked[];
      if (trees.length) {
        for (let i = 0; i < 14; i++) {
          const b = trees[(i * 5) % trees.length];
          const sp = new Sprite(b.tex as Texture);
          sp.anchor.set(b.ax, b.ay);
          const h = 120 + ((i * 29) % 50);
          sp.scale.set((b.scale * h) / (b.tex.height * b.scale));
          sp.position.set(i * 100 + ((i * 37) % 30), 572);
          sp.tint = 0xe6f0e0;
          c.addChild(sp);
        }
        return;
      }
      for (let i = 0; i < 12; i++) {
        const x = i * 118 + ((i * 37) % 40), s = 0.7 + ((i * 13) % 5) * 0.08;
        const g = new Graphics();
        g.roundRect(-6 * s, -40 * s, 12 * s, 42 * s, 4).fill("#8C5E3C");
        const tone = i % 3 ? "#7DB662" : "#88BE6B";
        for (const [dx, dy, r] of [[0, -78, 36], [-26, -58, 26], [26, -58, 26]]) g.circle(dx * s, (dy + 3) * s, r * s).fill("#5E9550");
        for (const [dx, dy, r] of [[0, -78, 36], [-26, -58, 26], [26, -58, 26]]) g.circle(dx * s, dy * s, r * s).fill(tone);
        g.position.set(x, 560);
        c.addChild(g);
      }
    });
  }

  private buildRoad() {
    const w = this.worldW + 2000;
    if (this.road.road) {
      const tex = this.road.road;
      const h = VIEW_H - (ROAD_Y - 60);
      const sc = h / tex.height;
      const ts = new TilingSprite({ texture: tex, width: w, height: h });
      ts.tileScale.set(sc);
      ts.position.set(-1000, ROAD_Y - 60);
      this.world.addChild(ts);
      this.roadSigns(w);
      return;
    }
    const g = new Graphics();
    g.rect(-1000, ROAD_Y - 40, w, 40).fill("#9CCB78"); // verge
    g.rect(-1000, ROAD_Y, w, 70).fill("#8E8A86"); // asphalt
    g.rect(-1000, ROAD_Y, w, 6).fill("#B9B3AA");
    g.rect(-1000, ROAD_Y + 64, w, 6).fill("#6F6A66");
    for (let x = -1000; x < w; x += 90) g.roundRect(x, ROAD_Y + 32, 46, 6, 3).fill("#F4E7C2");
    g.rect(-1000, ROAD_Y + 70, w, VIEW_H - ROAD_Y).fill("#86B967"); // foreground grass
    for (let x = -1000; x < w; x += 37) {
      const y = ROAD_Y + 90 + ((x * 7) % 60);
      g.poly([x, y, x + 3, y - 10, x + 6, y]).fill("#74A657");
    }
    for (let x = -1000; x < w; x += 140) {
      const y = ROAD_Y + 110 + ((x * 13) % 50);
      g.circle(x, y, 5).fill(["#F7B2C4", "#FFE38A", "#FFFFFF", "#C9B5F0"][Math.abs(x / 140) % 4 | 0]);
    }
    // fence posts along the verge
    for (let x = -1000; x < w; x += 60) g.rect(x, ROAD_Y - 30, 5, 26).fill("#C9A77C");
    g.rect(-1000, ROAD_Y - 24, w, 4).fill("#C9A77C");
    g.rect(-1000, ROAD_Y - 14, w, 4).fill("#C9A77C");
    this.world.addChild(g);
    this.roadSigns(w);
  }

  private roadSigns(w: number) {
    void w;
    // lamps and bushes along the verge (existing art)
    // keep the verge clear around every town (its gate and buildings already fill that space)
    const townXs = this.list.map((_, i) => START + 500 + i * TOWN_GAP);
    const clear = (x: number) => townXs.every((tx) => Math.abs(x - tx) > 380);
    for (let x = 0; x < this.worldW; x += 420) {
      if (clear(x + 210)) this.placeIn(this.world, "prop:lamp", x + 210, ROAD_Y - 18, 120);
      if (clear(x + 60)) this.placeIn(this.world, x % 840 ? "prop:bush:1" : "prop:flowers", x + 60, ROAD_Y - 14, 46);
    }
    // start and end markers
    const start = this.sign("Hugshire Road", "← drive →", 220);
    start.position.set(START - 380, ROAD_Y - 10);
    this.world.addChild(start);
    const end = this.sign("Road ends", "more towns coming", 200);
    end.position.set(this.worldW - 300, ROAD_Y - 10);
    this.world.addChild(end);
  }

  private sign(title: string, sub: string, w: number) {
    const c = new Container();
    const g = new Graphics();
    g.rect(-4, -70, 8, 70).fill("#8A6448");
    g.roundRect(-w / 2, -128, w, 62, 10).fill("#FFF9F0").stroke({ color: "#8A6448", width: 4 });
    c.addChild(g);
    const a = new Text({ text: title, style: { fontFamily: "Nunito, system-ui", fontSize: 20, fontWeight: "900", fill: "#3A2A22" } });
    a.anchor.set(0.5);
    a.position.set(0, -108);
    const b = new Text({ text: sub, style: { fontFamily: "Nunito, system-ui", fontSize: 13, fontWeight: "800", fill: "#7B6A5C" } });
    b.anchor.set(0.5);
    b.position.set(0, -84);
    c.addChild(a, b);
    return c;
  }

  private art(key: string): Baked | undefined {
    return this.tex.baked(key);
  }

  private placeIn(c: Container, key: string, x: number, y: number, h: number) {
    const b = this.art(key);
    if (!b) return;
    const s = new Sprite(b.tex as Texture);
    s.anchor.set(b.ax, b.ay);
    s.scale.set((b.scale * h) / (b.tex.height * b.scale));
    s.position.set(x, y);
    c.addChild(s);
  }

  private buildForeground() {
    // grass tufts and flowers in front of the van, moving slightly faster than the road
    const c = new Container();
    if (!this.strip("foreground", VIEW_H + 6, 92, 1.15, c)) {
      const g = new Graphics();
      for (let x = 0; x < 7000; x += 23) {
        const y = VIEW_H - 8 - ((x * 7) % 26);
        g.poly([x, VIEW_H + 4, x + 5, y, x + 10, VIEW_H + 4]).fill(x % 3 ? "#6FA052" : "#7DB060");
      }
      c.addChild(g);
    }
    this.root.addChild(c);
    this.layers.push({ c, factor: 1.15, w: this.road.foreground ? this.road.foreground.width * (92 / this.road.foreground.height) * (STRETCH.foreground ?? 1) - 1 : 23 * 60 });
  }

  private place(c: Container, key: string, x: number, h: number) {
    const b = this.art(key);
    if (!b) return;
    const s = new Sprite(b.tex as Texture);
    s.anchor.set(b.ax, b.ay);
    const k = h / (b.tex.height * b.scale);
    s.scale.set(b.scale * k);
    s.position.set(x, ROAD_Y - 36);
    c.addChild(s);
  }

  private buildTown(t: RoadTown, x: number) {
    const c = new Container();
    c.position.set(x, 0);
    const set = BUILDINGS[t.category] ?? BUILDINGS.community;
    // plaza strip
    c.addChild(new Graphics().roundRect(-330, ROAD_Y - 50, 660, 18, 8).fill({ color: "#E8D3B0" }));
    this.place(c, "prop:tree:1", -300, 150);
    this.place(c, set[2], -190, 150);
    this.place(c, set[0], 0, 230 + Math.min(t.completed, 5) * 6);
    this.place(c, set[1], 200, 160);
    this.place(c, "prop:tree:2", 300, 140);
    if (t.underConstruction > 0) {
      const sc = new Graphics();
      for (let i = 0; i < 4; i++) sc.rect(110 + i * 26, ROAD_Y - 170, 5, 134).fill("#B07A4A");
      for (let j = 0; j < 4; j++) sc.rect(104, ROAD_Y - 160 + j * 32, 92, 4).fill("#C98A4A");
      c.addChild(sc);
    }
    // gate arch with the town name
    if (this.road.gate) {
      // generated wooden arch; the name is drawn on its blank board
      const gs = new Sprite(this.road.gate);
      gs.anchor.set(0.5, 1);
      gs.scale.set(260 / this.road.gate.height);
      gs.position.set(0, ROAD_Y - 30);
      if (!t.real) gs.tint = 0xd9d0c6;
      c.addChild(gs);
      const k = 260 / this.road.gate.height;
      // board area of the generated gate, as fractions of its image (x 23–77%, y 1–27%)
      const gw = this.road.gate.width * k, gh = this.road.gate.height * k;
      const bw = gw * 0.55, bh = gh * 0.26, by = ROAD_Y - 30 - gh + gh * 0.012;
      const board = new Graphics();
      board.roundRect(-bw / 2 + 3, by + 5, bw, bh, 16).fill({ color: "#5A3A22", alpha: 0.25 });
      board.roundRect(-bw / 2, by, bw, bh, 16).fill(t.real ? "#E8C08A" : "#D9CBB8").stroke({ color: "#8A5A33", width: 4 });
      board.roundRect(-bw / 2 + 8, by + 7, bw - 16, bh * 0.28, 10).fill({ color: "#F6D9AE", alpha: 0.7 });
      for (const [nx, ny] of [[-bw / 2 + 14, by + 14], [bw / 2 - 14, by + 14], [-bw / 2 + 14, by + bh - 14], [bw / 2 - 14, by + bh - 14]]) board.circle(nx, ny, 4.5).fill("#9C6B45").stroke({ color: "#6B4A33", width: 1.5 });
      for (let gy = by + bh * 0.42; gy < by + bh - 8; gy += 13) board.moveTo(-bw / 2 + 24, gy).lineTo(bw / 2 - 24, gy + 2).stroke({ color: "#D2A56E", width: 1.2, alpha: 0.6 });
      c.addChild(board);
      this.boardY = by + bh / 2;
    } else {
      const gate = new Graphics();
      gate.rect(-120, ROAD_Y - 150, 10, 116).fill("#8A6448");
      gate.rect(110, ROAD_Y - 150, 10, 116).fill("#8A6448");
      gate.roundRect(-140, ROAD_Y - 200, 280, 58, 14).fill(t.real ? "#F58A3C" : "#C9B9A6").stroke({ color: "#6B4A33", width: 4 });
      c.addChild(gate);
    }
    const onBoard = !!this.road.gate;
    const name = new Text({ text: t.name, style: { fontFamily: "Nunito, system-ui", fontSize: onBoard ? 26 : 24, fontWeight: "900", fill: onBoard ? "#5A3A22" : "#FFF9F0", stroke: onBoard ? { color: "#FFF4DC", width: 3 } : { color: "#6B4A33", width: 5 } } });
    name.anchor.set(0.5);
    name.position.set(0, onBoard ? this.boardY - 7 : ROAD_Y - 180);
    const sub = new Text({ text: t.real ? (t.underConstruction ? `${t.completed} built · building ${(t.constructionBps / 100).toFixed(0)}%` : `${t.completed} built`) : "sample stop", style: { fontFamily: "Nunito, system-ui", fontSize: 12, fontWeight: "800", fill: onBoard ? "#7A5534" : "#FFF9F0" } });
    sub.anchor.set(0.5);
    sub.position.set(0, onBoard ? this.boardY + 15 : ROAD_Y - 156);
    c.addChild(name, sub);
    // "enter" badge that pops when the van is close
    const badge = new Graphics();
    badge.roundRect(-70, -22, 140, 40, 20).fill("#FFF9F0").stroke({ color: "#8A6448", width: 3 });
    const bt = new Text({ text: t.real ? "▲ Enter town" : "Sample stop", style: { fontFamily: "Nunito, system-ui", fontSize: 15, fontWeight: "900", fill: "#C7601F" } });
    bt.anchor.set(0.5);
    badge.addChild(bt);
    badge.position.set(0, this.road.gate ? ROAD_Y - 330 : ROAD_Y - 240);
    badge.visible = false;
    c.addChild(badge);
    this.world.addChild(c);
    this.towns.push({ t, x, c, badge });
  }

  /** Two parcels tied onto the roof rack, drawn in the van texture's pixel space (origin = anchor 0.5, 0.92). */
  private roofParcels(W: number, H: number) {
    const g = new Graphics();
    const ox = W * 0.5, oy = H * 0.92, lw = W * 0.009;
    const rackTop = H * 0.012 - oy;
    const box = (x0: number, x1: number, h: number, bow: boolean) => {
      const l = x0 * W - ox, r = x1 * W - ox, t = rackTop - h;
      g.roundRect(l, t, r - l, h + 2, W * 0.012).fill("#D9A86C").stroke({ color: "#7A5534", width: lw });
      g.rect(l + lw, t + lw, (r - l) * 0.3, h - lw * 2).fill({ color: "#E9C08A", alpha: 0.7 }); // lit face
      g.rect(l + (r - l) * 0.46, t, (r - l) * 0.08, h + 2).fill("#B5703E"); // string
      g.rect(l, t + h * 0.45, r - l, h * 0.1).fill("#B5703E");
      if (bow) {
        const cx = l + (r - l) * 0.5;
        g.ellipse(cx - W * 0.022, t - W * 0.012, W * 0.024, W * 0.014).stroke({ color: "#B5703E", width: lw * 1.2 });
        g.ellipse(cx + W * 0.022, t - W * 0.012, W * 0.024, W * 0.014).stroke({ color: "#B5703E", width: lw * 1.2 });
      }
    };
    box(0.2, 0.42, W * 0.13, false);
    box(0.44, 0.62, W * 0.1, true);
    // a small heart tag on the big parcel
    const hx = 0.27 * W - ox, hy = rackTop - W * 0.09, s = W * 0.018;
    g.circle(hx - s * 0.5, hy - s * 0.2, s * 0.55).fill("#F58A3C");
    g.circle(hx + s * 0.5, hy - s * 0.2, s * 0.55).fill("#F58A3C");
    g.poly([hx - s * 1.02, hy, hx + s * 1.02, hy, hx, hy + s * 1.15]).fill("#F58A3C");
    return g;
  }

  // ───────────────────────────── ambient traffic and walkers ─────────────────────────────

  private walkerLayer = new Container();
  private npcLayer = new Container();
  private npcVans: { c: Container; body: Sprite; x: number; v: number; wheelsT: number }[] = [];
  private walkers: { spr: Sprite; m: string; x: number; v: number; pauseUntil: number; y: number }[] = [];

  /** A few other delivery vans (tinted) driving both ways, and animals strolling along the verge. */
  private buildNpcs() {
    // draw order: animals on the verge < NPC vans < the player's van (its own top layer)
    this.world.addChild(this.walkerLayer, this.npcLayer);
    const vt = this.road.van ?? this.art("vehicle:truck")?.tex;
    if (vt) {
      const tints = [0xbfe0ff, 0xffd3df, 0xd5efc4, 0xfff0b8, 0xe6d6ff, 0xffffff, 0xcdeee9];
      for (let i = 0; i < tints.length; i++) {
        const c = new Container();
        const shadow = new Graphics().ellipse(0, 0, 70, 10).fill({ color: "#000", alpha: 0.14 });
        const body = new Sprite(vt as Texture);
        body.anchor.set(0.5, 0.92);
        const k = 86 / vt.height;
        body.scale.set(k);
        body.tint = tints[i];
        c.addChild(shadow, body);
        const dir = i % 2 ? -1 : 1;
        const x = 600 + ((i * 2731) % Math.max(1, this.worldW - 1200));
        this.npcVans.push({ c, body, x, v: dir * (360 + ((i * 97) % 5) * 80), wheelsT: 0 });
        this.npcLayer.addChild(c);
      }
    }
    const animals = ["cat", "dog", "rabbit", "otter", "panda", "fox", "raccoon", "bird", "dog", "rabbit", "cat", "otter", "fox", "panda"];
    animals.forEach((m, i) => {
      const f0 = this.tex.baked(`mascot:${m}:side:0`) ?? this.tex.baked(`mascot:${m}:side`);
      if (!f0) return;
      const spr = new Sprite(f0.tex as Texture);
      spr.anchor.set(0.5, 0.95);
      this.walkerLayer.addChild(spr);
      const x = 300 + ((i * 1777) % Math.max(1, this.worldW - 600));
      this.walkers.push({ spr, m, x, v: (i % 2 ? -1 : 1) * (38 + (i * 13) % 34), pauseUntil: 0, y: ROAD_Y - 22 - (i % 3) * 5 });
    });
  }

  private tickNpcs(dt: number, camX: number, viewW: number) {
    for (const n of this.npcVans) {
      n.x += n.v * dt;
      if (n.x > this.worldW + 300) n.x = -300;
      if (n.x < -300) n.x = this.worldW + 300;
      const vis = n.x > camX - 300 && n.x < camX + viewW + 300;
      n.c.visible = vis;
      if (!vis) continue;
      n.wheelsT += dt;
      // the far lane: a touch higher and smaller than the player's van
      n.c.position.set(n.x, ROAD_Y + 26 + Math.sin(n.wheelsT * 20) * 0.8);
      n.body.scale.x = Math.abs(n.body.scale.x) * Math.sign(n.v);
    }
    for (const w of this.walkers) {
      if (this.t < w.pauseUntil) {
        w.spr.visible = w.x > camX - 100 && w.x < camX + viewW + 100;
        continue;
      }
      w.x += w.v * dt;
      if (w.x < 100 || w.x > this.worldW - 100 || Math.random() < dt * 0.06) {
        w.v = -w.v; // turn around now and then
        if (Math.random() < 0.5) w.pauseUntil = this.t + 1.5 + Math.random() * 3; // stop to look around
      }
      const vis = w.x > camX - 100 && w.x < camX + viewW + 100;
      w.spr.visible = vis;
      if (!vis) continue;
      const moving = this.t >= w.pauseUntil;
      const frame = moving ? Math.floor(this.t * 8 + w.x * 0.01) % 4 : 0;
      const b = this.tex.baked(`mascot:${w.m}:side:${frame}`) ?? this.tex.baked(`mascot:${w.m}:side`);
      if (b) {
        w.spr.texture = b.tex as Texture;
        const k = 46 / b.tex.height;
        w.spr.scale.set(k * Math.sign(w.v), k);
      }
      w.spr.position.set(w.x, w.y);
    }
  }

  private buildVan() {
    const b = this.road.van ? { tex: this.road.van, ax: 0.5, ay: 0.92, scale: 1 } : this.art("vehicle:truck");
    if (b) {
      const s = new Sprite(b.tex as Texture);
      s.anchor.set(0.5, 0.92);
      const k = (this.road.van ? 104 : 120) / (b.tex.height * b.scale);
      s.scale.set(b.scale * k);
      if (this.road.van) s.addChild(this.roofParcels(b.tex.width, b.tex.height));
      this.vanBody = s;
      this.van.addChild(s);
    } else {
      const g = new Graphics();
      g.roundRect(-80, -96, 112, 70, 12).fill("#F6C76C").stroke({ color: "#6B4A33", width: 4 });
      g.roundRect(24, -86, 62, 60, 14).fill("#F58A3C").stroke({ color: "#6B4A33", width: 4 });
      g.roundRect(40, -78, 36, 24, 6).fill("#CFE8F7").stroke({ color: "#6B4A33", width: 3 });
      for (const wx of [-50, 54]) {
        const w = new Graphics().circle(0, 0, 18).fill("#3A2A22").circle(0, 0, 8).fill("#D8CFC3").rect(-2, -16, 4, 10).fill("#8A8178");
        w.position.set(wx, -22);
        this.wheels.push(w);
        g.addChild(w);
      }
      this.vanBody = g;
      this.van.addChild(g);
    }
    const shadow = new Graphics().ellipse(0, 0, 90, 12).fill({ color: "#000", alpha: 0.16 });
    this.van.addChildAt(shadow, 0);
    this.van.position.set(this.x, ROAD_Y + 46);
    this.vanLayer.addChild(this.van);
  }

  // ───────────────────────────── input ─────────────────────────────

  private bindInput() {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", " "].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (k === "a" || k === "d" || k === "arrowleft" || k === "arrowright") this.auto = null;
      if ((k === "e" || k === "arrowup" || k === "w" || k === "enter") && this.near?.real) this.ev.onEnter(this.near);
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const blur = () => this.keys.clear();
    window.addEventListener("blur", blur);
    this.cleanup.push(() => window.removeEventListener("keydown", down), () => window.removeEventListener("keyup", up), () => window.removeEventListener("blur", blur));
  }

  // ───────────────────────────── frame ─────────────────────────────

  private tick(dt: number) {
    if (this.destroyed) return;
    this.t += dt;
    const left = this.keys.has("a") || this.keys.has("arrowleft") || this.touch < 0;
    const right = this.keys.has("d") || this.keys.has("arrowright") || this.touch > 0;
    const boosting = this.keys.has("shift") || this.keys.has(" ");
    let want = 0;
    if (this.auto !== null) {
      const d = this.auto - this.x;
      if (Math.abs(d) < 8 && Math.abs(this.v) < 60) {
        this.auto = null;
        this.v = 0;
      } else {
        // drive at full speed, brake in time to stop at the gate
        const stop = (this.v * this.v) / (2 * BRAKE);
        want = Math.abs(d) > stop + 10 ? Math.sign(d) : 0;
        if (!want) this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), BRAKE * dt);
      }
    } else want = (right ? 1 : 0) - (left ? 1 : 0);
    if (this.opts.attract) want = 1;
    const top = this.opts.attract ? ATTRACT_SPEED : boosting || this.auto !== null ? BOOST_SPEED : MAX_SPEED;
    if (want) {
      const braking = Math.sign(this.v) !== want && Math.abs(this.v) > 1;
      this.v += want * (braking ? BRAKE : ACCEL) * dt;
      this.v = Math.max(-top, Math.min(top, this.v));
      // auto-drive nudges back and forth at the gate: keep facing the way we were travelling
      if (!(this.auto !== null && Math.abs(this.auto - this.x) < 80)) this.dir = want as 1 | -1;
    } else if (this.auto === null) this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), FRICTION * dt);
    this.x += this.v * dt;
    if (this.x < 150) {
      this.x = 150;
      this.v = 0;
    }
    if (this.x > this.worldW - 150) {
      if (this.opts.attract) this.x = 400; // loop back to the start of the road
      else {
        this.x = this.worldW - 150;
        this.v = 0;
      }
    }

    // van pose: flip, bounce, lean, wheels, dust
    const speedK = Math.abs(this.v) / BOOST_SPEED;
    this.van.position.set(this.x, ROAD_Y + 46 + Math.sin(this.t * 22) * speedK * 2.5);
    this.vanBody.scale.x = Math.abs(this.vanBody.scale.x) * this.dir * SPRITE_FACING;
    this.vanBody.rotation = (this.dir * Math.abs(this.v) > 0 ? -0.02 : 0) * speedK * this.dir; // slight nose-up at speed
    for (const w of this.wheels) w.rotation += (this.v * dt) / 18;
    if (Math.abs(this.v) > 300 && Math.random() < speedK * 1.2) {
      const g = new Graphics().circle(0, 0, 6 + Math.random() * 6).fill({ color: "#E6DCC8", alpha: 0.8 });
      g.position.set(this.x - Math.sign(this.v) * 80, ROAD_Y + 40);
      this.world.addChild(g);
      this.dust.push({ g, vx: -Math.sign(this.v) * (60 + Math.random() * 80), vy: -20 - Math.random() * 30, life: 0 });
    }
    this.dust = this.dust.filter((d) => {
      d.life += dt;
      d.g.x += d.vx * dt;
      d.g.y += d.vy * dt;
      d.g.alpha = Math.max(0, 0.8 - d.life * 1.4);
      d.g.scale.set(1 + d.life * 1.5);
      if (d.life > 0.6) d.g.destroy();
      return d.life <= 0.6;
    });

    // camera: van slightly behind the centre, looking ahead in the travel direction
    const sw = this.app.screen.width, sh = this.app.screen.height;
    this.scale = sh / VIEW_H;
    const viewW = sw / this.scale;
    const lead = Math.max(-1, Math.min(1, this.v / MAX_SPEED)) * viewW * 0.18;
    const camX = Math.max(0, Math.min(this.worldW - viewW, this.x - viewW / 2 + lead));
    this.root.scale.set(this.scale);
    if (this.skySprite) {
      const t = this.skySprite.texture;
      const k = Math.max(viewW / t.width, VIEW_H / t.height);
      this.skySprite.scale.set(k);
      this.skySprite.position.set((viewW - t.width * k) / 2, VIEW_H - t.height * k);
    }
    this.world.x = -camX;
    this.vanLayer.x = -camX;
    for (const l of this.layers) {
      if (!l.w) continue;
      let off = -(camX * l.factor + this.t * (l.drift ?? 0)) % l.w;
      if (off > 0) off -= l.w;
      l.c.x = off;
    }

    this.tickNpcs(dt, camX, viewW);

    // towns: cull + nearest
    let best: RoadTown | null = null;
    let bd = 260;
    for (const tw of this.towns) {
      tw.c.visible = tw.x > camX - 500 && tw.x < camX + viewW + 500;
      const d = Math.abs(tw.x - this.x);
      const close = d < 220 && Math.abs(this.v) < 700;
      tw.badge.visible = close && !this.opts.attract;
      if (close) tw.badge.y = (this.road.gate ? ROAD_Y - 330 : ROAD_Y - 240) + Math.sin(this.t * 5) * 4;
      if (d < bd && Math.abs(this.v) < 700) {
        bd = d;
        best = tw.t;
      }
    }
    if (best?.id !== this.near?.id) {
      this.near = best;
      this.ev.onNear(best);
    }
    if (this.t - this.hudAt > 0.1) {
      this.hudAt = this.t;
      this.ev.onHud({ x: this.x, speed: Math.abs(this.v), worldW: this.worldW, boosting: boosting || this.auto !== null });
    }
  }

  // ───────────────────────────── public API ─────────────────────────────

  townX(id: string) {
    return this.towns.find((t) => t.t.id === id)?.x ?? null;
  }
  driveTo(id: string) {
    const x = this.townX(id);
    if (x !== null) this.auto = x;
  }
  setPedal(p: -1 | 0 | 1) {
    this.touch = p;
    if (p) this.auto = null;
  }
  setBoost(on: boolean) {
    if (on) this.keys.add("shift");
    else this.keys.delete("shift");
  }
  /** Start position (e.g. returning from a town). */
  placeAt(id: string) {
    const x = this.townX(id);
    if (x !== null) this.x = x;
  }

  destroy() {
    this.destroyed = true;
    for (const c of this.cleanup) c();
    try {
      this.app.destroy({ removeView: true }, { children: true });
    } catch {
      /* not mounted */
    }
  }
}
