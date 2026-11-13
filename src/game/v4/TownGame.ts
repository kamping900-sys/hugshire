/**
 * Level 2: a detailed, shared town. Rendering only; the server owns all state (projects, progress,
 * presence). Static scenery is drawn once into containers; only characters, progress bars and glow
 * effects update per frame. Off-screen characters are culled.
 */
import { Application, Assets, Container, Graphics, Sprite, Text, TilingSprite, type FederatedPointerEvent, type Texture } from "pixi.js";
import { WorldTextures, type Baked } from "@/game/world/worldArt";
import type { Mascot } from "@/game/world/mascots";
import { BLUEPRINTS, BUILDABLE, DECOR, isRiver, TOWN_CELL as C, TOWN_H, TOWN_W, stageOf, townLayout, type Plot, type TownLayout } from "./town";

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
/** What the arrival tutorial can point the camera at. */
export type FocusKind = "tree" | "board" | "plot";

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
  /** Plot ground (pads, dotted outlines, labels) is drawn below every character and object. */
  private plotsUnder = new Container();
  private plotUnder = new Map<string, Container>();
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
  /** Construction-stage art per blueprint: [stage1, stage2, stage3, complete]. */
  private stageTex = new Map<string, Texture[]>();
  // arrival tutorial: camera focus, helper drop-in, walked distance
  private focusKind: FocusKind | null = null;
  private camX: number | null = null;
  private camY = 0;
  private drop: { t: number; resolve: () => void; landedAt: number | null } | null = null;
  private dropShadow: Graphics | null = null;
  private baseZoom = 1;
  private zoomEase: { from: number; to: number; t: number; dur: number } | null = null;
  private walked = 0;
  private puffs: { g: Graphics; t: number; vx: number; vy: number }[] = [];
  // "you can interact with this" highlight: a glowing ring on the ground, a bouncing arrow and an [E] bubble
  private hlRing = new Graphics();
  private hlTop = new Container();
  private hlArrow = new Graphics();
  private hlBubble = new Container();
  private hlLabel = "";
  private hlText: Text | null = null;

  constructor(seed: number, private mascot: Mascot, private nickname: string, private ev: Ev, private opts: { arrival?: boolean } = {}) {
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
    await this.loadStages();
    await this.loadTownArt();
    if (this.destroyed) return;
    this.world.addChild(this.ground, this.plotsUnder, this.objects, this.fx);
    this.objects.sortableChildren = true;
    this.app.stage.addChild(this.world);
    this.drawGround();
    this.drawScenery();
    this.drawBoard();
    this.drawTree();
    for (const p of this.layout.plots) this.renderPlot(p);
    const e = this.layout.entrance;
    this.me = this.makeChar(this.mascot, e.x * C + 16, (e.y - 2) * C, this.nickname, true);
    if (this.opts.arrival) {
      // the helper is still "in the sky": it floats down onto the plaza when the tutorial calls dropIn()
      const pz = this.layout.plaza;
      const spots = [
        { x: (pz.x + pz.w / 2) * C, y: (pz.y + pz.h - 1.5) * C },
        { x: (pz.x + 1.5) * C, y: (pz.y + pz.h / 2) * C },
        { x: (pz.x + pz.w - 1.5) * C, y: (pz.y + pz.h / 2) * C },
      ];
      const land = spots.find((q) => this.walkable(q.x, q.y));
      if (land) {
        this.me.x = this.me.tx = land.x;
        this.me.y = this.me.ty = land.y;
      }
      this.me.spr.visible = false;
      if (this.me.label) this.me.label.visible = false;
      this.paused = true;
    }
    const FOLK: Mascot[] = ["rabbit", "otter", "panda", "bird", "dog", "fox", "raccoon", "cat"];
    for (let k = 0; k < FOLK.length; k++) {
      const m = FOLK[k];
      const p = this.randomFree();
      const f = this.makeChar(m, p.x, p.y, null, false);
      f.wanderAt = 0;
      this.folk.push(f);
    }
    this.plotsUnder.addChild(this.hlRing);
    this.hlArrow.poly([-13, -8, 13, -8, 0, 10]).fill("#F58A3C").stroke({ color: "#FFF9F0", width: 4, join: "round" });
    this.hlTop.addChild(this.hlArrow, this.hlBubble);
    this.hlTop.visible = false;
    this.fx.addChild(this.hlTop);
    this.bindInput();
    this.app.ticker.add((tk) => this.tick(tk.deltaMS / 1000));
    this.zoom = Math.min(1.6, Math.max(0.95, this.app.screen.width / 800)); // a closer, cozier default view
    this.baseZoom = this.zoom;
    if (this.opts.arrival) this.zoom = Math.min(2.4, this.baseZoom * 1.9); // close-up for the arrival, eased out after landing
  }

  /** Painted Heart Tree, fruit and Notice Board (public/game/sprites/town/*.png). Optional: drawn fallbacks otherwise. */
  private townArt: Partial<Record<"tree" | "board" | "red1" | "red2" | "red3" | "gold1" | "gold2" | "bud" | "bridge", Texture>> = {};
  private async loadTownArt() {
    const files = { tree: "heart_tree", board: "notice_board", red1: "fruit_red_1", red2: "fruit_red_2", red3: "fruit_red_3", gold1: "fruit_gold_1", gold2: "fruit_gold_2", bud: "fruit_bud", bridge: "bridge" } as const;
    await Promise.all(
      Object.entries(files).map(async ([k, f]) => {
        try {
          const t = (await Assets.load(`/game/sprites/town/${f}.png`)) as Texture;
          t.source.scaleMode = "linear";
          t.source.autoGenerateMipmaps = true;
          t.source.updateMipmaps();
          this.townArt[k as keyof typeof files] = t;
        } catch {
          /* not generated: drawn fallback */
        }
      }),
    );
  }

  /** Loads public/game/sprites/stages/<key>_1..4.png for each buildable blueprint (optional). */
  private async loadStages() {
    await Promise.all(
      BUILDABLE.map(async (b) => {
        try {
          const ts = await Promise.all([1, 2, 3, 4].map((n) => Assets.load(`/game/sprites/stages/${b.key}_${n}.png`) as Promise<Texture>));
          /* smooth downscaling (mipmaps): painted art is drawn far smaller than its source */
          ts.forEach((t) => {
            t.source.scaleMode = "linear";
            t.source.autoGenerateMipmaps = true;
            t.source.updateMipmaps();
          });
          this.stageTex.set(b.key, ts);
        } catch {
          /* no stage art for this blueprint: drawn fallback */
        }
      }),
    );
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
    // meadow (same painted grass as the classic world map)
    this.tile(g.grass, "#A9D18E", -C * 4, -C * 4, W + C * 8, H + C * 8);
    // soft vignette at the edges so the meadow fades into the trees
    const edge = new Graphics();
    for (let i = 0; i < 8; i++) edge.rect(-i * 8, -i * 8, W + i * 16, H + i * 16).stroke({ color: "#4F7D3E", width: 8, alpha: 0.05 });
    this.ground.addChild(edge);

    // stone plaza
    const pz = this.layout.plaza;
    const plaza = new Graphics().roundRect(pz.x * C - 6, pz.y * C - 6, pz.w * C + 12, pz.h * C + 12, 26).fill({ color: "#C9B392", alpha: 0.6 });
    this.ground.addChild(plaza);
    if (g.plaza) {
      const t = new TilingSprite({ texture: g.plaza, width: pz.w * C, height: pz.h * C });
      t.tileScale.set(0.5);
      t.position.set(pz.x * C, pz.y * C);
      const m = new Graphics().roundRect(pz.x * C, pz.y * C, pz.w * C, pz.h * C, 22).fill("#fff");
      t.mask = m;
      this.ground.addChild(m, t);
    } else this.ground.addChild(new Graphics().roundRect(pz.x * C, pz.y * C, pz.w * C, pz.h * C, 22).fill("#E9D9BD"));
    // trodden dirt paths: entrance → plaza → heart tree, drawn as soft blobs
    const path = new Graphics();
    const dots = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.ceil((Math.hypot(x1 - x0, y1 - y0) * C) / 12);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        path.circle((x0 + (x1 - x0) * t) * C + 16 + Math.sin(i * 1.7) * 3, (y0 + (y1 - y0) * t) * C + 16, 17 + Math.sin(i * 2.3) * 3).fill({ color: "#D9C29B", alpha: 0.85 });
      }
    };
    const en = this.layout.entrance, ht = this.layout.heartTree;
    dots(en.x, en.y + 1, pz.x + pz.w / 2 - 0.5, pz.y + pz.h - 1);
    dots(pz.x, pz.y + pz.h / 2, ht.x + 2, ht.y);
    this.ground.addChildAt(path, 1);

    // river: painted water between wobbly grassy banks
    const rv = this.layout.river;
    const left: number[] = [], right: number[] = [];
    for (let y = -1; y <= TOWN_H + 1; y += 0.5) {
      const c = rv.cx[Math.max(0, Math.min(TOWN_H - 1, Math.floor(y)))] + Math.sin(y * 1.9) * 0.12;
      left.push((c - rv.width / 2) * C, y * C);
      right.unshift((c + rv.width / 2) * C, y * C);
    }
    const bank = new Graphics().poly([...left.map((v, i) => (i % 2 ? v : v - 7)), ...right.map((v, i) => (i % 2 ? v : v + 7))]).fill("#B7D69A");
    this.ground.addChild(bank);
    const water = new Graphics().poly([...left, ...right]);
    if (g.water) water.fill({ texture: g.water, color: "#FFFFFF" });
    else water.fill("#8CCBE0");
    water.stroke({ color: "#6BB1CB", width: 3 });
    this.ground.addChild(water);
    // gentle highlights on the water
    const shine = new Graphics();
    for (let y = 1; y < TOWN_H; y += 3) shine.roundRect((rv.cx[y] - 0.6) * C, y * C + 6, 22, 3, 2).fill({ color: "#FFFFFF", alpha: 0.45 });
    this.ground.addChild(shine);
    // wooden bridge
    const by0 = rv.bridgeRows[0] * C, by1 = (rv.bridgeRows[rv.bridgeRows.length - 1] + 1) * C;
    const bc = rv.cx[rv.bridgeRows[0]];
    const bx0 = (bc - rv.width / 2 - 0.7) * C, bx1 = (bc + rv.width / 2 + 0.7) * C;
    const bw = bx1 - bx0, bh = by1 - by0;
    if (this.townArt.bridge) {
      // painted bridge (public/game/sprites/town/bridge.png): a little wider than the river, rails above and below the deck
      const t = this.townArt.bridge;
      const sp = new Sprite(t);
      sp.anchor.set(0.5);
      sp.scale.set((bw * 1.4) / t.width); // even scale (no squashing), a little wider than the river
      sp.position.set((bx0 + bx1) / 2, (by0 + by1) / 2 - 4);
      this.ground.addChild(sp);
    } else {
      // drawn bridge: shadow on the water, plank deck, rails with posts
      const bridge = new Graphics();
      bridge.roundRect(bx0 + 4, by0 + 6, bw, bh + 6, 10).fill({ color: "#1E4E66", alpha: 0.25 });
      bridge.roundRect(bx0, by0 - 2, bw, bh + 4, 8).fill("#C08A55").stroke({ color: "#6B4A33", width: 3 });
      for (let x = bx0 + 3, k = 0; x < bx1 - 3; x += 11, k++) {
        bridge.rect(x, by0, 9, bh).fill(k % 2 ? "#B57C48" : "#C99460");
        bridge.rect(x + 9, by0, 2, bh).fill({ color: "#6B4A33", alpha: 0.35 });
        if (k % 3 === 1) bridge.circle(x + 4.5, by0 + 5, 1.2).circle(x + 4.5, by1 - 5, 1.2).fill("#6B4A33");
      }
      for (const ry of [by0 - 10, by1 + 4]) {
        bridge.roundRect(bx0 - 4, ry, bw + 8, 6, 3).fill("#8C5E3C").stroke({ color: "#5A3D28", width: 2 });
        for (let x = bx0; x <= bx1; x += bw / 4) bridge.roundRect(x - 3.5, ry - 4, 7, 12, 2).fill("#7A5132").stroke({ color: "#5A3D28", width: 1.5 });
      }
      this.ground.addChild(bridge);
    }
    // collision: the river (except where the bridge crosses)
    for (let x = 0; x < TOWN_W; x++) for (let y = 0; y < TOWN_H; y++) if (isRiver(this.layout, x, y) && !rv.bridgeRows.includes(y)) this.blocked[y * TOWN_W + x] = 1;

    // soft lawn under the heart tree
    this.ground.addChild(new Graphics().circle(ht.x * C + 16, ht.y * C + 16, 86).fill({ color: "#B9DE9C" }).stroke({ color: "#8FBF73", width: 4 }));
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
    const SOLID = /tree|pine|blossom|rockBig|well|fountain|stall|scarecrow|hay|lamp/;
    for (const p of this.layout.props) {
      const b = this.tex.baked(p.key) ?? this.tex.baked(p.key.replace(/:\d+$/, ""));
      if (!b) continue;
      const sp = this.sprite(b, p.x * C + 16, p.y * C + 28, p.h / (b.tex.height * b.scale));
      if (p.flip && !/lamp|fountain|well|stall|bench/.test(p.key)) sp.scale.x *= -1;
      this.objects.addChild(sp);
      if (SOLID.test(p.key)) this.blocked[p.y * TOWN_W + p.x] = 1;
    }
    // background buildings (not buildable in the MVP)
    for (const d of DECOR) {
      const b = this.tex.baked(d.sprite);
      if (!b) continue;
      this.objects.addChild(this.sprite(b, d.x * C + 16, (d.y + 1) * C, d.h / (b.tex.height * b.scale)));
      for (let i = d.x - 1; i <= d.x + 1; i++) for (let j = d.y - 1; j <= d.y; j++) if (i >= 0 && j >= 0 && i < TOWN_W && j < TOWN_H) this.blocked[j * TOWN_W + i] = 1;
    }
  }

  private drawBoard() {
    const b = this.layout.noticeBoard;
    const c = new Container();
    const art = this.townArt.board;
    if (art) {
      // painted board: drawn standing on its stone feet, the "!" sits on the roof corner
      c.addChild(new Graphics().ellipse(0, 2, 50, 10).fill({ color: "#000", alpha: 0.13 }));
      const sp = new Sprite(art);
      sp.anchor.set(0.5, 0.98);
      sp.scale.set(118 / art.height);
      c.addChild(sp);
      this.boardBadge.circle(0, 0, 12).fill("#E2523F").stroke({ color: "#FFF9F0", width: 3 });
      const ex = new Text({ text: "!", style: { fontFamily: "Nunito, system-ui", fontSize: 16, fontWeight: "900", fill: "#FFF" } });
      ex.anchor.set(0.5);
      this.boardBadge.addChild(ex);
      this.boardBadge.position.set(48, -112);
      this.boardBadge.visible = false;
      c.addChild(this.boardBadge);
      c.position.set(b.x * C + 16, b.y * C + 26);
      c.zIndex = b.y * C + 26;
      this.objects.addChild(c);
      this.blocked[b.y * TOWN_W + b.x] = 1;
      return;
    }
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
    const ta = this.townArt.tree;
    if (ta) {
      const H = 250; // the hero tree: taller than any other tree in town
      this.treeC.addChild(new Graphics().ellipse(0, 4, 92, 20).fill({ color: "#000", alpha: 0.12 }));
      const sp = new Sprite(ta);
      sp.anchor.set(0.5, 0.95);
      sp.scale.set(H / ta.height);
      this.treeC.addChild(sp);
      // fruit hangs in the leafy canopy (fractions of the tree height, measured on the painted tree)
      const spots = [[-0.3, -0.62], [-0.08, -0.84], [0.17, -0.8], [0.34, -0.6], [-0.4, -0.45], [0.05, -0.64], [0.28, -0.88], [-0.22, -0.8], [0.41, -0.43], [-0.12, -0.58], [0.2, -0.47], [-0.33, -0.33]];
      const glow = new Graphics();
      this.treeC.addChild(glow);
      let k = 0;
      const fruit = (tex: Texture | undefined, size: number, color: string) => {
        if (k >= spots.length) return;
        const [fx, fy] = spots[k++];
        const x = fx * H, y = fy * H;
        glow.circle(x, y, size * 0.9).fill({ color, alpha: 0.22 });
        if (!tex) return;
        // wrapped in a container so the gentle pulse (scale ≈ 1) does not undo the sprite's own scale
        const holder = new Container();
        const f = new Sprite(tex);
        f.anchor.set(0.5, 0.4);
        f.scale.set(size / tex.height);
        holder.addChild(f);
        holder.position.set(x, y);
        holder.label = "fruit";
        this.treeC.addChild(holder);
      };
      const reds = [this.townArt.red1, this.townArt.red2, this.townArt.red3];
      const golds = [this.townArt.gold1, this.townArt.gold2];
      for (let i = 0; i < this.tree.golden; i++) fruit(golds[i % 2], 30, "#F6C445");
      for (let i = 0; i < this.tree.fruits; i++) fruit(reds[i % 3], 27, "#E2523F");
      for (let i = 0; i < this.tree.buds; i++) fruit(this.townArt.bud, 18, "#F4B6A8");
      const label = new Text({ text: "Your Heart Tree", style: { fontFamily: "Nunito, system-ui", fontSize: 12, fontWeight: "900", fill: "#3A2A22", stroke: { color: "#FFF9F0", width: 4 } } });
      label.anchor.set(0.5);
      label.position.set(0, 22);
      this.treeC.addChild(label);
      return;
    }
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
    this.plotUnder.get(p.key)?.destroy({ children: true });
    this.bars.delete(p.key);
    const c = new Container();
    const u = new Container();
    this.plotsUnder.addChild(u);
    this.plotUnder.set(p.key, u);
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
      u.addChild(g);
      const sign = this.sprite(this.tex.prop("signpost" as never, 0), x + w / 2, y + h / 2 + 18, 0.75);
      u.addChild(sign);
      const t = new Text({ text: `${p.size === "S" ? "Small" : p.size === "M" ? "Medium" : "Large"} plot · free`, style: { fontFamily: "Nunito, system-ui", fontSize: 11, fontWeight: "800", fill: "#6B4A33" } });
      t.anchor.set(0.5);
      t.position.set(x + w / 2, y + h - 22);
      u.addChild(t);
    } else {
      const bp = BLUEPRINTS.find((b) => b.key === proj.blueprintKey);
      const prog = progressOf(proj);
      const stage = stageOf(prog, proj.status);
      const art = bp ? this.tex.baked(bp.sprite) : undefined;
      g.roundRect(x + 4, y + 4, w - 8, h - 8, 12).fill({ color: "#CDB48C", alpha: stage === 4 ? 0.25 : 0.7 });
      u.addChild(g);
      const cx = x + w / 2, by = y + h - 10;
      const fit = art ? Math.min((w * 0.95) / (art.tex.width * art.scale), (h * 1.5) / (art.tex.height * art.scale)) : 1;
      // retired blueprints (tent, gazebo…) have no stage art: use a current building of the same size
      const sizeStand: Record<string, string> = { S: "cottage", M: "bookshop", L: "school" };
      const stages = this.stageTex.get(proj.blueprintKey) ?? this.stageTex.get(sizeStand[bp?.size ?? p.size] ?? "cottage");
      if (stages) {
        // real construction-stage art: groundwork → frame → nearly done → complete (same footprint)
        const tex = stages[Math.max(1, stage) - 1];
        const sp = new Sprite(tex);
        sp.anchor.set(0.5, 0.97);
        sp.scale.set(Math.min((w * 1.05) / tex.width, (h * 1.7) / tex.height));
        sp.position.set(cx, by + 6);
        c.addChild(sp);
      }
      if (!stages && stage >= 1) {
        const f = new Graphics();
        f.roundRect(x + 14, y + h * 0.45, w - 28, h * 0.5, 6).fill("#B9AFA3").stroke({ color: "#7E7469", width: 3 });
        for (let i = x + 22; i < x + w - 20; i += 18) f.rect(i, y + h * 0.45 + 4, 12, 7).fill({ color: "#9C9186", alpha: 0.8 });
        c.addChild(f);
      }
      if (!stages && art && stage >= 2) {
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
      if (!stages && (stage === 2 || stage === 3)) {
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
    // one Wood bar (Stone was removed)
    g.roundRect(cx - bw / 2 - 3, y - 3, bw + 6, 14, 7).fill({ color: "#FFF9F0", alpha: 0.95 }).stroke({ color: "#8A6448", width: 2 });
    g.roundRect(cx - bw / 2, y, bw, 8, 4).fill("#EADCC8");
    g.roundRect(cx - bw / 2, y, Math.max(3, bw * wood), 8, 4).fill("#C98A4A");
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
    for (let k = 0; k < 300; k++) {
      const x = (1 + Math.random() * (TOWN_W - 2)) * C, y = (1 + Math.random() * (TOWN_H - 2)) * C;
      if (this.walkable(x, y) && this.walkable(x + 12, y) && this.walkable(x - 12, y)) return { x, y };
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
    // no zooming in the town: the camera keeps one friendly, fixed view
    const wheel = (e: WheelEvent) => e.preventDefault();
    this.app.canvas.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => this.app.canvas?.removeEventListener("wheel", wheel));
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
      this.walked += Math.hypot(m.x - before.x, m.y - before.y);
      if (this.target && before.x === m.x && before.y === m.y && (dx || dy)) this.target = null; // blocked
    } else m.walking = false;
    this.poseChar(m, dt);
    if (this.drop) this.tickDrop(dt);
    this.tickPuffs(dt);

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
    this.drawHighlight();

    if (this.zoomEase) {
      const e = this.zoomEase;
      e.t += dt;
      const u = Math.min(1, e.t / e.dur);
      const k = (1 - Math.cos(u * Math.PI)) / 2; // gentle ease in-out (sine)
      this.zoom = e.from + (e.to - e.from) * k;
      if (u >= 1) this.zoomEase = null;
    }
    // camera
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const z = this.zoom;
    // the camera follows a point in WORLD space, so changing the zoom scales around it smoothly
    const fp = this.focusKind ? this.focusPoint(this.focusKind) : null;
    const tx = fp ? fp.x : m.x, ty = fp ? fp.y : m.y - 40;
    if (this.camX === null) {
      this.camX = tx;
      this.camY = ty;
    } else {
      const k = 1 - Math.exp(-dt * (this.focusKind ? 3.2 : 12)); // glide to tutorial targets, follow the player tightly
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
    }
    // keep the view inside the town (applied at render time, never stored, so it can't drag the centre)
    const hw = sw / (2 * z), hh = sh / (2 * z), pad = 40 / z;
    const wx = W * z < sw ? W / 2 : Math.max(hw - pad, Math.min(W - hw + pad, this.camX));
    const wy = H * z < sh ? H / 2 : Math.max(hh - pad, Math.min(H - hh + pad, this.camY));
    this.world.scale.set(z);
    this.world.position.set(sw / 2 - wx * z, sh / 2 - wy * z);
  }

  // ───────────────────────────── interact highlight ─────────────────────────────

  /** Ground point, ring size and top of the thing the player is next to. */
  private anchorOf(i: Interactable) {
    if (i.kind === "tree") {
      const t = this.layout.heartTree;
      return { gx: t.x * C + 16, gy: t.y * C + 30, rx: 100, ry: 30, top: t.y * C - 230, rect: null };
    }
    if (i.kind === "board") {
      const b = this.layout.noticeBoard;
      return { gx: b.x * C + 16, gy: b.y * C + 26, rx: 58, ry: 18, top: b.y * C - 112, rect: null };
    }
    const q = i.plot;
    const hasBuilding = [...this.projects.values()].some((x) => x.plotKey === q.key);
    return { gx: (q.x + q.w / 2) * C, gy: (q.y + q.h) * C, rx: 0, ry: 0, top: q.y * C - (hasBuilding ? q.h * C * 0.55 : 6), rect: { x: q.x * C, y: q.y * C, w: q.w * C, h: q.h * C } };
  }

  private drawHighlight() {
    const g = this.hlRing;
    g.clear();
    const i = this.near;
    const show = !!i && !!this.hlLabel && !this.paused && !this.drop;
    this.hlTop.visible = false;
    if (!show || !i) return;
    const a = this.anchorOf(i);
    const pulse = 0.5 + Math.sin(this.t * 5) * 0.5;
    if (a.rect) {
      const r = a.rect;
      g.roundRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 14).fill({ color: 0xffd34d, alpha: 0.18 + pulse * 0.12 }).stroke({ color: 0xffb020, width: 4 + pulse * 2, alpha: 0.9 });
    } else {
      g.ellipse(a.gx, a.gy, a.rx + pulse * 8, a.ry + pulse * 3).fill({ color: 0xffd34d, alpha: 0.25 + pulse * 0.15 });
      g.ellipse(a.gx, a.gy, a.rx + pulse * 8, a.ry + pulse * 3).stroke({ color: 0xffb020, width: 4, alpha: 0.9 });
    }
    // bouncing arrow over the object, [E] bubble beside it
    const bob = Math.abs(Math.sin(this.t * 4)) * 10;
    this.hlArrow.position.set(a.gx, a.top - 18 - bob);
    this.hlBubble.position.set(a.gx + 24, a.top - 34);
    this.hlBubble.scale.set(1 + pulse * 0.04);
  }

  /** Where the action prompt should point (CSS pixels): the top of the highlighted object. */
  actionAnchor() {
    const i = this.near;
    if (!i || !this.hlLabel || this.paused || this.drop || !this.tex) return null;
    const a = this.anchorOf(i);
    const z = this.world.scale.x;
    return { x: a.gx * z + this.world.x, y: a.top * z + this.world.y };
  }

  /** The action shown next to the highlighted object, e.g. "Visit your Heart Tree" (empty = no highlight). */
  setNearLabel(label: string | null) {
    const text = label ?? "";
    if (text === this.hlLabel) return;
    this.hlLabel = text;
    this.hlBubble.removeChildren().forEach((c) => c.destroy());
    this.hlText = null;
    if (!text) return;
    const t = new Text({ text, style: { fontFamily: "Nunito, system-ui", fontSize: 15, fontWeight: "900", fill: "#3A2A22" } });
    const key = new Text({ text: "E", style: { fontFamily: "Nunito, system-ui", fontSize: 15, fontWeight: "900", fill: "#FFFFFF" } });
    const pad = 8, kw = 24, h = 32;
    const w = kw + 8 + t.width + pad * 2;
    const bg = new Graphics()
      .roundRect(0, 0, w, h, 12).fill("#FFF9F0").stroke({ color: "#8A6448", width: 3 })
      .roundRect(pad - 2, 4, kw, h - 8, 7).fill("#F58A3C").stroke({ color: "#8A6448", width: 2 });
    key.anchor.set(0.5);
    key.position.set(pad - 2 + kw / 2, h / 2);
    t.anchor.set(0, 0.5);
    t.position.set(pad + kw + 6, h / 2);
    // little tail pointing at the arrow
    const tail = new Graphics().poly([0, h / 2 - 7, -10, h / 2, 0, h / 2 + 7]).fill("#FFF9F0").stroke({ color: "#8A6448", width: 3 });
    this.hlBubble.addChild(tail, bg, key, t);
    this.hlText = t;
  }

  // ───────────────────────────── arrival tutorial ─────────────────────────────

  private tickDrop(dt: number) {
    const d = this.drop!;
    const m = this.me;
    d.t += dt;
    const FALL = 1.9; // seconds: a floaty descent
    const H = 620;
    if (d.landedAt === null) {
      const p = Math.min(1, d.t / FALL);
      const ease = Math.sin((p * Math.PI) / 2); // quick start, soft landing
      const sway = (1 - p) * Math.sin(d.t * 3.4);
      m.spr.y += -H * (1 - ease);
      m.spr.x += sway * 22;
      m.spr.rotation = sway * 0.18;
      if (m.label) m.label.visible = false;
      // the shadow on the ground grows as the helper comes down
      if (this.dropShadow) {
        this.dropShadow.scale.set(0.25 + ease * 0.75);
        this.dropShadow.alpha = 0.15 + ease * 0.35;
      }
      if (p >= 1) {
        d.landedAt = d.t;
        m.spr.rotation = 0;
        for (let k = 0; k < 12; k++) {
          const g = new Graphics().circle(0, 0, 6 + Math.random() * 7).fill({ color: k % 3 ? 0xf3e3c8 : 0xffb3a8, alpha: 0.9 });
          g.position.set(m.x, m.y - 4);
          const a = (k / 12) * Math.PI * 2;
          this.puffs.push({ g, t: 0, vx: Math.cos(a) * 80, vy: Math.sin(a) * 28 - 10 });
          this.fx.addChild(g);
        }
        this.dropShadow?.destroy();
        this.dropShadow = null;
        // pull the camera back out to the normal view
        this.zoomEase = { from: this.zoom, to: this.baseZoom, t: 0, dur: 2.1 };
      }
      return;
    }
    // landed: a soft squash, then wait for the camera to settle before handing over to the tutorial
    const since = d.t - d.landedAt;
    const sq = since < 0.4 ? Math.sin((since / 0.4) * Math.PI) * 0.14 : 0;
    m.spr.scale.set(m.spr.scale.x * (1 + sq), m.spr.scale.y * (1 - sq));
    if (m.label) m.label.visible = since > 0.3;
    if (!this.zoomEase && since > 0.4) {
      const done = d.resolve;
      this.drop = null;
      done();
    }
  }

  private tickPuffs(dt: number) {
    for (const f of this.puffs) {
      f.t += dt;
      f.g.x += f.vx * dt;
      f.g.y += f.vy * dt;
      f.g.alpha = Math.max(0, 1 - f.t / 0.7);
      f.g.scale.set(1 + f.t * 1.6);
    }
    const dead = this.puffs.filter((f) => f.t >= 0.7);
    for (const f of dead) f.g.destroy();
    this.puffs = this.puffs.filter((f) => f.t < 0.7);
  }

  /** A plot worth pointing at: one being built, else a free plot, else the first. */
  private tutorialPlot(): Plot {
    const byKey = new Map([...this.projects.values()].map((p) => [p.plotKey, p]));
    return this.layout.plots.find((q) => byKey.get(q.key) && byKey.get(q.key)!.status !== "completed") ?? this.layout.plots.find((q) => !byKey.get(q.key)) ?? this.layout.plots[0];
  }

  private focusPoint(kind: FocusKind) {
    if (kind === "tree") return { x: this.layout.heartTree.x * C + 16, y: this.layout.heartTree.y * C - 90 };
    if (kind === "board") return { x: this.layout.noticeBoard.x * C + 16, y: this.layout.noticeBoard.y * C - 50 };
    const q = this.tutorialPlot();
    return { x: (q.x + q.w / 2) * C, y: (q.y + q.h / 2) * C - 20 };
  }

  // ───────────────────────────── public API ─────────────────────────────

  setProjects(list: TownProject[]) {
    if (!this.tex) return;
    const next = new Map(list.map((p) => [p.plotKey, p]));
    // compare against the PREVIOUS state for every plot, then switch to the new state before drawing
    const prev = new Map([...this.projects.values()].map((p) => [p.plotKey, p]));
    this.projects = new Map(list.map((p) => [p.id, p]));
    for (const plot of this.layout.plots) {
      const a = prev.get(plot.key);
      const b = next.get(plot.key);
      const changed = !a !== !b || (a && b && (a.id !== b.id || a.status !== b.status || progressOf(a) !== progressOf(b)));
      if (changed) this.renderPlot(plot);
    }
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

  /** Arrival tutorial: drop the helper in from the sky. Resolves when it lands. */
  dropIn() {
    return new Promise<void>((resolve) => {
      if (!this.me) return resolve();
      this.me.spr.visible = true;
      this.dropShadow = new Graphics().ellipse(0, 0, 34, 10).fill({ color: 0x000000, alpha: 1 });
      this.dropShadow.position.set(this.me.x, this.me.y);
      this.dropShadow.zIndex = this.me.y - 1;
      this.dropShadow.alpha = 0.15;
      this.dropShadow.scale.set(0.25);
      this.objects.addChild(this.dropShadow);
      this.drop = { t: 0, resolve, landedAt: null };
    });
  }

  /** Point the camera at a town feature (null = follow the player again). */
  focus(kind: FocusKind | null) {
    this.focusKind = kind;
  }

  /** How far the player has walked since the town loaded (world pixels). */
  walkedDistance() {
    return this.walked;
  }

  /** Where a feature is on screen (CSS pixels) and how big a spotlight it needs. */
  spotlight(kind: FocusKind) {
    if (!this.tex) return null;
    const p = this.focusPoint(kind);
    const z = this.world.scale.x;
    const r = kind === "tree" ? 150 : kind === "board" ? 85 : (() => { const q = this.tutorialPlot(); return (Math.max(q.w, q.h) * C) / 2 + 30; })();
    return { x: p.x * z + this.world.x, y: p.y * z + this.world.y, r: r * z };
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
