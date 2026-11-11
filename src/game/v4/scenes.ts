/**
 * Standalone 2D side-scrolling mini-game scenes (PixiJS). Pure presentation + input capture:
 * the server re-judges every raw timing and is the only source of rewards.
 *
 *  WoodScene  — the NPC PRESENTS logs; the player times each axe swing (real-time execution).
 *               Fake-outs are telegraphed by animation + sound; correct play is to hold back.
 *  StoneScene — the NPC DEMONSTRATES a rhythm on up to four rocks; the player REPEATS it from memory.
 */
import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { Mascot } from "@/game/world/mascots";
import { sfx } from "./sfx";
import type { StoneRound, WoodEvent, WoodRound } from "./rules";

const VW = 960, VH = 540;
const FONT = "Nunito, system-ui, sans-serif";
const OUT = "#6B4A33";

export type LocalResult = "perfect" | "hit" | "miss" | "read";
type Particle = { g: Graphics; vx: number; vy: number; vr: number; life: number; max: number; grav: number };

const texCache = new Map<string, Texture>();
async function mascotSide(m: Mascot, frame = -1): Promise<Texture | null> {
  const k = frame >= 0 ? `${m}_side_${frame}` : `${m}_side`;
  if (texCache.has(k)) return texCache.get(k)!;
  try {
    const t = (await Assets.load(frame >= 0 ? `/game/sprites/mascots/walk/${k}.png` : `/game/sprites/mascots/${k}.png`)) as Texture;
    texCache.set(k, t);
    return t;
  } catch {
    return null;
  }
}

abstract class Scene {
  protected app = new Application();
  protected root = new Container();
  protected bg = new Container();
  protected mid = new Container();
  protected front = new Container();
  protected ui = new Container();
  private parts: Particle[] = [];
  private floats: { t: Text; life: number; vy: number }[] = [];
  protected shake = 0;
  protected destroyed = false;
  protected clock = 0;
  private cleanup: (() => void)[] = [];

  async mount(el: HTMLElement) {
    await this.app.init({ resizeTo: el, background: "#FCE9C8", antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, preference: "webgl" });
    if (this.destroyed) return this.app.destroy({ removeView: true });
    el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = "none";
    this.root.addChild(this.bg, this.mid, this.front, this.ui);
    this.app.stage.addChild(this.root);
    await this.build();
    this.app.ticker.add((tk) => {
      const dt = Math.min(0.05, tk.deltaMS / 1000);
      this.clock += dt;
      this.layout();
      this.update(dt);
      this.stepFx(dt);
    });
  }
  protected on(target: Window | HTMLElement, ev: string, fn: EventListener) {
    target.addEventListener(ev, fn);
    this.cleanup.push(() => target.removeEventListener(ev, fn));
  }
  private layout() {
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const s = Math.min(sw / VW, sh / VH);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.root.scale.set(s);
    this.root.position.set((sw - VW * s) / 2 + sx, (sh - VH * s) / 2 + sy);
    this.shake *= 0.85;
  }
  protected abstract build(): Promise<void>;
  protected abstract update(dt: number): void;

  protected burst(x: number, y: number, n: number, colors: string[], speed = 260, size = 5, grav = 900) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      const c = colors[i % colors.length];
      if (i % 3 === 0) g.rect(-size, -size / 2, size * 2, size).fill(c);
      else g.circle(0, 0, size * (0.5 + Math.random() * 0.6)).fill(c);
      g.position.set(x, y);
      this.front.addChild(g);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = speed * (0.4 + Math.random());
      this.parts.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vr: (Math.random() - 0.5) * 12, life: 0, max: 0.7 + Math.random() * 0.5, grav });
    }
  }
  protected float(text: string, x: number, y: number, color: string, size = 34) {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: "900", fill: color, stroke: { color: "#FFF9F0", width: 7 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.ui.addChild(t);
    this.floats.push({ t, life: 0, vy: -60 });
  }
  private stepFx(dt: number) {
    for (const p of this.parts) {
      p.life += dt;
      p.vy += p.grav * dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.g.rotation += p.vr * dt;
      p.g.alpha = Math.max(0, 1 - p.life / p.max);
    }
    this.parts = this.parts.filter((p) => (p.life < p.max ? true : (p.g.destroy(), false)));
    for (const f of this.floats) {
      f.life += dt;
      f.t.y += f.vy * dt;
      f.t.alpha = Math.max(0, 1 - Math.max(0, f.life - 0.45) / 0.4);
      f.t.scale.set(f.life < 0.12 ? 0.6 + f.life * 4 : 1.08 - Math.min(0.08, f.life * 0.1));
    }
    this.floats = this.floats.filter((f) => (f.life < 0.9 ? true : (f.t.destroy(), false)));
  }

  /** A side-view helper: generated side sprite when available, a drawn stand-in otherwise. */
  protected async animal(m: Mascot, facing: 1 | -1, h = 150) {
    const c = new Container();
    const tex = await mascotSide(m);
    const shadow = new Graphics().ellipse(0, 0, h * 0.34, h * 0.07).fill({ color: "#000", alpha: 0.14 });
    c.addChild(shadow);
    if (tex) {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 0.96);
      const k = h / tex.height;
      s.scale.set(k * facing, k);
      s.label = "body";
      c.addChild(s);
    } else {
      const g = new Graphics();
      g.ellipse(0, -h * 0.35, h * 0.28, h * 0.32).fill("#F5EDE3").stroke({ color: OUT, width: 3 });
      g.circle(facing * h * 0.08, -h * 0.72, h * 0.22).fill("#F5EDE3").stroke({ color: OUT, width: 3 });
      g.circle(facing * h * 0.16, -h * 0.75, 4).fill(OUT);
      g.label = "body";
      c.addChild(g);
    }
    return c;
  }

  protected heartShape(g: Graphics, x: number, y: number, s: number, color: string) {
    g.circle(x - s * 0.5, y - s * 0.2, s * 0.55).fill(color);
    g.circle(x + s * 0.5, y - s * 0.2, s * 0.55).fill(color);
    g.poly([x - s * 1.02, y, x + s * 1.02, y, x, y + s * 1.15]).fill(color);
  }

  protected cloud(x: number, y: number, s: number) {
    const g = new Graphics();
    for (const [dx, dy, r] of [[0, 0, 26], [28, -8, 32], [60, 0, 24], [30, 10, 26]]) g.circle(dx * s, dy * s, r * s).fill({ color: "#FFFFFF", alpha: 0.9 });
    g.position.set(x, y);
    return g;
  }

  protected tree(x: number, y: number, s: number, tone: string, dark: string) {
    const g = new Graphics();
    g.roundRect(-8 * s, -50 * s, 16 * s, 52 * s, 5 * s).fill("#8C5E3C");
    for (const [dx, dy, r] of [[0, -96, 46], [-34, -70, 34], [34, -70, 34], [0, -60, 36]]) g.circle(dx * s, (dy + 4) * s, r * s).fill(dark);
    for (const [dx, dy, r] of [[0, -96, 46], [-34, -70, 34], [34, -70, 34], [0, -60, 36]]) g.circle(dx * s, dy * s, r * s).fill(tone);
    g.circle(-14 * s, -112 * s, 16 * s).fill({ color: "#FFFFFF", alpha: 0.18 });
    g.position.set(x, y);
    return g;
  }

  setPaused(p: boolean) {
    if (p) this.app.ticker?.stop();
    else this.app.ticker?.start();
  }

  destroy() {
    this.destroyed = true;
    for (const c of this.cleanup) c();
    try {
      this.app.destroy({ removeView: true }, { children: true }); // never release Pixi globals: other apps may be alive
    } catch {
      /* not mounted */
    }
  }
}

