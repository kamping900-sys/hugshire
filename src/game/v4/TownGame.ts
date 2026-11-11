/**
 * Level 2: a detailed, shared town. Rendering only; the server owns all state (projects, progress,
 * presence). Static scenery is drawn once into containers; only characters, progress bars and glow
 * effects update per frame. Off-screen characters are culled.
 */
import { Application, Container, Graphics, Sprite, Text, TilingSprite, type FederatedPointerEvent, type Texture } from "pixi.js";
import { WorldTextures, type Baked } from "@/game/world/worldArt";
import type { Mascot } from "@/game/world/mascots";
import { BLUEPRINTS, TOWN_CELL as C, TOWN_H, TOWN_W, stageOf, townLayout, type Plot, type TownLayout } from "./town";

export type TownProject = {
  id: string;
  plotKey: string;
  blueprintKey: string;
  status: string;
  woodRequired: string | bigint;
  stoneRequired: string | bigint;
  woodContributed: string | bigint;
  stoneContributed: string | bigint;
  contributors: number;
};
export type Other = { key: string; mascot: string; nickname: string; x: number; y: number; dir: string; working: boolean };
export type TreeView = { fruits: number; buds: number; golden: number };
export type Interactable = { kind: "plot"; plot: Plot } | { kind: "board" } | { kind: "tree" };

type Ev = { onNear: (i: Interactable | null) => void; onInteract: (i: Interactable) => void };

const W = TOWN_W * C, H = TOWN_H * C;
const big = (v: string | bigint) => (typeof v === "bigint" ? v : BigInt(v));
export const progressOf = (p: TownProject) => {
  const need = big(p.woodRequired) + big(p.stoneRequired);
  return need > 0n ? Number(((big(p.woodContributed) + big(p.stoneContributed)) * 10000n) / need) / 10000 : 0;
};

type Char = { spr: Sprite; label: Text | null; x: number; y: number; tx: number; ty: number; mascot: Mascot; side: boolean; back: boolean; flip: number; walking: boolean; working?: boolean; seen: number; wanderAt?: number };

export class TownGame {
  private app = new Application();
  private tex!: WorldTextures;
  private world = new Container();
  private ground = new Container();
  private objects = new Container();
  private fx = new Container();
  private plotLayer = new Map<string, Container>();
  private bars = new Map<string, Graphics>();
  private layout: TownLayout;
  private me!: Char;
  private others = new Map<string, Char>();
  private folk: Char[] = [];
  private keys = new Set<string>();
  private target: { x: number; y: number } | null = null;
  private zoom = 1;
  private destroyed = false;
  private paused = false;
  private near: Interactable | null = null;
  private projects = new Map<string, TownProject>();
  private tree = { fruits: 0, buds: 0, golden: 0 };
  private treeC = new Container();
  private boardBadge = new Graphics();
  private blocked: Uint8Array;
  private t = 0;

  constructor(seed: number, private mascot: Mascot, private nickname: string, private ev: Ev) {
    this.layout = townLayout(seed);
    this.blocked = new Uint8Array(TOWN_W * TOWN_H);
  }

  async mount(el: HTMLElement) {
    const low = (navigator.hardwareConcurrency ?? 8) <= 4 || matchMedia("(pointer: coarse)").matches;
    await this.app.init({ resizeTo: el, background: "#A9D18E", antialias: !low, resolution: Math.min(window.devicePixelRatio || 1, low ? 1.25 : 2), autoDensity: true, preference: "webgl" });
    if (this.destroyed) return this.app.destroy({ removeView: true });
    el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = "none";
    this.tex = new WorldTextures(this.app.renderer);
    await this.tex.loadManifest();
    if (this.destroyed) return;
    this.world.addChild(this.ground, this.objects, this.fx);
    this.objects.sortableChildren = true;
    this.app.stage.addChild(this.world);
    this.drawGround();
    this.drawScenery();
    this.drawBoard();
    this.drawTree();
    for (const p of this.layout.plots) this.renderPlot(p);
    const e = this.layout.entrance;
    this.me = this.makeChar(this.mascot, e.x * C + 16, (e.y - 2) * C, this.nickname, true);
    for (let k = 0; k < 4; k++) {
      const m = (["rabbit", "otter", "panda", "bird"] as Mascot[])[k];
      const p = this.randomFree();
      const f = this.makeChar(m, p.x, p.y, null, false);
      f.wanderAt = 0;
      this.folk.push(f);
    }
    this.bindInput();
    this.app.ticker.add((tk) => this.tick(tk.deltaMS / 1000));
    this.zoom = Math.min(1.25, Math.max(0.7, this.app.screen.width / 1100));
  }

