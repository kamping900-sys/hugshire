/**
 * Deterministic footage capture from the real Hugshire app.
 *
 * The page's clock (Date, timers, requestAnimationFrame, performance) is faked by Playwright and
 * advanced exactly 1/30 s per frame. CSS animations are paused and driven from the same clock, so
 * UI motion and the PixiJS game stay in step and the footage is perfectly smooth, however slow the
 * screenshots are. Frames are piped straight into ffmpeg (H.264, near-lossless) per clip.
 */
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { chromium } = require(path.join(__dirname, "..", "..", "node_modules", "playwright"));
const FFMPEG = require("ffmpeg-static");

const BASE = process.env.TRAILER_URL || "http://localhost:3300";
const OUT = path.join(__dirname, "..", "footage");
fs.mkdirSync(OUT, { recursive: true });
const FPS = 30;
const STEP = 1000 / FPS;

class Recorder {
  static async open({ width = 1280, height = 720, scale = 1.5, storageState } = {}) {
    const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, storageState, baseURL: BASE });
    // the music toggle is not part of any shot
    await context.addInitScript(() => {
      const css = 'button[aria-label^="Turn music"]{display:none!important}';
      const add = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
      if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
    });
    const page = await context.newPage();
    // time only moves when the recorder steps it (install alone lets it keep flowing in real time)
    const t0 = Date.now();
    await page.clock.install({ time: t0 });
    await page.clock.pauseAt(t0 + 1000);
    const r = new Recorder();
    Object.assign(r, { browser, context, page, width, height, scale, ff: null, clipFrames: 0, timeScale: 1 });
    page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
    return r;
  }

  /** Signs in a test-mode user (the dev code API) and keeps the session cookie. */
  async signIn(email) {
    const req = this.context.request;
    const a = await (await req.post(`${BASE}/api/auth/dev/request`, { data: { email }, headers: { origin: BASE } })).json();
    const v = await req.post(`${BASE}/api/auth/dev/verify`, { data: { email, code: a.devCode }, headers: { origin: BASE } });
    if (!v.ok()) throw new Error("sign-in failed " + (await v.text()));
  }

  async api(method, url, data) {
    const res = await this.context.request.fetch(`${BASE}${url}`, { method, data, headers: { origin: BASE } });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return txt; }
  }

  async goto(url, { settle = 1500 } = {}) {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.pump(settle);
  }

  /** Moves the page clock forward without recording (loading, setting up a shot). */
  async pump(ms, chunk = 50) {
    for (let t = 0; t < ms; t += chunk) {
      await this.page.clock.runFor(chunk);
      await this.syncCss();
      await this.page.waitForTimeout(8); // let real network callbacks land
    }
  }

  /** Pumps until a condition in the page is true (or gives up). */
  async until(fn, arg, { max = 20000, chunk = 100 } = {}) {
    for (let t = 0; t < max; t += chunk) {
      if (await this.page.evaluate(fn, arg).catch(() => false)) return true;
      await this.pump(chunk, chunk);
    }
    console.log("[until] gave up:", fn.toString().slice(0, 120));
    return false;
  }

  /** Drives every CSS animation/transition from the fake clock. */
  async syncCss() {
    await this.page
      .evaluate((step) => {
        const now = performance.now();
        for (const a of document.getAnimations()) {
          if (!a.__hs) {
            a.__hs = { t0: now - Math.min(Number(a.currentTime) || 0, step) };
            try { a.pause(); } catch {}
          }
          try { a.currentTime = now - a.__hs.t0; } catch {}
        }
      }, STEP)
      .catch(() => {});
  }

  /** alpha: true records a transparent overlay (PNG frames → QuickTime Animation .mov with alpha). */
  startClip(name, { alpha = false, dir = OUT } = {}) {
    if (this.ff) throw new Error("clip already open");
    this.alpha = alpha;
    const W = Math.round(this.width * this.scale), H = Math.round(this.height * this.scale);
    const file = path.join(dir, `${name}.${alpha ? "mov" : "mp4"}`);
    const enc = alpha ? ["-c:v", "qtrle", "-pix_fmt", "argb"] : ["-vf", `scale=${W}:${H}:flags=lanczos`, "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p"];
    this.ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", ...enc, file], { stdio: ["pipe", "inherit", "inherit"] });
    this.ffDone = new Promise((res) => this.ff.on("close", res));
    this.clipName = name;
    this.clipFrames = 0;
    this.clipStarted = Date.now();
  }

  /** Records n frames; onFrame(i, seconds) runs before each frame for input or camera work. */
  async frames(n, onFrame) {
    for (let i = 0; i < n; i++) {
      if (onFrame) await onFrame(i, i / FPS);
      await this.page.clock.runFor(STEP * this.timeScale); // timeScale < 1 = smooth slow motion
      await this.syncCss();
      const buf = this.alpha
        ? await this.page.screenshot({ type: "png", omitBackground: true, animations: "allow", caret: "hide" })
        : await this.page.screenshot({ type: "jpeg", quality: 93, animations: "allow", caret: "hide" });
      this.lastFrame = buf;
      if (!this.ff.stdin.write(buf)) await new Promise((r) => this.ff.stdin.once("drain", r));
      this.clipFrames++;
    }
  }

  async seconds(s, onFrame) { return this.frames(Math.round(s * FPS), onFrame); }

  async endClip() {
    this.ff.stdin.end();
    await this.ffDone;
    const secs = (Date.now() - this.clipStarted) / 1000;
    console.log(`[clip] ${this.clipName}: ${this.clipFrames} frames (${(this.clipFrames / FPS).toFixed(1)}s) in ${secs.toFixed(0)}s`);
    this.ff = null;
  }

  async close() { await this.browser.close(); }
}

module.exports = { Recorder, BASE, FPS };