// ═════════════════════════════ WOOD ═════════════════════════════

type WoodLive = { e: WoodEvent; state: "waiting" | "chopped" | "missed" | "read" | "fake_swung"; quality?: "perfect" | "hit"; resolvedAt?: number };

export class WoodScene extends Scene {
  private player!: Container;
  private npc!: Container;
  private axe = new Container();
  private axeSwing = 0; // seconds since swing, -1 idle
  private log = new Container();
  private halves: Container[] = [];
  private bar = new Graphics();
  private barNext = new Graphics();
  private barLabel!: Text;
  private parallax: { c: Container; speed: number; w: number }[] = [];
  private round: WoodRound | null = null;
  private live: WoodLive[] = [];
  private t0 = 0;
  private swings: number[] = [];
  private lastSwing = -1e9;
  private cuePlayed = new Set<number>();
  private tellPlayed = new Set<number>();
  private resolve: ((s: number[]) => void) | null = null;
  private banner!: Text;
  private stumble = 0;
  readonly stumpX = 470;
  readonly stumpY = 418;

  constructor(private mascot: Mascot, private onLocal: (r: LocalResult) => void) {
    super();
  }

  protected async build() {
    // sky bands
    const sky = new Graphics();
    const bands = ["#FCE4C0", "#FBE9CC", "#F9EED8", "#F4F0DC"];
    bands.forEach((c, i) => sky.rect(0, i * 70, VW, 72).fill(c));
    sky.circle(780, 96, 46).fill({ color: "#FFF4D6" }).circle(780, 96, 64).fill({ color: "#FFF4D6", alpha: 0.35 });
    this.bg.addChild(sky);
    const addLayer = (draw: (c: Container) => void, speed: number) => {
      const c = new Container();
      for (let k = 0; k < 2; k++) {
        const part = new Container();
        draw(part);
        part.x = k * VW;
        c.addChild(part);
      }
      this.bg.addChild(c);
      this.parallax.push({ c, speed, w: VW });
    };
    addLayer((c) => {
      c.addChild(this.cloud(120, 90, 1), this.cloud(520, 60, 0.8), this.cloud(820, 130, 0.7));
    }, 6);
    addLayer((c) => {
      const g = new Graphics();
      g.ellipse(160, 330, 260, 90).fill("#BFD9A0");
      g.ellipse(560, 340, 300, 100).fill("#B3D394");
      g.ellipse(900, 330, 240, 90).fill("#BFD9A0");
      c.addChild(g);
    }, 10);
    addLayer((c) => {
      for (let i = 0; i < 9; i++) c.addChild(this.tree(40 + i * 112, 360, 0.7 + ((i * 37) % 5) * 0.05, i % 3 ? "#7DB662" : "#88BE6B", "#5E9550"));
    }, 22);
    // cottage (static, warm)
    const cot = new Graphics();
    cot.rect(690, 250, 170, 120).fill("#F3D9B1").stroke({ color: OUT, width: 4 });
    cot.poly([670, 254, 775, 180, 880, 254]).fill("#E46F3E").stroke({ color: OUT, width: 4 });
    cot.rect(826, 190, 22, 40).fill("#B9AFA3").stroke({ color: OUT, width: 3 });
    cot.roundRect(752, 296, 46, 74, 8).fill("#A8693F").stroke({ color: OUT, width: 3 });
    cot.circle(788, 334, 3).fill("#F6C76C");
    cot.roundRect(706, 282, 34, 30, 4).fill("#CFE8F7").stroke({ color: OUT, width: 3 });
    cot.roundRect(812, 282, 34, 30, 4).fill("#FFE9A8").stroke({ color: OUT, width: 3 });
    cot.rect(721, 282, 4, 30).fill(OUT);
    this.bg.addChild(cot);
    for (let i = 0; i < 3; i++) {
      const smoke = new Graphics().circle(0, 0, 10 + i * 4).fill({ color: "#FFFFFF", alpha: 0.55 });
      smoke.position.set(837, 180 - i * 26);
      smoke.label = `smoke${i}`;
      this.bg.addChild(smoke);
    }
    // ground
    const gr = new Graphics();
    gr.rect(0, 370, VW, VH - 370).fill("#9CCB78");
    gr.rect(0, 370, VW, 10).fill("#B6DC92");
    for (let i = 0; i < 70; i++) {
      const x = (i * 137) % VW, y = 392 + ((i * 53) % 130);
      gr.poly([x, y, x + 3, y - 10, x + 6, y]).fill("#86B967");
    }
    for (let i = 0; i < 16; i++) {
      const x = 30 + ((i * 211) % 900), y = 440 + ((i * 71) % 80);
      gr.circle(x, y, 5).fill(["#F7B2C4", "#FFE38A", "#FFFFFF", "#C9B5F0"][i % 4]);
      gr.circle(x, y, 2).fill("#F6A33C");
    }
    this.mid.addChild(gr);
    // wood pile + stump
    const pile = new Graphics();
    for (let i = 0; i < 6; i++) {
      const x = 590 + (i % 3) * 30 + (i > 2 ? 15 : 0), y = 440 - (i > 2 ? 26 : 0);
      pile.circle(x, y, 15).fill("#C98A4A").stroke({ color: OUT, width: 3 });
      pile.circle(x, y, 7).fill("#E9C99A");
    }
    pile.position.set(120, 0);
    this.mid.addChild(pile);
    const stump = new Graphics();
    stump.ellipse(this.stumpX, this.stumpY + 36, 70, 14).fill({ color: "#000", alpha: 0.12 });
    stump.roundRect(this.stumpX - 52, this.stumpY - 8, 104, 46, 10).fill("#9C6B45").stroke({ color: OUT, width: 4 });
    stump.ellipse(this.stumpX, this.stumpY - 8, 52, 14).fill("#E9C99A").stroke({ color: OUT, width: 4 });
    stump.ellipse(this.stumpX, this.stumpY - 8, 30, 8).stroke({ color: "#C9A77C", width: 2 });
    stump.ellipse(this.stumpX, this.stumpY - 8, 14, 4).stroke({ color: "#C9A77C", width: 2 });
    this.mid.addChild(stump);

    // characters
    this.player = await this.animal(this.mascot, 1, 160);
    this.player.position.set(330, 470);
    this.npc = await this.animal(this.mascot === "dog" ? "fox" : "dog", -1, 150);
    this.npc.position.set(640, 470);
    this.front.addChild(this.npc, this.player);
    // axe in the player's paws
    const handle = new Graphics().roundRect(-5, -100, 10, 104, 5).fill("#B07A4A").stroke({ color: OUT, width: 3 });
    const head = new Graphics().poly([-6, -104, 34, -116, 40, -84, -6, -80]).fill("#C8D0D8").stroke({ color: OUT, width: 3 });
    head.rect(-8, -106, 12, 30).fill("#8A949E");
    this.axe.addChild(handle, head);
    this.axe.position.set(378, 404);
    this.axe.rotation = -0.6;
    this.front.addChild(this.axe);
    this.front.addChild(this.log);
    this.drawLog(this.log, 1);
    this.log.visible = false;

    // timing bar
    this.ui.addChild(this.barNext, this.bar);
    this.barLabel = new Text({ text: "", style: { fontFamily: FONT, fontSize: 18, fontWeight: "900", fill: "#3A2A22" } });
    this.barLabel.anchor.set(0.5);
    this.barLabel.position.set(VW / 2, 92);
    this.ui.addChild(this.barLabel);
    this.banner = new Text({ text: "", style: { fontFamily: FONT, fontSize: 40, fontWeight: "900", fill: "#E46F3E", stroke: { color: "#FFF9F0", width: 8 } } });
    this.banner.anchor.set(0.5);
    this.banner.position.set(VW / 2, 190);
    this.ui.addChild(this.banner);

    // input: Space / click / tap = swing
    this.on(window, "keydown", ((e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Enter" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (!e.repeat) this.swing();
      }
    }) as EventListener);
    this.app.canvas.addEventListener("pointerdown", () => this.swing());
  }

  private drawLog(c: Container, half: 0 | 1 | 2) {
    const g = new Graphics();
    const w = half ? 34 : 68;
    const x0 = half === 2 ? 0 : -w;
    if (half === 0) {
      g.roundRect(-34, -64, 68, 64, 10).fill("#B07A4A").stroke({ color: OUT, width: 4 });
      g.ellipse(0, -64, 34, 10).fill("#E9C99A").stroke({ color: OUT, width: 4 });
    } else if (half === 1) {
      g.roundRect(-34, -64, 68, 64, 10).fill("#B07A4A").stroke({ color: OUT, width: 4 });
      g.ellipse(0, -64, 34, 10).fill("#E9C99A").stroke({ color: OUT, width: 4 });
      g.ellipse(0, -64, 18, 5).stroke({ color: "#C9A77C", width: 2 });
      g.rect(-20, -48, 4, 30).fill({ color: "#8C5E3C", alpha: 0.6 });
      g.rect(12, -40, 4, 26).fill({ color: "#8C5E3C", alpha: 0.6 });
    } else {
      g.roundRect(x0, -64, w, 64, 8).fill("#B07A4A").stroke({ color: OUT, width: 4 });
      g.rect(half === 2 ? 0 : -4, -64, 4, 64).fill("#E9C99A");
    }
    c.addChild(g);
  }

  private swing() {
    if (!this.round || this.resolve === null) return;
    const now = performance.now() - this.t0;
    if (now - this.lastSwing < 120) return; // debounce (also applied server-side as "stray")
    this.lastSwing = now;
    this.swings.push(Math.round(now));
    this.axeSwing = 0;
    sfx.whiff();
    // local prediction (the server re-judges this exact timing and is final)
    const real = this.live.find((l) => l.e.kind === "log" && l.state === "waiting" && Math.abs(now - l.e.t) <= l.e.hitMs);
    if (real) {
      real.state = "chopped";
      real.quality = Math.abs(now - real.e.t) <= real.e.perfectMs ? "perfect" : "hit";
      real.resolvedAt = now;
      this.onChop(real.quality);
      return;
    }
    const fake = this.live.find((l) => l.e.kind === "fake" && l.state === "waiting" && now >= this.tellTime(l.e) - 40 && now <= l.e.t + l.e.hitMs);
    if (fake) {
      fake.state = "fake_swung";
      fake.resolvedAt = now;
      this.onMiss("Fake-out!");
      return;
    }
    this.onMiss("Too early");
  }

  private tellTime(e: WoodEvent) {
    return e.t - e.approachMs * e.zoneAt * (1 - (e.tellAt ?? 0.5));
  }

  private onChop(q: "perfect" | "hit") {
    sfx.chop(q === "perfect");
    this.onLocal(q);
    this.shake = q === "perfect" ? 14 : 6;
    this.float(q === "perfect" ? "PERFECT!" : "Hit", this.stumpX, this.stumpY - 140, q === "perfect" ? "#3F9B5B" : "#D9A21B", q === "perfect" ? 44 : 34);
    this.burst(this.stumpX, this.stumpY - 40, q === "perfect" ? 26 : 12, ["#E9C99A", "#C98A4A", "#F6C76C"], q === "perfect" ? 420 : 280, q === "perfect" ? 6 : 4);
    this.log.visible = false;
    for (const side of [1, 2] as const) {
      const h = new Container();
      this.drawLog(h, side);
      h.position.set(this.stumpX, this.stumpY - 8);
      h.label = `${side}`;
      this.front.addChild(h);
      this.halves.push(h);
      (h as unknown as { vx: number; vy: number; life: number }).vx = (side === 1 ? -1 : 1) * (q === "perfect" ? 320 : 180);
      (h as unknown as { vx: number; vy: number; life: number }).vy = q === "perfect" ? -420 : -240;
      (h as unknown as { vx: number; vy: number; life: number }).life = 0;
    }
  }

  private onMiss(why: string) {
    sfx.miss();
    sfx.heartLost();
    this.onLocal("miss");
    this.stumble = 0.45;
    this.float(`Miss · ${why}`, this.stumpX, this.stumpY - 140, "#D8473A", 30);
  }

  /** Plays one round; resolves with the raw swing timings (ms from round start). */
  play(round: WoodRound): Promise<number[]> {
    this.round = round;
    this.live = round.events.map((e) => ({ e, state: "waiting" }));
    this.swings = [];
    this.cuePlayed.clear();
    this.tellPlayed.clear();
    this.t0 = performance.now();
    this.banner.text = round.hint ?? `Round ${round.round + 1}`;
    this.banner.alpha = 1;
    return new Promise((r) => (this.resolve = r));
  }

  protected update(dt: number) {
    // parallax drift + chimney smoke
    for (const l of this.parallax) {
      l.c.x -= l.speed * dt;
      if (l.c.x <= -l.w) l.c.x += l.w;
    }
    for (let i = 0; i < 3; i++) {
      const s = this.bg.getChildByLabel(`smoke${i}`);
      if (s) {
        s.y = 180 - i * 26 - ((this.clock * 14 + i * 9) % 26);
        s.alpha = 0.55 - ((this.clock * 0.4 + i * 0.3) % 1) * 0.4;
      }
    }
    // idle breathing
    const breath = 1 + Math.sin(this.clock * 2.6) * 0.012;
    this.player.scale.y = breath;
    this.npc.scale.y = 1 + Math.sin(this.clock * 2.2 + 1) * 0.012;
    if (this.stumble > 0) {
      this.stumble -= dt;
      this.player.rotation = Math.sin(this.stumble * 30) * 0.08;
      this.player.x = 330 - this.stumble * 30;
    } else {
      this.player.rotation = 0;
      this.player.x = 330;
    }
    // axe swing animation
    if (this.axeSwing >= 0) {
      this.axeSwing += dt;
      const a = this.axeSwing;
      // raised over the shoulder (-0.6) → down onto the stump (1.6) → back up
      this.axe.rotation = a < 0.07 ? -0.6 + (a / 0.07) * 2.2 : a < 0.3 ? 1.6 - ((a - 0.07) / 0.23) * 2.2 : -0.6;
      if (a > 0.3) this.axeSwing = -1;
    } else this.axe.rotation = -0.6 + Math.sin(this.clock * 2.6) * 0.03;
    // flying halves
    this.halves = this.halves.filter((h) => {
      const o = h as unknown as { vx: number; vy: number; life: number };
      o.life += dt;
      o.vy += 1400 * dt;
      h.x += o.vx * dt;
      h.y = Math.min(470, h.y + o.vy * dt);
      h.rotation += (o.vx > 0 ? 1 : -1) * 6 * dt;
      h.alpha = Math.max(0, 1 - Math.max(0, o.life - 0.6) / 0.4);
      if (o.life > 1) h.destroy();
      return o.life <= 1;
    });
    this.banner.alpha = Math.max(0, this.banner.alpha - dt * 0.6);
    if (!this.round || !this.resolve) {
      this.bar.clear();
      this.barNext.clear();
      this.barLabel.text = "";
      return;
    }
    const now = performance.now() - this.t0;
    // auto-resolve logs that were never chopped, and fake-outs that were correctly ignored
    for (const l of this.live) {
      if (l.state !== "waiting") continue;
      if (l.e.kind === "log" && now > l.e.t + l.e.hitMs) {
        l.state = "missed";
        l.resolvedAt = now;
        this.onMiss("Missed log");
      } else if (l.e.kind === "fake" && now > l.e.t + l.e.hitMs) {
        l.state = "read";
        l.resolvedAt = now;
        sfx.read();
        this.onLocal("read");
        this.float("Nice read!", this.stumpX + 140, this.stumpY - 170, "#2F6E92", 26);
      }
    }
    // the NPC + log: show the earliest event that is still presenting
    const cur = this.live.find((l) => (l.state === "waiting" || (l.resolvedAt !== undefined && now - l.resolvedAt < 260)) && now >= l.e.t - l.e.approachMs * l.e.zoneAt - 520);
    this.animateNpc(cur ?? null, now);
    // sequential timing indicators: one active, the next previewed
    const active = this.live.find((l) => l.state === "waiting");
    const nextOne = active ? this.live.find((l) => l.state === "waiting" && l !== active) : undefined;
    this.drawIndicator(this.bar, active?.e ?? null, now, VW / 2, 120, 520, 26, active?.e.kind === "fake" && now >= this.tellTime(active.e));
    this.drawIndicator(this.barNext, nextOne?.e ?? null, now, VW / 2, 156, 300, 10, false, true);
    this.barLabel.text = active ? (active.e.kind === "fake" && now >= this.tellTime(active.e) ? "✋ Hold!" : "Swing on green — Space / tap") : "";
    if (now > this.round.durationMs) {
      const r = this.resolve;
      this.resolve = null;
      this.log.visible = false;
      r(this.swings);
    }
  }

  private animateNpc(l: WoodLive | null, now: number) {
    const handX = 600, handY = 392;
    const body = this.npc;
    if (!l) {
      this.log.visible = false;
      body.rotation = 0;
      return;
    }
    const e = l.e;
    const start = e.t - e.approachMs * e.zoneAt;
    if (l.state === "chopped") return void (this.log.visible = false);
    this.log.visible = true;
    const pick = Math.min(1, Math.max(0, (now - (start - 520)) / 520)); // lift
    let p = Math.min(1, Math.max(0, (now - start) / (e.t - start))); // to the stump
    if (!this.cuePlayed.has(e.i) && now >= start) {
      this.cuePlayed.add(e.i);
      sfx.logCue();
    }
    if (e.kind === "fake") {
      const tell = this.tellTime(e);
      if (now >= tell) {
        if (!this.tellPlayed.has(e.i)) {
          this.tellPlayed.add(e.i);
          sfx.fakeTell();
          this.float("?", handX - 20, handY - 120, "#2F6E92", 40);
        }
        const back = Math.min(1, (now - tell) / 240);
        const at = Math.min(1, Math.max(0, (tell - start) / (e.t - start)));
        p = at * (1 - back);
        body.rotation = Math.sin(now / 40) * 0.05 * (1 - back);
      }
    } else body.rotation = 0;
    if (l.state === "missed") {
      const k = Math.min(1, (now - (l.resolvedAt ?? now)) / 300);
      this.log.position.set(this.stumpX + 60 * k, this.stumpY - 8 + 40 * k);
      this.log.rotation = 1.2 * k;
      this.log.alpha = 1 - k;
      return;
    }
    this.log.alpha = 1;
    this.log.rotation = (1 - p) * -0.4;
    const x = handX + (this.stumpX - handX) * p;
    const arc = Math.sin(p * Math.PI) * 70;
    const y = handY - 30 * pick + (this.stumpY - 8 - handY) * p - arc;
    this.log.position.set(x, y);
    body.y = 470 - pick * 6 * (1 - p);
  }

  private drawIndicator(g: Graphics, e: WoodEvent | null, now: number, cx: number, y: number, w: number, h: number, held: boolean, ghost = false) {
    g.clear();
    if (!e) return;
    const start = e.t - e.approachMs * e.zoneAt;
    const pos = (now - start) / e.approachMs; // 0..1 across the bar; zone at zoneAt
    const x0 = cx - w / 2;
    g.roundRect(x0 - 4, y - 4, w + 8, h + 8, h / 2 + 4).fill({ color: "#FFF9F0", alpha: ghost ? 0.6 : 0.95 }).stroke({ color: "#8A6448", width: ghost ? 2 : 3 });
    g.roundRect(x0, y, w, h, h / 2).fill(ghost ? "#EFE3D2" : "#EADCC8");
    if (!(e.kind === "fake" && held)) {
      const hz = (e.hitMs / e.approachMs) * w, pz = (e.perfectMs / e.approachMs) * w;
      const zx = x0 + e.zoneAt * w;
      g.roundRect(zx - hz, y, hz * 2, h, 4).fill(ghost ? "#F6E3A1" : "#F6D35C");
      g.roundRect(zx - pz, y, pz * 2, h, 3).fill(ghost ? "#BFE3C4" : "#5CC17A");
    } else {
      g.roundRect(x0, y, w, h, h / 2).fill({ color: "#B8C3CC", alpha: 0.9 });
    }
    if (!ghost && pos >= 0 && pos <= 1.15) {
      const px = x0 + Math.min(1.05, pos) * w;
      g.roundRect(px - 4, y - 8, 8, h + 16, 4).fill("#3A2A22");
    }
  }
}

