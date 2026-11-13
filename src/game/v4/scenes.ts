/**
 * The Wood mini-game scene (PixiJS): one timing bar, one button.
 * An indicator slides across the bar; the player stops it (Space / click / tap). Green = Perfect,
 * yellow = Hit, anywhere else = Miss. Presentation only: the server re-judges every stop time.
 *
 * Art slots (optional, public/game/sprites/wood/*.png): background, clouds, stump, log,
 * log_left, log_right, axe. Anything missing is drawn in code.
 */
import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { Mascot } from "@/game/world/mascots";
import { sfx } from "./sfx";
import { barAt, judgeStop, markerHidden, timeoutOf, type BarAttempt, type Judgement } from "./rules";

const VW = 960, VH = 540;
const FONT = "Nunito, system-ui, sans-serif";
const OUT = "#6B4A33";
const SLOTS = ["background", "clouds", "stump", "log", "log_left", "log_right", "axe"] as const;
type Slot = (typeof SLOTS)[number];

type Particle = { g: Graphics; vx: number; vy: number; vr: number; life: number; max: number };

async function tryLoad(url: string): Promise<Texture | null> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    if (!r.ok) return null;
    const t = (await Assets.load(url)) as Texture;
    t.source.scaleMode = "linear";
    t.source.autoGenerateMipmaps = true;
    t.source.updateMipmaps();
    return t;
  } catch {
    return null;
  }
}

export class WoodScene {
  private app = new Application();
  private root = new Container();
  private art: Partial<Record<Slot, Texture>> = {};
  private clouds = new Container();
  private bgSprite: Sprite | null = null;
  private cloudW = VW;
  private player = new Container();
  private axe = new Container();
  private axeT = -1;
  private axeStrength = 1;
  private log = new Container();
  private halves: { c: Container; vx: number; vy: number; vr: number; life: number }[] = [];
  private parts: Particle[] = [];
  private floats: { t: Text; life: number }[] = [];
  private bar = new Graphics();
  private barLabel!: Text;
  // multi-target groups share one timeline
  private group: BarAttempt[] = [];
  private groupResults: ("perfect" | "hit" | "miss" | null)[] = [];
  private prevStop: number | null | undefined = undefined;
  private groupTimedOut = false;
  // combo + "fever" presentation
  private combo = 0;
  private comboText!: Text;
  private comboPop = 0;
  private banner: { t: Text; life: number } | null = null;
  private fever = new Graphics();
  private feverLevel = 0;
  private sparkT = 0;
  private lean = 0;
  private shake = 0;
  private clock = 0;
  private stumble = 0;
  private destroyed = false;
  private cleanup: (() => void)[] = [];
  // the active attempt
  private attempt: BarAttempt | null = null;
  private t0 = 0;
  private stoppedAt: number | null = null;
  private frozen: { indicator: number; zone: number } | null = null;
  private resolve: ((stop: number | null) => void) | null = null;
  private lastInput = 0;

  constructor(private mascot: Mascot, public onJudged: (j: Judgement) => void) {}