  // ───────────────────────────── drawing ─────────────────────────────

  private tile(tex: Texture | undefined, color: string, x: number, y: number, w: number, h: number) {
    if (tex) {
      const s = new TilingSprite({ texture: tex, width: w, height: h });
      s.position.set(x, y);
      s.tileScale.set(0.5);
      this.ground.addChild(s);
    } else this.ground.addChild(new Graphics().rect(x, y, w, h).fill(color));
  }

  private drawGround() {
    const g = this.tex.ground;
    this.tile(g.grass, "#A9D18E", 0, 0, W, H);
    // soft edge darkening
    const edge = new Graphics();
    for (let i = 0; i < 6; i++) edge.rect(-i * 6, -i * 6, W + i * 12, H + i * 12).stroke({ color: "#5E8C4A", width: 6, alpha: 0.05 });
    this.ground.addChild(edge);
    for (const r of this.layout.roads) {
      const pad = new Graphics().roundRect(r.x * C - 5, r.y * C - 5, r.w * C + 10, r.h * C + 10, 10).fill({ color: "#C9A77C", alpha: 0.55 });
      this.ground.addChild(pad);
      this.tile(g.path, "#E8D3B0", r.x * C, r.y * C, r.w * C, r.h * C);
    }
    // plaza around the notice board and heart tree
    const nb = this.layout.noticeBoard, ht = this.layout.heartTree;
    this.ground.addChild(new Graphics().roundRect(nb.x * C - 70, nb.y * C - 50, 140, 100, 26).fill({ color: "#E9D9BD" }).stroke({ color: "#C9A77C", width: 3 }));
    this.ground.addChild(new Graphics().circle(ht.x * C + 16, ht.y * C + 16, 92).fill({ color: "#B9DE9C" }).stroke({ color: "#8FBF73", width: 4 }));
    // pond with a wobbly bank
    const pd = this.layout.pond;
    const pond = new Graphics();
    const pts: number[] = [];
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const rr = (pd.r + 0.6 + Math.sin(a * 3) * 0.25) * C;
      pts.push(pd.x * C + Math.cos(a) * rr * 1.3, pd.y * C + Math.sin(a) * rr);
    }
    pond.poly(pts).fill("#CFE3B0").stroke({ color: "#9CC27F", width: 4 });
    const inner = pts.map((v, i) => (i % 2 ? pd.y * C + (v - pd.y * C) * 0.8 : pd.x * C + (v - pd.x * C) * 0.82));
    pond.poly(inner).fill("#8CCBE0").stroke({ color: "#6BB1CB", width: 3 });
    this.ground.addChild(pond);
    for (const r of this.layout.roads) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) void 0;
    // collision: pond
    for (let x = 0; x < TOWN_W; x++) for (let y = 0; y < TOWN_H; y++) if (Math.hypot((x - pd.x) / 1.3, y - pd.y) < pd.r + 0.4) this.blocked[y * TOWN_W + x] = 1;
  }

  private sprite(b: Baked, x: number, y: number, s = 1) {
    const sp = new Sprite(b.tex);
    sp.anchor.set(b.ax, b.ay);
    sp.scale.set(b.scale * s);
    sp.position.set(x, y);
    sp.zIndex = y;
    return sp;
  }

  private drawScenery() {
    const kinds = ["tree", "pine", "blossom", "autumn"] as const;
    for (const t of this.layout.trees) {
      const sp = this.sprite(this.tex.prop(kinds[t.v % 4] as never, t.v), t.x * C + 16, t.y * C + 28, 0.95 + (t.v % 3) * 0.08);
      this.objects.addChild(sp);
      this.blocked[t.y * TOWN_W + t.x] = 1;
    }
    const fk = ["flowers", "bushFlower", "bush", "mushroom", "flowers"] as const;
    for (const f of this.layout.flowers) {
      const sp = this.sprite(this.tex.prop(fk[f.v] as never, f.v), f.x * C + 16, f.y * C + 26, 0.7);
      this.objects.addChild(sp);
    }
    // lamps and benches along the main street
    for (let x = 4; x < TOWN_W - 2; x += 9) {
      this.objects.addChild(this.sprite(this.tex.prop("lamp" as never, 0), x * C, 18.6 * C, 0.8));
      this.objects.addChild(this.sprite(this.tex.prop("lamp" as never, 1), x * C + 3 * C, 22.6 * C, 0.8));
    }
    this.objects.addChild(this.sprite(this.tex.prop("fountain" as never, 0), 30 * C, 25.4 * C, 0.9));
    this.objects.addChild(this.sprite(this.tex.prop("bench" as never, 0), 33 * C, 31.5 * C, 0.8));
    this.objects.addChild(this.sprite(this.tex.prop("well" as never, 0), 51 * C, 24 * C, 0.8));
    this.objects.addChild(this.sprite(this.tex.prop("signpost" as never, 0), 32 * C, 40 * C, 0.8));
  }

  private drawBoard() {
    const b = this.layout.noticeBoard;
    const c = new Container();
    const g = new Graphics();
    g.ellipse(0, 2, 44, 9).fill({ color: "#000", alpha: 0.12 });
    g.rect(-36, -58, 7, 60).fill("#8A6448");
    g.rect(29, -58, 7, 60).fill("#8A6448");
    g.roundRect(-46, -92, 92, 54, 8).fill("#C98A4A").stroke({ color: "#6B4A33", width: 3 });
    g.roundRect(-40, -86, 80, 42, 5).fill("#E9C99A");
    g.roundRect(-34, -82, 26, 18, 2).fill("#FFF9F0");
    g.roundRect(-4, -84, 22, 22, 2).fill("#FDE6D4");
    g.roundRect(20, -80, 16, 14, 2).fill("#DCEFF9");
    g.roundRect(-26, -60, 30, 12, 2).fill("#FFF9F0");
    for (const [x, y] of [[-21, -82], [7, -84], [28, -80], [-11, -60]]) g.circle(x, y, 2.4).fill("#E2523F");
    g.poly([-52, -92, 0, -112, 52, -92]).fill("#E46F3E").stroke({ color: "#6B4A33", width: 3 });
    c.addChild(g);
    const t = new Text({ text: "NOTICE BOARD", style: { fontFamily: "Nunito, system-ui, sans-serif", fontSize: 11, fontWeight: "900", fill: "#3A2A22" } });
    t.anchor.set(0.5);
    t.position.set(0, -27);
    c.addChild(t);
    this.boardBadge.circle(0, 0, 12).fill("#E2523F").stroke({ color: "#FFF9F0", width: 3 });
    const ex = new Text({ text: "!", style: { fontFamily: "Nunito, system-ui", fontSize: 16, fontWeight: "900", fill: "#FFF" } });
    ex.anchor.set(0.5);
    this.boardBadge.addChild(ex);
    this.boardBadge.position.set(44, -108);
    this.boardBadge.visible = false;
    c.addChild(this.boardBadge);
    c.position.set(b.x * C + 16, b.y * C + 24);
    c.zIndex = b.y * C + 24;
    this.objects.addChild(c);
    this.blocked[b.y * TOWN_W + b.x] = 1;
  }

  private drawTree() {
    const p = this.layout.heartTree;
    this.treeC.position.set(p.x * C + 16, p.y * C + 30);
    this.treeC.zIndex = p.y * C + 30;
    this.objects.addChild(this.treeC);
    this.blocked[p.y * TOWN_W + p.x] = 1;
    this.redrawTree();
  }

  private redrawTree() {
    this.treeC.removeChildren().forEach((c) => c.destroy());
    const g = new Graphics();
    g.ellipse(0, 2, 70, 16).fill({ color: "#000", alpha: 0.12 });
    g.poly([-14, 0, -9, -70, 9, -70, 14, 0]).fill("#9C6B45").stroke({ color: "#6B4A33", width: 3 });
    g.poly([-6, -40, -30, -66, -26, -70, -2, -50]).fill("#9C6B45");
    const leaves = [[0, -118, 62], [-46, -92, 42], [46, -92, 42], [-28, -140, 36], [30, -140, 36], [0, -78, 40]];
    for (const [x, y, r] of leaves) g.circle(x, y + 3, r).fill("#5E9C4F");
    for (const [x, y, r] of leaves) g.circle(x, y, r).fill("#7CBF64");
    for (const [x, y, r] of leaves) g.circle(x - r * 0.25, y - r * 0.3, r * 0.45).fill({ color: "#A6D98A", alpha: 0.6 });
    this.treeC.addChild(g);
    const spots = [[-40, -100], [-12, -130], [22, -122], [48, -96], [-30, -72], [10, -92], [36, -140], [-52, -122], [-6, -156], [56, -118], [-20, -104], [28, -76]];
    const glow = new Graphics();
    this.treeC.addChild(glow);
    let k = 0;
    const heart = (x: number, y: number, s: number, color: string, outline: string) => {
      const h = new Graphics();
      h.circle(-s * 0.5, -s * 0.2, s * 0.55).fill(color);
      h.circle(s * 0.5, -s * 0.2, s * 0.55).fill(color);
      h.poly([-s * 1.02, 0, s * 1.02, 0, 0, s * 1.15]).fill(color);
      h.circle(-s * 0.5, -s * 0.2, s * 0.55).stroke({ color: outline, width: 1.5 });
      h.circle(s * 0.5, -s * 0.2, s * 0.55).stroke({ color: outline, width: 1.5 });
      h.circle(-s * 0.55, -s * 0.38, s * 0.2).fill({ color: "#FFF", alpha: 0.7 });
      h.position.set(x, y);
      h.label = "fruit";
      this.treeC.addChild(h);
      glow.circle(x, y, s * 2.1).fill({ color, alpha: 0.18 });
    };
    for (let i = 0; i < this.tree.golden && k < spots.length; i++, k++) heart(spots[k][0], spots[k][1], 10, "#F6C445", "#B88A1E");
    for (let i = 0; i < this.tree.fruits && k < spots.length; i++, k++) heart(spots[k][0], spots[k][1], 9, "#E2523F", "#9E2E22");
    for (let i = 0; i < this.tree.buds && k < spots.length; i++, k++) heart(spots[k][0], spots[k][1], 5, "#F4B6A8", "#C98378");
    const label = new Text({ text: "Your Heart Tree", style: { fontFamily: "Nunito, system-ui", fontSize: 12, fontWeight: "900", fill: "#3A2A22", stroke: { color: "#FFF9F0", width: 4 } } });
    label.anchor.set(0.5);
    label.position.set(0, 22);
    this.treeC.addChild(label);
  }

  private renderPlot(p: Plot) {
    const old = this.plotLayer.get(p.key);
    if (old) old.destroy({ children: true });
    this.bars.delete(p.key);
    const c = new Container();
    const x = p.x * C, y = p.y * C, w = p.w * C, h = p.h * C;
    const proj = [...this.projects.values()].find((q) => q.plotKey === p.key);
    const g = new Graphics();
    // footprint clearance for collision
    for (let i = p.x; i < p.x + p.w; i++) for (let j = p.y; j < p.y + p.h; j++) this.blocked[j * TOWN_W + i] = proj ? 1 : 0;
    if (!proj) {
      g.roundRect(x + 6, y + 6, w - 12, h - 12, 14).fill({ color: "#D9C29B", alpha: 0.55 });
      for (let i = 0; i < (w + h) * 2; i += 22) {
        const per = 2 * (w - 24) + 2 * (h - 24);
        const d = i % per;
        let px = 0, py = 0;
        if (d < w - 24) [px, py] = [x + 12 + d, y + 12];
        else if (d < w - 24 + h - 24) [px, py] = [x + w - 12, y + 12 + d - (w - 24)];
        else if (d < 2 * (w - 24) + h - 24) [px, py] = [x + w - 12 - (d - (w - 24) - (h - 24)), y + h - 12];
        else [px, py] = [x + 12, y + h - 12 - (d - 2 * (w - 24) - (h - 24))];
        g.circle(px, py, 3).fill("#A9865E");
      }
      c.addChild(g);
      const sign = this.sprite(this.tex.prop("signpost" as never, 0), x + w / 2, y + h / 2 + 18, 0.75);
      c.addChild(sign);
      const t = new Text({ text: `${p.size === "S" ? "Small" : p.size === "M" ? "Medium" : "Large"} plot · free`, style: { fontFamily: "Nunito, system-ui", fontSize: 11, fontWeight: "800", fill: "#6B4A33" } });
      t.anchor.set(0.5);
      t.position.set(x + w / 2, y + h - 22);
      c.addChild(t);
    } else {
      const bp = BLUEPRINTS.find((b) => b.key === proj.blueprintKey);
      const prog = progressOf(proj);
      const stage = stageOf(prog, proj.status);
      const art = bp ? this.tex.baked(bp.sprite) : undefined;
      g.roundRect(x + 4, y + 4, w - 8, h - 8, 12).fill({ color: "#CDB48C", alpha: stage === 4 ? 0.25 : 0.7 });
      c.addChild(g);
      const cx = x + w / 2, by = y + h - 10;
      const fit = art ? Math.min((w * 0.95) / (art.tex.width * art.scale), (h * 1.5) / (art.tex.height * art.scale)) : 1;
      if (stage >= 1) {
        const f = new Graphics();
        f.roundRect(x + 14, y + h * 0.45, w - 28, h * 0.5, 6).fill("#B9AFA3").stroke({ color: "#7E7469", width: 3 });
        for (let i = x + 22; i < x + w - 20; i += 18) f.rect(i, y + h * 0.45 + 4, 12, 7).fill({ color: "#9C9186", alpha: 0.8 });
        c.addChild(f);
      }
      if (art && stage >= 2) {
        const sp = this.sprite(art, cx, by, fit);
        if (stage < 4) {
          // the building rises from the ground as resources arrive
          const m = new Graphics();
          const full = art.tex.height * art.scale * fit;
          const shown = stage === 2 ? 0.25 + (prog - 0.25) * 0.9 : 0.7 + (prog - 0.75) * 1.2;
          m.rect(x - 40, by - full * Math.min(1, shown), w + 80, full * Math.min(1, shown) + 4).fill("#fff");
          c.addChild(m);
          sp.mask = m;
          sp.alpha = stage === 2 ? 0.92 : 0.97;
        }
        c.addChild(sp);
      }
      if (stage === 2 || stage === 3) {
        const s = new Graphics();
        const top = y - (stage === 2 ? h * 0.2 : h * 0.55);
        for (let i = x + 12; i <= x + w - 12; i += (w - 24) / 3) s.rect(i - 2.5, top, 5, by - top).fill("#B07A4A");
        for (let j = top + 14; j < by; j += 26) s.rect(x + 8, j, w - 16, 4).fill("#C98A4A");
        s.poly([x + 12, by, x + w / 2, top + 14, x + w / 2 + 5, top + 14, x + 17, by]).fill({ color: "#9C6B45", alpha: 0.6 });
        c.addChild(s);
        const crane = this.sprite(this.tex.prop("boxes" as never, 0), x + w - 18, by + 4, 0.6);
        c.addChild(crane);
      }
      if (stage < 4) {
        const bar = new Graphics();
        this.bars.set(p.key, bar);
        c.addChild(bar);
        this.drawBar(bar, x + w / 2, y - 10, proj);
      }
      const name = new Text({ text: `${bp?.name ?? "Building"}${stage === 4 ? "" : ` · ${Math.floor(prog * 100)}%`}`, style: { fontFamily: "Nunito, system-ui", fontSize: 12, fontWeight: "900", fill: "#3A2A22", stroke: { color: "#FFF9F0", width: 4 } } });
      name.anchor.set(0.5);
      name.position.set(x + w / 2, stage === 4 ? by + 14 : y - 26);
      c.addChild(name);
    }
    c.zIndex = y + h - 8;
    this.objects.addChild(c);
    this.plotLayer.set(p.key, c);
  }

  private drawBar(g: Graphics, cx: number, y: number, p: TownProject) {
    g.clear();
    const bw = 120;
    const wood = Number((big(p.woodContributed) * 1000n) / (big(p.woodRequired) || 1n)) / 1000;
    const stone = Number((big(p.stoneContributed) * 1000n) / (big(p.stoneRequired) || 1n)) / 1000;
    g.roundRect(cx - bw / 2 - 3, y - 3, bw + 6, 20, 8).fill({ color: "#FFF9F0", alpha: 0.95 }).stroke({ color: "#8A6448", width: 2 });
    g.roundRect(cx - bw / 2, y, bw, 6, 3).fill("#EADCC8");
    g.roundRect(cx - bw / 2, y, Math.max(3, bw * wood), 6, 3).fill("#C98A4A");
    g.roundRect(cx - bw / 2, y + 8, bw, 6, 3).fill("#EADCC8");
    g.roundRect(cx - bw / 2, y + 8, Math.max(3, bw * stone), 6, 3).fill("#9AA3AD");
  }

  // ───────────────────────────── characters ─────────────────────────────

  private mascotTex(m: Mascot, pose: "front" | "back" | "side", frame: number) {
    return this.tex.mascot(m, 0, pose === "back", pose === "side", frame);
  }

  private makeChar(m: Mascot, x: number, y: number, label: string | null, mine: boolean): Char {
    const b = this.mascotTex(m, "front", -1);
    const spr = this.sprite(b, x, y, 0.62);
    this.objects.addChild(spr);
    let t: Text | null = null;
    if (label) {
      t = new Text({ text: label, style: { fontFamily: "Nunito, system-ui", fontSize: 11, fontWeight: "900", fill: mine ? "#C7601F" : "#3A2A22", stroke: { color: "#FFF9F0", width: 4 } } });
      t.anchor.set(0.5, 1);
      this.objects.addChild(t);
    }
    return { spr, label: t, x, y, tx: x, ty: y, mascot: m, side: false, back: false, flip: 1, walking: false, seen: performance.now() };
  }

  private poseChar(ch: Char, dt: number) {
    const pose = ch.side ? "side" : ch.back ? "back" : "front";
    const wf = ch.walking ? Math.floor(this.t * 8 + ch.x * 0.01) % 4 : -1;
    const b = this.mascotTex(ch.mascot, pose, wf);
    ch.spr.texture = b.tex;
    ch.spr.anchor.set(b.ax, b.ay);
    const bob = ch.walking ? -Math.abs(Math.sin(this.t * 9 + ch.x * 0.05)) * (b.walk ? 1 : 3) : 0;
    const work = ch.working ? Math.sin(this.t * 14) * 0.06 : 0;
    ch.spr.scale.set(b.scale * 0.62 * (ch.side ? ch.flip : 1), b.scale * 0.62 * (1 + work));
    ch.spr.position.set(ch.x, ch.y + bob);
    ch.spr.zIndex = ch.y;
    if (ch.label) {
      ch.label.position.set(ch.x, ch.y - 58);
      ch.label.zIndex = ch.y + 1;
    }
    void dt;
  }

  private walkable(px: number, py: number) {
    if (px < 8 || py < 8 || px > W - 8 || py > H - 4) return false;
    const cx = Math.floor(px / C), cy = Math.floor((py - 4) / C);
    return !this.blocked[cy * TOWN_W + cx];
  }

  private randomFree() {
    for (let k = 0; k < 200; k++) {
      const r = this.layout.roads[k % this.layout.roads.length];
      const x = (r.x + Math.random() * r.w) * C, y = (r.y + Math.random() * r.h) * C + 16;
      if (this.walkable(x, y)) return { x, y };
    }
    return { x: W / 2, y: H / 2 };
  }

  private moveChar(ch: Char, dx: number, dy: number, speed: number, dt: number) {
    const len = Math.hypot(dx, dy);
    if (len < 0.01) {
      ch.walking = false;
      return;
    }
    const nx = ch.x + (dx / len) * speed * dt, ny = ch.y + (dy / len) * speed * dt;
    // standing inside something that was just built: always allowed to walk out
    const free = !this.walkable(ch.x, ch.y);
    if (free || this.walkable(nx, ch.y)) ch.x = nx;
    if (free || this.walkable(ch.x, ny)) ch.y = ny;
    ch.walking = true;
    if (Math.abs(dx) > Math.abs(dy)) {
      ch.side = true;
      ch.back = false;
      ch.flip = dx < 0 ? -1 : 1;
    } else {
      ch.side = false;
      ch.back = dy < 0;
    }
  }

  // ───────────────────────────── input ─────────────────────────────

  private bindInput() {
    const down = (e: KeyboardEvent) => {
      if (this.paused || (e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if ((k === "e" || k === "enter") && this.near) this.ev.onInteract(this.near);
      this.target = null;
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    this.cleanup.push(() => window.removeEventListener("keydown", down), () => window.removeEventListener("keyup", up));
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointertap", (e: FederatedPointerEvent) => {
      if (this.paused) return;
      const p = this.world.toLocal(e.global);
      const hit = this.hitTest(p.x, p.y);
      if (hit) {
        const d = this.distTo(hit);
        if (d < 90) return this.ev.onInteract(hit);
      }
      this.target = { x: p.x, y: p.y + (hit ? 30 : 0) };
    });
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom = Math.max(0.55, Math.min(1.8, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    };
    this.app.canvas.addEventListener("wheel", wheel, { passive: false });
  }
  private cleanup: (() => void)[] = [];

  private hitTest(x: number, y: number): Interactable | null {
    const b = this.layout.noticeBoard, t = this.layout.heartTree;
    if (Math.abs(x - (b.x * C + 16)) < 50 && y > b.y * C - 100 && y < b.y * C + 30) return { kind: "board" };
    if (Math.hypot(x - (t.x * C + 16), y - (t.y * C - 80)) < 90) return { kind: "tree" };
    const p = this.layout.plots.find((q) => x >= q.x * C && x < (q.x + q.w) * C && y >= q.y * C - 40 && y < (q.y + q.h) * C);
    return p ? { kind: "plot", plot: p } : null;
  }

  private distTo(i: Interactable) {
    const m = this.me;
    if (i.kind === "board") return Math.hypot(m.x - (this.layout.noticeBoard.x * C + 16), m.y - (this.layout.noticeBoard.y * C + 30));
    if (i.kind === "tree") return Math.hypot(m.x - (this.layout.heartTree.x * C + 16), m.y - (this.layout.heartTree.y * C + 34));
    const p = i.plot;
    const cx = Math.max(p.x * C, Math.min((p.x + p.w) * C, m.x)), cy = Math.max(p.y * C, Math.min((p.y + p.h) * C, m.y));
    return Math.hypot(m.x - cx, m.y - cy);
  }

  // ───────────────────────────── frame ─────────────────────────────

  private tick(dt: number) {
    if (this.destroyed) return;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const m = this.me;
    if (!this.paused) {
      let dx = 0, dy = 0;
      if (this.keys.has("a") || this.keys.has("arrowleft")) dx--;
      if (this.keys.has("d") || this.keys.has("arrowright")) dx++;
      if (this.keys.has("w") || this.keys.has("arrowup")) dy--;
      if (this.keys.has("s") || this.keys.has("arrowdown")) dy++;
      if (!dx && !dy && this.target) {
        dx = this.target.x - m.x;
        dy = this.target.y - m.y;
        if (Math.hypot(dx, dy) < 6) {
          this.target = null;
          dx = dy = 0;
        }
      }
      const before = { x: m.x, y: m.y };
      this.moveChar(m, dx, dy, 190, dt);
      if (this.target && before.x === m.x && before.y === m.y && (dx || dy)) this.target = null; // blocked
    } else m.walking = false;
    this.poseChar(m, dt);

    // town folk wander between road points
    for (const f of this.folk) {
      if (!f.wanderAt || this.t > f.wanderAt) {
        const p = this.randomFree();
        f.tx = p.x;
        f.ty = p.y;
        f.wanderAt = this.t + 6 + Math.random() * 8;
      }
      const ddx = f.tx - f.x, ddy = f.ty - f.y;
      if (Math.hypot(ddx, ddy) > 8) this.moveChar(f, ddx, ddy, 60, dt);
      else f.walking = false;
      this.poseChar(f, dt);
    }
    // other players interpolate toward their last reported position
    const now = performance.now();
    for (const [k, o] of this.others) {
      if (now - o.seen > 15_000) {
        o.spr.destroy();
        o.label?.destroy();
        this.others.delete(k);
        continue;
      }
      const ddx = o.tx - o.x, ddy = o.ty - o.y;
      const d = Math.hypot(ddx, ddy);
      if (d > 300) {
        o.x = o.tx;
        o.y = o.ty;
      } else if (d > 3) {
        const step = Math.min(d, 220 * dt);
        o.x += (ddx / d) * step;
        o.y += (ddy / d) * step;
        o.walking = true;
        if (Math.abs(ddx) > Math.abs(ddy)) {
          o.side = true;
          o.flip = ddx < 0 ? -1 : 1;
          o.back = false;
        } else {
          o.side = false;
          o.back = ddy < 0;
        }
      } else o.walking = false;
      this.poseChar(o, dt);
    }

    // tree glow pulse
    for (const c of this.treeC.children) if (c.label === "fruit") c.scale.set(1 + Math.sin(this.t * 3 + c.x) * 0.06);
    this.boardBadge.scale.set(1 + Math.sin(this.t * 5) * 0.08);

    // nearest interactable
    let best: Interactable | null = null;
    let bd = 80;
    const cands: Interactable[] = [{ kind: "board" }, { kind: "tree" }, ...this.layout.plots.map((p) => ({ kind: "plot" as const, plot: p }))];
    for (const c of cands) {
      const d = this.distTo(c);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    const same = (a: Interactable | null, b: Interactable | null) => a?.kind === b?.kind && (a?.kind !== "plot" || (b?.kind === "plot" && a.plot.key === b.plot.key));
    if (!same(best, this.near)) {
      this.near = best;
      this.ev.onNear(best);
    }

    // camera
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const z = this.zoom;
    let cx = m.x * z - sw / 2, cy = (m.y - 40) * z - sh / 2;
    cx = Math.max(-40, Math.min(W * z - sw + 40, cx));
    cy = Math.max(-40, Math.min(H * z - sh + 40, cy));
    if (W * z < sw) cx = (W * z - sw) / 2;
    if (H * z < sh) cy = (H * z - sh) / 2;
    this.world.scale.set(z);
    this.world.position.set(-cx, -cy);
  }

  // ───────────────────────────── public API ─────────────────────────────

  setProjects(list: TownProject[]) {
    if (!this.tex) return;
    const next = new Map(list.map((p) => [p.plotKey, p]));
    for (const plot of this.layout.plots) {
      const a = [...this.projects.values()].find((q) => q.plotKey === plot.key);
      const b = next.get(plot.key);
      const changed = !a !== !b || (a && b && (a.id !== b.id || a.status !== b.status || stageOf(progressOf(a), a.status) !== stageOf(progressOf(b), b.status)));
      const progressMoved = a && b && !changed && progressOf(a) !== progressOf(b);
      if (changed) {
        this.projects = new Map(list.map((p) => [p.id, p]));
        this.renderPlot(plot);
      } else if (progressMoved) {
        this.projects = new Map(list.map((p) => [p.id, p]));
        this.renderPlot(plot);
      }
    }
    this.projects = new Map(list.map((p) => [p.id, p]));
  }

  setOthers(list: Other[]) {
    if (!this.tex) return;
    const seen = performance.now();
    for (const o of list) {
      let c = this.others.get(o.key);
      if (!c) {
        c = this.makeChar((o.mascot as Mascot) ?? "cat", o.x, o.y, o.nickname, false);
        this.others.set(o.key, c);
      }
      c.tx = o.x;
      c.ty = o.y;
      c.working = o.working;
      c.seen = seen;
    }
  }

  setTree(t: TreeView) {
    if (t.fruits === this.tree.fruits && t.buds === this.tree.buds && t.golden === this.tree.golden) return;
    this.tree = { ...t };
    if (this.tex) this.redrawTree();
  }

  setBoardNew(v: boolean) {
    this.boardBadge.visible = v;
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.keys.clear();
    this.target = null;
  }

  position() {
    return this.me ? { x: Math.round(this.me.x), y: Math.round(this.me.y), dir: this.me.side ? (this.me.flip < 0 ? "sideL" : "side") : this.me.back ? "back" : "front" } : null;
  }

  destroy() {
    this.destroyed = true;
    for (const c of this.cleanup) c();
    try {
      this.app.destroy({ removeView: true }, { children: true }); // never release Pixi globals: other apps may be alive
    } catch {
      /* not mounted yet */
    }
  }
}