// ═════════════════════════════ STONE ═════════════════════════════

const ROCK_COLORS = ["#F2A65A", "#E27396", "#4FB3A9", "#9C7CD4"];
const ROCK_KEYS = ["D", "F", "J", "K"];

export class StoneScene extends Scene {
  private player!: Container;
  private npc!: Container;
  private pick = new Container();
  private npcPick = new Container();
  private rocks: Container[] = [];
  private rockFlash = [0, 0, 0, 0];
  private round: StoneRound | null = null;
  private t0 = 0;
  private strikes: { t: number; b: number }[] = [];
  private resolve: ((s: { t: number; b: number }[]) => void) | null = null;
  private demoDone = new Set<number>();
  private ticks = new Set<number>();
  private used: boolean[] = [];
  private missedExp = new Set<number>();
  private status!: Text;
  private lane = new Graphics();
  private pSwing = -1;
  private nSwing = -1;
  private pTarget = 0;
  private nTarget = 0;

  constructor(private mascot: Mascot, private onLocal: (r: LocalResult) => void) {
    super();
  }

  protected async build() {
    const sky = new Graphics();
    ["#FBE3C5", "#F9E8CF", "#F6EBD8", "#EFE9D9"].forEach((c, i) => sky.rect(0, i * 70, VW, 72).fill(c));
    this.bg.addChild(sky, this.cloud(140, 80, 0.9), this.cloud(700, 60, 0.7));
    // cliffs with strata
    const cliff = new Graphics();
    cliff.poly([0, 380, 0, 200, 110, 150, 220, 190, 320, 140, 420, 200, 420, 380]).fill("#C9B49A").stroke({ color: OUT, width: 4 });
    for (let i = 0; i < 4; i++) cliff.rect(0, 220 + i * 40, 420, 6).fill({ color: "#B39C80", alpha: 0.8 });
    cliff.poly([600, 380, 640, 230, 760, 180, 900, 220, 960, 200, 960, 380]).fill("#D2BEA3").stroke({ color: OUT, width: 4 });
    this.bg.addChild(cliff);
    // stone house
    const h = new Graphics();
    h.rect(680, 250, 180, 120).fill("#D9D2C6").stroke({ color: OUT, width: 4 });
    for (let y = 262; y < 360; y += 22) for (let x = 690 + ((y / 22) % 2) * 14; x < 850; x += 30) h.roundRect(x, y, 24, 16, 4).stroke({ color: "#B5ACA0", width: 2 });
    h.poly([664, 254, 770, 188, 876, 254]).fill("#7E8FA6").stroke({ color: OUT, width: 4 });
    h.roundRect(746, 300, 46, 70, 10).fill("#A8693F").stroke({ color: OUT, width: 3 });
    h.roundRect(700, 284, 32, 28, 4).fill("#FFE9A8").stroke({ color: OUT, width: 3 });
    h.roundRect(808, 284, 32, 28, 4).fill("#FFE9A8").stroke({ color: OUT, width: 3 });
    this.bg.addChild(h);
    // lanterns + mine cart
    const deco = new Graphics();
    for (const x of [470, 600]) {
      deco.rect(x, 250, 5, 130).fill("#8A6448");
      deco.roundRect(x - 10, 238, 25, 26, 6).fill("#FFD27A").stroke({ color: OUT, width: 3 });
    }
    deco.roundRect(30, 400, 120, 50, 8).fill("#8A949E").stroke({ color: OUT, width: 4 });
    for (const x of [55, 125]) deco.circle(x, 452, 14).fill("#3A2A22");
    for (let i = 0; i < 5; i++) deco.circle(50 + i * 22, 398, 12).fill(ROCK_COLORS[i % 4]).stroke({ color: OUT, width: 2 });
    this.mid.addChild(deco);
    const gr = new Graphics();
    gr.rect(0, 376, VW, VH - 376).fill("#D8C3A0");
    gr.rect(0, 376, VW, 10).fill("#E6D4B4");
    for (let i = 0; i < 40; i++) gr.circle((i * 97) % VW, 400 + ((i * 41) % 120), 3 + (i % 3)).fill("#C4AC86");
    this.mid.addChild(gr);
    this.mid.addChild(deco);

    this.player = await this.animal(this.mascot, 1, 150);
    this.player.position.set(170, 490);
    this.npc = await this.animal(this.mascot === "raccoon" ? "panda" : "raccoon", -1, 150);
    this.npc.position.set(800, 490);
    // hard hat for the miner
    const hat = new Graphics().ellipse(0, 0, 40, 12).fill("#F6C445").stroke({ color: OUT, width: 3 });
    hat.ellipse(0, -10, 28, 20).fill("#F6C445").stroke({ color: OUT, width: 3 });
    hat.circle(-14, -8, 6).fill("#FFF4C2");
    hat.position.set(800, 352);
    this.front.addChild(this.npc, this.player, hat);
    const makePick = (c: Container) => {
      c.addChild(new Graphics().roundRect(-5, -96, 10, 100, 5).fill("#B07A4A").stroke({ color: OUT, width: 3 }));
      c.addChild(new Graphics().poly([-40, -92, 0, -112, 40, -92, 0, -100]).fill("#C8D0D8").stroke({ color: OUT, width: 3 }));
    };
    makePick(this.pick);
    makePick(this.npcPick);
    this.pick.position.set(205, 410);
    this.npcPick.position.set(765, 410);
    this.npcPick.scale.x = -1;
    this.front.addChild(this.pick, this.npcPick);
    this.rocks = [0, 1, 2, 3].map((i) => {
      const c = new Container();
      const g = new Graphics();
      g.ellipse(0, 6, 54, 12).fill({ color: "#000", alpha: 0.12 });
      g.poly([-52, 4, -44, -46, -10, -70, 30, -60, 52, -22, 50, 4]).fill("#B9AFA3").stroke({ color: OUT, width: 4 });
      g.poly([-30, -30, -12, -50, 6, -34, -10, -16]).fill(ROCK_COLORS[i]).stroke({ color: OUT, width: 2 });
      g.poly([14, -24, 28, -40, 36, -18]).fill(ROCK_COLORS[i]).stroke({ color: OUT, width: 2 });
      c.addChild(g);
      const k = new Text({ text: ROCK_KEYS[i], style: { fontFamily: FONT, fontSize: 18, fontWeight: "900", fill: "#3A2A22", stroke: { color: "#FFF9F0", width: 5 } } });
      k.anchor.set(0.5);
      k.position.set(0, 34);
      c.addChild(k);
      c.position.set(330 + i * 100, 460);
      this.mid.addChild(c);
      return c;
    });
    this.ui.addChild(this.lane);
    this.status = new Text({ text: "", style: { fontFamily: FONT, fontSize: 36, fontWeight: "900", fill: "#E46F3E", stroke: { color: "#FFF9F0", width: 8 } } });
    this.status.anchor.set(0.5);
    this.status.position.set(VW / 2, 86);
    this.ui.addChild(this.status);

    const KEYMAP: Record<string, number> = { d: 0, f: 1, j: 2, k: 3, "1": 0, "2": 1, "3": 2, "4": 3, arrowleft: 0, arrowdown: 1, arrowup: 2, arrowright: 3 };
    this.on(window, "keydown", ((e: KeyboardEvent) => {
      const b = KEYMAP[e.key.toLowerCase()];
      if (b === undefined) return;
      e.preventDefault();
      if (!e.repeat) this.press(b);
    }) as EventListener);
  }