  async mount(el: HTMLElement) {
    await this.app.init({ resizeTo: el, background: "#FCE9C8", antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, preference: "webgl" });
    if (this.destroyed) return this.app.destroy({ removeView: true });
    el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = "none";
    const loaded = await Promise.all(SLOTS.map((k) => tryLoad(`/game/sprites/wood/${k}.png`)));
    SLOTS.forEach((k, i) => loaded[i] && (this.art[k] = loaded[i]!));
    if (this.destroyed) return;
    this.app.stage.addChild(this.root);
    await this.build();
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) this.chop();
      }
    };
    window.addEventListener("keydown", down);
    this.cleanup.push(() => window.removeEventListener("keydown", down));
    this.app.canvas.addEventListener("pointerdown", () => this.chop());
    this.app.ticker.add((tk) => this.update(Math.min(0.05, tk.deltaMS / 1000)));
  }

  // ───────────────────────────── scene ─────────────────────────────

  private sprite(t: Texture, x: number, y: number, h: number, ax = 0.5, ay = 1) {
    const s = new Sprite(t);
    s.anchor.set(ax, ay);
    s.scale.set(h / t.height);
    s.position.set(x, y);
    return s;
  }

  private async build() {
    // background
    if (this.art.background) {
      // the painted background covers the whole screen (no letterbox bands); the play area scales to fit inside it
      this.bgSprite = new Sprite(this.art.background);
      this.bgSprite.anchor.set(0.5, 0.5);
      this.app.stage.addChildAt(this.bgSprite, 0);
    } else this.root.addChild(this.drawnBackground());
    // drifting clouds
    this.root.addChild(this.clouds);
    for (let k = 0; k < 3; k++) {
      const part = this.art.clouds ? this.sprite(this.art.clouds, 0, 150, 120, 0, 1) : this.drawnClouds();
      if (this.art.clouds) this.cloudW = part.width;
      part.x = k * this.cloudW;
      this.clouds.addChild(part);
    }
    // stump and log
    const stumpX = 560, stumpY = 430;
    if (this.art.stump) this.root.addChild(this.sprite(this.art.stump, stumpX, stumpY + 40, 96));
    else {
      const g = new Graphics();
      g.ellipse(stumpX, stumpY + 38, 76, 14).fill({ color: "#000", alpha: 0.14 });
      g.roundRect(stumpX - 56, stumpY - 6, 112, 46, 10).fill("#9C6B45").stroke({ color: OUT, width: 4 });
      g.ellipse(stumpX, stumpY - 6, 56, 15).fill("#E9C99A").stroke({ color: OUT, width: 4 });
      g.ellipse(stumpX, stumpY - 6, 32, 8).stroke({ color: "#C9A77C", width: 2 });
      this.root.addChild(g);
    }
    this.log.position.set(stumpX, stumpY - 10);
    this.root.addChild(this.log);
    this.resetLog();
    // the player's animal with its axe
    const body = await this.animal();
    this.player.addChild(body);
    this.player.position.set(410, 470);
    this.root.addChild(this.player);
    if (this.art.axe) {
      const a = this.sprite(this.art.axe, 0, 8, 120, 0.5, 0.92);
      a.scale.x *= -1; // the painted axe faces left: mirror it so the blade cuts the log
      this.axe.addChild(a);
    } else {
      this.axe.addChild(new Graphics().roundRect(-5, -100, 10, 104, 5).fill("#B07A4A").stroke({ color: OUT, width: 3 }));
      const head = new Graphics().poly([-6, -104, 36, -118, 42, -84, -6, -80]).fill("#C8D0D8").stroke({ color: OUT, width: 3 });
      head.rect(-8, -106, 12, 30).fill("#8A949E");
      this.axe.addChild(head);
    }
    this.axe.position.set(456, 402);
    this.axe.rotation = -0.6;
    this.root.addChild(this.axe);
    // the timing bar
    this.root.addChild(this.bar);
    this.barLabel = new Text({ text: "", style: { fontFamily: FONT, fontSize: 17, fontWeight: "900", fill: "#3A2A22", stroke: { color: "#FFF9F0", width: 5 } } });
    this.barLabel.anchor.set(0.5);
    this.barLabel.position.set(VW / 2, 196);
    this.root.addChild(this.barLabel);
    this.comboText = new Text({ text: "", style: { fontFamily: FONT, fontSize: 44, fontWeight: "900", fill: "#FF7A2F", stroke: { color: "#FFF9F0", width: 8 }, dropShadow: { color: "#6B4A33", distance: 4, angle: Math.PI / 2, alpha: 0.5, blur: 0 } } });
    this.comboText.anchor.set(0.5);
    this.comboText.position.set(720, 300);
    this.comboText.visible = false; // the combo counter is shown by the page (right side, with the multiplier)
    this.root.addChild(this.comboText);
    this.app.stage.addChild(this.fever); // screen-edge glow on top of everything when the combo is hot
  }

  /** The combo the server confirmed at the start of a round (the scene keeps counting from there). */
  setCombo(c: number) {
    this.combo = c;
    this.comboText.text = c >= 2 ? `×${c} COMBO` : "";
  }

  private bumpCombo(hit: boolean) {
    if (!hit) {
      if (this.combo >= 3) this.showBanner("Combo lost!", "#D8473A", 40);
      this.combo = 0;
      this.comboText.text = "";
      return;
    }
    this.combo += 1;
    const c = this.combo;
    if (c >= 2) {
      this.comboText.text = `×${c} COMBO`;
      this.comboPop = 1;
    }
    const milestones: Record<number, [string, string]> = { 3: ["GREAT!", "#3F9B5B"], 5: ["AWESOME!", "#2E8BC0"], 10: ["ON FIRE! 🔥", "#FF6A1A"], 15: ["UNSTOPPABLE!", "#C2410C"], 20: ["LEGENDARY!", "#9333EA"], 30: ["GODLIKE!!", "#DB2777"] };
    const m = milestones[c] ?? (c > 30 && c % 10 === 0 ? (["GODLIKE!!", "#DB2777"] as [string, string]) : null);
    if (m) {
      this.showBanner(m[0], m[1], 64);
      this.shake = Math.max(this.shake, 18);
      this.burst(VW / 2, 250, 30, ["#FFD34D", "#FF8A3C", "#FFFFFF", m[1]], 520, 7);
      sfx.win();
    }
  }

  private showBanner(text: string, color: string, size: number) {
    this.banner?.t.destroy();
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: "900", fill: color, stroke: { color: "#FFF9F0", width: 10 }, dropShadow: { color: "#3A2A22", distance: 5, angle: Math.PI / 2, alpha: 0.45, blur: 0 } } });
    t.anchor.set(0.5);
    t.position.set(VW / 2, 270);
    this.root.addChild(t);
    this.banner = { t, life: 0 };
  }

  private drawnBackground() {
    const c = new Container();
    const g = new Graphics();
    ["#FCE4C0", "#FBE9CC", "#F9EED8", "#F4F0DC"].forEach((col, i) => g.rect(0, i * 70, VW, 72).fill(col));
    g.circle(800, 90, 44).fill("#FFF1B8");
    g.ellipse(160, 340, 260, 90).fill("#BFD9A0").ellipse(560, 350, 300, 100).fill("#B3D394").ellipse(900, 340, 240, 90).fill("#BFD9A0");
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 112, s = 0.75 + ((i * 37) % 5) * 0.05;
      g.roundRect(x - 6 * s, 360 - 40 * s, 12 * s, 42 * s, 4).fill("#8C5E3C");
      for (const [dx, dy, r] of [[0, -78, 36], [-26, -58, 26], [26, -58, 26]]) g.circle(x + dx * s, 360 + (dy + 3) * s, r * s).fill("#5E9550");
      for (const [dx, dy, r] of [[0, -78, 36], [-26, -58, 26], [26, -58, 26]]) g.circle(x + dx * s, 360 + dy * s, r * s).fill(i % 3 ? "#7DB662" : "#88BE6B");
    }
    g.rect(0, 378, VW, VH - 378).fill("#9CCB78").rect(0, 378, VW, 10).fill("#B6DC92");
    for (let i = 0; i < 16; i++) g.circle(30 + ((i * 211) % 900), 440 + ((i * 71) % 80), 5).fill(["#F7B2C4", "#FFE38A", "#FFFFFF", "#C9B5F0"][i % 4]);
    c.addChild(g);
    return c;
  }

  private drawnClouds() {
    const c = new Container();
    for (const [x, y, s] of [[120, 90, 1], [520, 60, 0.8], [820, 120, 0.7]]) {
      const g = new Graphics();
      for (const [dx, dy, r] of [[0, 0, 26], [28, -8, 32], [60, 0, 24], [30, 10, 26]]) g.circle(dx * s, dy * s, r * s).fill({ color: "#FFFFFF", alpha: 0.92 });
      g.position.set(x, y);
      c.addChild(g);
    }
    return c;
  }

  private async animal() {
    const c = new Container();
    c.addChild(new Graphics().ellipse(0, 0, 52, 11).fill({ color: "#000", alpha: 0.14 }));
    try {
      const t = (await Assets.load(`/game/sprites/mascots/${this.mascot}_side.png`)) as Texture;
      const s = new Sprite(t);
      s.anchor.set(0.5, 0.96);
      s.scale.set(150 / t.height);
      c.addChild(s);
    } catch {
      c.addChild(new Graphics().ellipse(0, -55, 42, 50).fill("#F5EDE3").stroke({ color: OUT, width: 3 }));
    }
    return c;
  }

  private drawLog(c: Container, kind: "whole" | "left" | "right") {
    c.removeChildren().forEach((x) => x.destroy());
    const tex = kind === "whole" ? this.art.log : kind === "left" ? this.art.log_left : this.art.log_right;
    if (tex) return void c.addChild(this.sprite(tex, 0, 0, kind === "whole" ? 92 : 88, kind === "whole" ? 0.5 : kind === "left" ? 1 : 0, 1));
    const g = new Graphics();
    if (kind === "whole") {
      g.roundRect(-36, -70, 72, 70, 10).fill("#B07A4A").stroke({ color: OUT, width: 4 });
      g.ellipse(0, -70, 36, 11).fill("#E9C99A").stroke({ color: OUT, width: 4 });
      g.ellipse(0, -70, 19, 5).stroke({ color: "#C9A77C", width: 2 });
      g.rect(-22, -52, 4, 32).fill({ color: "#8C5E3C", alpha: 0.6 });
      g.rect(14, -44, 4, 28).fill({ color: "#8C5E3C", alpha: 0.6 });
    } else {
      const x0 = kind === "left" ? -36 : 0;
      g.roundRect(x0, -70, 36, 70, 8).fill("#B07A4A").stroke({ color: OUT, width: 4 });
      g.rect(kind === "left" ? -4 : 0, -70, 4, 70).fill("#E9C99A");
    }
    c.addChild(g);
  }

  private resetLog() {
    this.drawLog(this.log, "whole");
    this.log.alpha = 1;
    this.log.rotation = 0;
    this.log.position.set(560, 420);
  }

  // ───────────────────────────── one attempt ─────────────────────────────

  /** Runs one timing-bar attempt. Resolves with the stop time (ms) after the feedback animation, or null on timeout. */
  playAttempt(a: BarAttempt, group: BarAttempt[] = [a]): Promise<number | null> {
    const seq = a.seq ?? 0;
    this.attempt = a;
    this.stoppedAt = null;
    this.frozen = null;
    if (seq === 0) {
      // a new bar: fresh timeline, fresh log
      this.group = group;
      this.groupResults = group.map(() => null);
      this.prevStop = undefined;
      this.groupTimedOut = false;
      this.resetLog();
      this.t0 = performance.now();
    }
    return new Promise((r) => {
      this.resolve = r;
      // the group already ran out of time: the remaining targets are misses too
      if (seq > 0 && this.groupTimedOut) this.finish(null, true);
    });
  }

  private chop() {
    const a = this.attempt;
    if (!a || this.stoppedAt !== null || !this.resolve) return;
    const now = performance.now();
    if (now - this.lastInput < 150) return; // one judgment per attempt, no double taps
    this.lastInput = now;
    const t = Math.round(now - this.t0);
    this.finish(t);
  }

  private finish(t: number | null, quiet = false) {
    const a = this.attempt!;
    const seq = a.seq ?? 0, size = a.size ?? 1;
    const last = seq >= size - 1;
    this.stoppedAt = t ?? -1;
    const j = judgeStop(a, t, seq > 0 ? this.prevStop : undefined);
    this.prevStop = t;
    if (t === null) this.groupTimedOut = true;
    this.groupResults[seq] = j.result;
    // freeze the bar only when the whole group is done; mid-group the marker keeps running
    this.frozen = last || t === null ? barAt(a, t ?? 0) : null;
    this.onJudged(j);
    this.bumpCombo(j.result !== "miss");
    if (quiet) {
      const resolve = this.resolve!;
      this.resolve = null;
      window.setTimeout(() => !this.destroyed && resolve(t), 30);
      return;
    }
    if (!last && t !== null) {
      // quick feedback, then straight on to the next target of the same bar
      if (j.result === "miss") {
        sfx.whiff();
        this.float("MISS", "#D8473A", 34);
      } else {
        sfx.chop(j.result === "perfect");
        this.float(j.result === "perfect" ? "PERFECT!" : "HIT!", j.result === "perfect" ? "#3F9B5B" : "#D9A21B", 34);
        this.burst(560, 380, 8, ["#E9C99A", "#C98A4A"], 260, 4);
        this.shake = 5;
      }
      this.axeT = 0;
      this.axeStrength = 0.9;
      const resolve = this.resolve!;
      this.resolve = null;
      window.setTimeout(() => !this.destroyed && resolve(t), 40);
      return;
    }
    this.axeT = 0;
    this.axeStrength = j.result === "perfect" ? 1.15 : j.result === "hit" ? 1 : 0.6;
    if (j.result === "perfect") {
      sfx.chop(true);
      this.shake = 14 + Math.min(16, this.combo);
      this.splitLog(1.5);
      this.burst(560, 380, 26, ["#E9C99A", "#C98A4A", "#F6C76C"], 420, 6);
      this.float("PERFECT!", "#3F9B5B", 46);
    } else if (j.result === "hit") {
      sfx.chop(false);
      this.shake = 6;
      this.splitLog(1);
      this.burst(560, 380, 12, ["#E9C99A", "#C98A4A"], 280, 4);
      this.float("HIT!", "#D9A21B", 38);
    } else {
      sfx.whiff();
      sfx.heartLost();
      this.stumble = 0.45;
      this.float(j.reason === "timeout" ? "Too slow!" : "MISS", "#D8473A", 38);
    }
    const resolve = this.resolve!;
    this.resolve = null;
    window.setTimeout(() => {
      if (!this.destroyed) resolve(t);
    }, j.result === "miss" ? 650 : 520);
  }

  private splitLog(power: number) {
    this.log.alpha = 0;
    for (const side of ["left", "right"] as const) {
      const c = new Container();
      this.drawLog(c, side);
      c.position.set(560, 420);
      this.root.addChild(c);
      this.halves.push({ c, vx: (side === "left" ? -1 : 1) * 230 * power, vy: -300 * power, vr: (side === "left" ? -1 : 1) * 5 * power, life: 0 });
    }
  }

  private burst(x: number, y: number, n: number, colors: string[], speed: number, size: number) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      if (i % 3 === 0) g.rect(-size, -size / 2, size * 2, size).fill(colors[i % colors.length]);
      else g.circle(0, 0, size * (0.5 + Math.random() * 0.6)).fill(colors[i % colors.length]);
      g.position.set(x, y);
      this.root.addChild(g);
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = speed * (0.4 + Math.random());
      this.parts.push({ g, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, vr: (Math.random() - 0.5) * 12, life: 0, max: 0.6 + Math.random() * 0.5 });
    }
  }

  private float(text: string, color: string, size: number) {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fontWeight: "900", fill: color, stroke: { color: "#FFF9F0", width: 7 } } });
    t.anchor.set(0.5);
    t.position.set(560, 300);
    this.root.addChild(t);
    this.floats.push({ t, life: 0 });
  }

  /** Shows the Wood a chop earned (called by the overlay once it knows the amount). */
  showReward(text: string) {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: 24, fontWeight: "900", fill: "#8A5A33", stroke: { color: "#FFF9F0", width: 6 } } });
    t.anchor.set(0.5);
    t.position.set(560, 340);
    this.root.addChild(t);
    this.floats.push({ t, life: 0.05 });
  }

  // ───────────────────────────── frame ─────────────────────────────

  private update(dt: number) {
    if (this.destroyed) return;
    this.clock += dt;
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const k = Math.min(sw / VW, sh / VH);
    this.root.scale.set(k);
    this.root.position.set((sw - VW * k) / 2 + (Math.random() - 0.5) * this.shake, (sh - VH * k) / 2 + (Math.random() - 0.5) * this.shake);
    this.shake *= 0.85;
    if (this.bgSprite) {
      const t = this.bgSprite.texture;
      this.bgSprite.scale.set(Math.max(sw / t.width, sh / t.height));
      this.bgSprite.position.set(sw / 2, sh / 2);
    }
    // clouds drift
    this.clouds.x -= 12 * dt;
    if (this.clouds.x <= -this.cloudW) this.clouds.x += this.cloudW;
    // breathing + stumble
    this.player.scale.y = 1 + Math.sin(this.clock * 2.6) * 0.012;
    if (this.stumble > 0) {
      this.stumble -= dt;
      this.player.rotation = Math.sin(this.stumble * 30) * 0.08;
    } else this.player.rotation = 0;
    // axe: raised over the shoulder → down on the log → back up
    if (this.axeT >= 0) {
      this.axeT += dt;
      const a = this.axeT, down = -0.6 + 2.2 * this.axeStrength;
      this.axe.rotation = a < 0.07 ? -0.6 + (a / 0.07) * (down + 0.6) : a < 0.32 ? down - ((a - 0.07) / 0.25) * (down + 0.6) : -0.6;
      if (a > 0.32) this.axeT = -1;
    } else this.axe.rotation = -0.6 + Math.sin(this.clock * 2.6) * 0.03;
    // the whole body swings into the chop: a quick wind-up, then a lunge toward the log
    const ax = this.axeT;
    const targetLean = ax < 0 ? 0 : ax < 0.07 ? -0.5 : ax < 0.16 ? 1 : 1 - (ax - 0.16) / 0.16;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 30);
    if (this.stumble <= 0) this.player.rotation = this.lean * 0.16;
    this.player.x = 410 + this.lean * 16;
    this.player.scale.set(1 + this.lean * 0.04, (1 + Math.sin(this.clock * 2.6) * 0.012) * (1 - this.lean * 0.06));
    this.axe.x = 456 + this.lean * 16;
    // combo counter pop + colour heat
    this.comboPop = Math.max(0, this.comboPop - dt * 3);
    this.comboText.scale.set(1 + this.comboPop * 0.5);
    this.comboText.rotation = Math.sin(this.clock * 9) * 0.04 * Math.min(1, this.combo / 10);
    this.comboText.style.fill = this.combo >= 15 ? "#C2410C" : this.combo >= 10 ? "#FF5A1A" : this.combo >= 5 ? "#FF7A2F" : "#E9963A";
    // milestone banner: slam in, hold, float away
    if (this.banner) {
      const b = this.banner;
      b.life += dt;
      const k = b.life < 0.18 ? 2.2 - (b.life / 0.18) * 1.2 : 1;
      b.t.scale.set(k);
      b.t.y = 270 - Math.max(0, b.life - 0.7) * 120;
      b.t.alpha = Math.max(0, 1 - Math.max(0, b.life - 0.7) / 0.4);
      if (b.life > 1.1) {
        b.t.destroy();
        this.banner = null;
      }
    }
    // fever: glowing screen edges + sparks from the log once the combo is hot
    const fl = this.combo >= 10 ? 1 : this.combo >= 5 ? 0.5 : 0;
    this.feverLevel += (fl - this.feverLevel) * Math.min(1, dt * 4);
    this.fever.clear();
    if (this.feverLevel > 0.02) {
      const pulse = 0.6 + Math.sin(this.clock * 6) * 0.4;
      const al = this.feverLevel * pulse;
      const edge = 26 + this.feverLevel * 30;
      this.fever.rect(0, 0, sw, edge).fill({ color: 0xff7a1a, alpha: 0.28 * al });
      this.fever.rect(0, sh - edge, sw, edge).fill({ color: 0xff7a1a, alpha: 0.28 * al });
      this.fever.rect(0, 0, edge, sh).fill({ color: 0xff7a1a, alpha: 0.28 * al });
      this.fever.rect(sw - edge, 0, edge, sh).fill({ color: 0xff7a1a, alpha: 0.28 * al });
      this.sparkT += dt;
      if (this.sparkT > 0.12 / this.feverLevel) {
        this.sparkT = 0;
        this.burst(560, 360, 2, ["#FFD34D", "#FF8A3C"], 220, 3);
      }
    }
    // log halves, particles, floating text
    this.halves = this.halves.filter((h) => {
      h.life += dt;
      h.vy += 1400 * dt;
      h.c.x += h.vx * dt;
      h.c.y = Math.min(470, h.c.y + h.vy * dt);
      h.c.rotation += h.vr * dt;
      h.c.alpha = Math.max(0, 1 - Math.max(0, h.life - 0.5) / 0.35);
      if (h.life > 0.85) h.c.destroy({ children: true });
      return h.life <= 0.85;
    });
    this.parts = this.parts.filter((p) => {
      p.life += dt;
      p.vy += 900 * dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.g.rotation += p.vr * dt;
      p.g.alpha = Math.max(0, 1 - p.life / p.max);
      if (p.life >= p.max) p.g.destroy();
      return p.life < p.max;
    });
    this.floats = this.floats.filter((f) => {
      f.life += dt;
      f.t.y -= 50 * dt;
      f.t.alpha = Math.max(0, 1 - Math.max(0, f.life - 0.45) / 0.35);
      if (f.life > 0.8) f.t.destroy();
      return f.life <= 0.8;
    });
    // the bar
    const a = this.attempt;
    if (!a) {
      this.bar.clear();
      this.barLabel.text = "";
      return;
    }
    const elapsed = performance.now() - this.t0;
    const limit = timeoutOf(a);
    if (this.stoppedAt === null && this.resolve && elapsed > limit) this.finish(null);
    const st = this.frozen ?? barAt(a, elapsed);
    const hidden = !this.frozen && this.stoppedAt === null && markerHidden(a, elapsed);
    this.drawBar(a, st.indicator, st.zone, hidden, this.frozen ? -1 : Math.max(0, 1 - elapsed / limit));
    const size = a.size ?? 1;
    this.barLabel.text =
      this.stoppedAt !== null ? "" : size > 1 ? `${size === 2 ? "DOUBLE" : "TRIPLE"}! Hit target ${(a.seq ?? 0) + 1} of ${size}` : hidden ? "👀 Feel the rhythm…" : a.n < 2 ? "Press Space or tap to chop!" : "";
  }

  private drawBar(a: BarAttempt, indicator: number, zone: number, hidden = false, timeLeft = -1) {
    const g = this.bar;
    g.clear();
    const w = 640, h = 38, x0 = (VW - w) / 2, y = 108;
    const hot = this.combo >= 10;
    g.roundRect(x0 - 8, y - 8, w + 16, h + 16, 24).fill(hot ? "#E8731A" : "#8A6448");
    g.roundRect(x0 - 4, y - 4, w + 8, h + 8, 20).fill("#FFF9F0");
    g.roundRect(x0, y, w, h, 16).fill("#EADCC8");
    const targets = (a.size ?? 1) > 1 && this.group.length ? this.group : [a];
    targets.forEach((t, i) => {
      const cur = t === a || targets.length === 1;
      const z = cur ? zone : barAt(t, 0).zone;
      const res = this.groupResults[i];
      const alpha = res ? 0.35 : cur ? 1 : 0.55;
      g.roundRect(x0 + (z - t.yellow / 2) * w, y, t.yellow * w, h, 10).fill({ color: "#F6D35C", alpha });
      g.roundRect(x0 + (z - t.green / 2) * w, y, t.green * w, h, 8).fill({ color: "#5CC17A", alpha });
      if (targets.length > 1) {
        // number badge above each target; the current one pulses
        const cx = x0 + z * w;
        const r = cur && !res ? 13 + Math.sin(this.clock * 10) * 1.5 : 11;
        g.circle(cx, y - 22, r).fill(res === "miss" ? "#D8473A" : res ? "#3F9B5B" : cur ? "#F58A3C" : "#C9B39C").stroke({ color: "#FFF9F0", width: 3 });
        if (cur && !res) g.roundRect(x0 + (z - t.yellow / 2) * w - 3, y - 3, t.yellow * w + 6, h + 6, 12).stroke({ color: "#F58A3C", width: 3 });
      }
    });
    // the marker (it fades out on tricky bars)
    if (!hidden) {
      const px = x0 + indicator * w;
      g.roundRect(px - 5, y - 12, 10, h + 24, 5).fill("#3A2A22");
      g.poly([px - 10, y - 16, px + 10, y - 16, px, y - 4]).fill("#3A2A22");
    }
    // countdown under the bar: green → amber → red, pulsing at the end
    if (timeLeft >= 0) {
      const ty = y + h + 16, tw = w * timeLeft;
      const col = timeLeft > 0.5 ? "#5CC17A" : timeLeft > 0.25 ? "#F2B43A" : "#E2523F";
      const th = timeLeft < 0.25 ? 10 + Math.sin(this.clock * 20) * 2 : 10;
      g.roundRect(x0, ty, w, 10, 5).fill({ color: "#3A2A22", alpha: 0.25 });
      if (tw > 1) g.roundRect(x0, ty + (10 - th) / 2, tw, th, 5).fill(col);
    }
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
