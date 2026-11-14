/** Step-by-step shot direction on top of a Recorder: clicks and typing without Playwright's rAF waits. */
const fs = require("fs");
const path = require("path");

const HELPERS = `
window.__find = (text, sel) => {
  const els = [...document.querySelectorAll(sel || 'button, a, label, [role=button], input[type=checkbox]')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
    .filter((e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').includes(text));
  return els[els.length - 1] || null;
};
window.__click = (text, sel) => { const e = window.__find(text, sel); if (!e) return false; e.click(); return true; };
`;

class Director {
  constructor(rec, clip) {
    this.r = rec;
    this.clip = clip;
    this.marks = [];
  }
  get t() { return +(this.r.clipFrames / 30).toFixed(2); }
  mark(name) { this.marks.push({ name, t: this.t }); console.log(`  [${this.clip}] ${this.t.toFixed(2)}s ${name}`); }
  async inject() { await this.r.page.evaluate(HELPERS).catch(() => {}); }
  /** Records while waiting for a condition (or max seconds), then a little more. */
  async hold(seconds, onFrame) { await this.r.seconds(seconds, onFrame); }
  async until(fn, arg, max = 15) {
    for (let i = 0; i < max * 30; i++) {
      if (await this.r.page.evaluate(fn, arg).catch(() => false)) return true;
      await this.r.frames(1);
    }
    console.log("  [until] gave up", fn.toString().slice(0, 100));
    return false;
  }
  async click(text, sel) {
    await this.inject();
    const ok = await this.r.page.evaluate(([t, s]) => window.__click(t, s), [text, sel]);
    if (!ok) console.log("  [click] not found:", text);
    return ok;
  }
  async waitClick(text, sel, max = 15) {
    await this.inject();
    await this.until(([t, s]) => { const f = window.__find; return f ? !!f(t, s) : false; }, [text, sel], max);
    return this.click(text, sel);
  }
  /** Types into the focused element one character every few frames. */
  async type(selector, text, every = 3) {
    await this.r.page.evaluate((s) => { const e = document.querySelector(s); if (e) { e.focus(); e.select?.(); } }, selector);
    for (const ch of text) {
      await this.r.page.keyboard.type(ch);
      await this.r.frames(every);
    }
  }
  save() {
    fs.writeFileSync(path.join(__dirname, "..", "footage", `${this.clip}.json`), JSON.stringify(this.marks, null, 2));
  }
}

module.exports = { Director };