  /** Touch buttons call this too. */
  press(b: number) {
    if (!this.round || !this.resolve || b >= this.round.buttons) return;
    const now = performance.now() - this.t0;
    if (now < this.round.turnStartMs - 500) return; // NPC's turn: watch first
    this.strikes.push({ t: Math.round(now), b });
    this.pSwing = 0;
    this.pTarget = b;
    sfx.strike(b);
    const c = this.round;
    let best = -1;
    for (let i = 0; i < c.expected.length; i++) {
      if (this.used[i] || this.missedExp.has(i)) continue;
      const d = Math.abs(c.expected[i].t - now);
      if (d <= c.hitMs && (best < 0 || d < Math.abs(c.expected[best].t - now))) best = i;
    }
    const rock = this.rocks[b];
    if (best < 0) return this.localMiss(rock, "Off-beat");
    this.used[best] = true;
    if (c.expected[best].b !== b) return this.localMiss(rock, "Wrong rock");
    const q = Math.abs(c.expected[best].t - now) <= c.perfectMs ? "perfect" : "hit";
    sfx.crack(q === "perfect");
    this.onLocal(q);
    this.rockFlash[b] = 1;
    this.shake = q === "perfect" ? 12 : 5;
    this.float(q === "perfect" ? "PERFECT!" : "Hit", rock.x, rock.y - 120, q === "perfect" ? "#3F9B5B" : "#D9A21B", q === "perfect" ? 40 : 30);
    this.burst(rock.x, rock.y - 40, q === "perfect" ? 24 : 10, [ROCK_COLORS[b], "#B9AFA3", "#FFF4C2"], q === "perfect" ? 380 : 240, q === "perfect" ? 6 : 4);
  }

  private localMiss(rock: Container, why: string) {
    sfx.miss();
    sfx.heartLost();
    this.onLocal("miss");
    this.float(`Miss · ${why}`, rock.x, rock.y - 120, "#D8473A", 26);
  }

  play(round: StoneRound): Promise<{ t: number; b: number }[]> {
    this.round = round;
    this.strikes = [];
    this.demoDone.clear();
    this.ticks.clear();
    this.used = round.expected.map(() => false);
    this.missedExp.clear();
    this.t0 = performance.now();
    this.rocks.forEach((r, i) => (r.alpha = i < round.buttons ? 1 : 0.25));
    return new Promise((r) => (this.resolve = r));
  }

  protected update(dt: number) {
    this.player.scale.y = 1 + Math.sin(this.clock * 2.4) * 0.012;
    this.npc.scale.y = 1 + Math.sin(this.clock * 2.1 + 1) * 0.012;
    const swingAnim = (c: Container, s: number, dir: 1 | -1, target: number, baseX: number) => {
      if (s < 0) {
        c.rotation = dir * (-0.5 + Math.sin(this.clock * 2) * 0.03);
        c.x = baseX;
        return -1;
      }
      const reach = dir === 1 ? (target * 100 + 330 - 205) * 0.25 : -(765 - (target * 100 + 330)) * 0.25;
      c.x = baseX + reach * Math.sin(Math.min(1, s / 0.25) * Math.PI);
      c.rotation = dir * (s < 0.06 ? -0.5 + (s / 0.06) * 1.7 : s < 0.28 ? 1.2 - ((s - 0.06) / 0.22) * 1.7 : -0.5);
      return s + dt > 0.3 ? -1 : s + dt;
    };
    this.pSwing = swingAnim(this.pick, this.pSwing, 1, this.pTarget, 205);
    this.nSwing = swingAnim(this.npcPick, this.nSwing, -1, this.nTarget, 765);
    this.rocks.forEach((r, i) => {
      this.rockFlash[i] = Math.max(0, this.rockFlash[i] - dt * 4);
      r.scale.set(1 + this.rockFlash[i] * 0.08, 1 - this.rockFlash[i] * 0.05);
    });
    this.lane.clear();
    const c = this.round;
    if (!c || !this.resolve) return;
    const now = performance.now() - this.t0;
    // NPC demonstration: swing starts 110 ms early so the impact lands on the beat
    c.demo.forEach((n, i) => {
      if (!this.demoDone.has(i) && now >= n.t - 110) {
        this.demoDone.add(i);
        this.nSwing = 0;
        this.nTarget = n.b;
        window.setTimeout(() => {
          if (this.destroyed) return;
          sfx.strike(n.b, true);
          this.rockFlash[n.b] = 1;
          this.burst(this.rocks[n.b].x, this.rocks[n.b].y - 40, 8, [ROCK_COLORS[n.b], "#B9AFA3"], 220, 4);
        }, 110);
      }
    });
    // count-in ticks: Ready · Set · GO (the first strike is on GO)
    const marks = [c.turnStartMs - 2 * c.beatMs, c.turnStartMs - c.beatMs];
    marks.forEach((m, i) => {
      if (!this.ticks.has(i) && now >= m) {
        this.ticks.add(i);
        sfx.tick(i === 1);
      }
    });
    if (!this.ticks.has(9) && now >= c.turnStartMs - 40) {
      this.ticks.add(9);
      sfx.turn();
    }
    if (now < c.demo[c.demo.length - 1].t + c.beatMs) this.status.text = "Watch and listen…";
    else if (now < c.turnStartMs - c.beatMs) this.status.text = "Ready…";
    else if (now < c.turnStartMs - 60) this.status.text = "Set…";
    else if (now < c.turnStartMs + 500) this.status.text = "Your turn!";
    else this.status.text = "Repeat the rhythm";
    // memory lane: dots appear as the NPC strikes, then fade before your turn
    const span = c.demo[c.demo.length - 1].t - c.demo[0].t || 1;
    const fade = now < c.turnStartMs - c.beatMs ? 1 : Math.max(0, 1 - (now - (c.turnStartMs - c.beatMs)) / (c.beatMs * 1.5));
    const x0 = VW / 2 - 220, y = 140;
    this.lane.roundRect(x0 - 20, y - 22, 480, 44, 22).fill({ color: "#FFF9F0", alpha: 0.85 }).stroke({ color: "#8A6448", width: 3 });
    c.demo.forEach((n, i) => {
      if (!this.demoDone.has(i) || now < n.t) return;
      this.lane.circle(x0 + ((n.t - c.demo[0].t) / span) * 440, y, 11).fill({ color: ROCK_COLORS[n.b], alpha: fade }).stroke({ color: OUT, width: 2, alpha: fade });
    });
    // your strikes on the same lane
    const tStart = c.turnStartMs;
    for (const s of this.strikes) {
      const x = x0 + ((s.t - tStart) / span) * 440;
      if (x >= x0 - 30 && x <= x0 + 470) this.lane.circle(x, y, 7).fill({ color: ROCK_COLORS[s.b] }).stroke({ color: "#3A2A22", width: 2 });
    }
    // expected strikes that passed without the right input are Misses
    c.expected.forEach((e, i) => {
      if (!this.used[i] && !this.missedExp.has(i) && now > e.t + c.hitMs) {
        this.missedExp.add(i);
        this.localMiss(this.rocks[e.b], "Missed beat");
      }
    });
    if (now > c.durationMs) {
      const r = this.resolve;
      this.resolve = null;
      this.status.text = "";
      r(this.strikes);
    }
  }
}
