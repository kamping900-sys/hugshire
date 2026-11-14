/**
 * V2 captions from the FINAL narration. Timing comes from the narration audio itself: speech onsets and the
 * pauses between sentences/clauses; each cue boundary snaps to the real pause where its punctuation falls.
 * The caption text is the script's (proper names, punctuation). Max two lines per cue.
 * Writes out/hugshire-trailer-v2.srt, caption cards (Manrope) and build/captions-v2.mov.
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");
const FFMPEG = require("ffmpeg-static");
const { readWav } = require("../lib/wav.cjs");
const { Recorder } = require("../lib/recorder.cjs");
const { shots, duration: DUR } = require("../script/edl-v2.cjs");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "build", "captions-v2");
fs.mkdirSync(DIR, { recursive: true });
const placed = require(path.join(ROOT, "build/voice2/placed.json"));
const MAXL = 44;

function lines2(text) {
  // one line if it fits, otherwise the most balanced two-line break (never a lone short word)
  if (text.length <= MAXL) return [text];
  const words = text.split(" ");
  let best = null;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
    const score = Math.max(a.length, b.length) + (a.length > MAXL || b.length > MAXL ? 100 : 0);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best.score >= 100 ? null : best.lines;
}
const fits = (t) => !!lines2(t);
/** splits a caption into cues of at most two lines, preferring sentence ends, then commas */
function cuesOf(text) {
  const sentences = text.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g).map((s) => s.trim());
  const out = [];
  for (const s of sentences) {
    if (fits(s)) { out.push(s); continue; }
    const parts = s.split(/(?<=,)\s+/);
    let cur = "";
    for (const p of parts) { const nx = (cur + " " + p).trim(); if (fits(nx)) cur = nx; else { if (cur) out.push(cur); cur = p; } }
    if (cur) out.push(cur);
  }
  return out;
}
const wnorm = (w) => w.toLowerCase().replace(/[^a-z0-9%]/g, "");

(async () => {
  const cues = [];
  for (const g of placed) {
    const w = readWav(g.file), x = w.chans[0], sr = w.rate;
    const i0 = Math.floor(g.trimStart * sr), i1 = Math.min(x.length, i0 + Math.floor(g.dur * sr));
    const hop = Math.floor(0.01 * sr), env = [];
    let peak = 0;
    for (let i = i0; i < i1; i += hop) { let e = 0; for (let j = i; j < Math.min(i1, i + hop); j++) e = Math.max(e, Math.abs(x[j])); env.push(e); peak = Math.max(peak, e); }
    const on = env.map((e) => e > peak * 0.04);
    const speechA = on.indexOf(true) * 0.01, speechB = (on.length - 1 - [...on].reverse().indexOf(true)) * 0.01 + 0.01;
    // pauses inside the group (>= 110 ms of quiet)
    const pauses = [];
    for (let k = 0, run = 0; k <= on.length; k++) {
      if (k < on.length && !on[k]) run++;
      else { if (run >= 11 && k - run > 0 && k < on.length) pauses.push({ a: (k - run) * 0.01, b: k * 0.01 }); run = 0; }
    }
    const parts = cuesOf(g.cap);
    let charPos = 0, prevEnd = speechA;
    parts.forEach((c, j) => {
      charPos += c.length + 1;
      let end = speechB, nextStart = null;
      if (j < parts.length - 1) {
        const est = speechA + (speechB - speechA) * (charPos / (g.cap.length + 1));
        const near = pauses.filter((p) => Math.abs((p.a + p.b) / 2 - est) < 0.9).sort((p, q) => Math.abs((p.a + p.b) / 2 - est) - Math.abs((q.a + q.b) / 2 - est))[0];
        end = near ? near.a : est; nextStart = near ? near.b : est;
      }
      cues.push({ a: g.at + prevEnd, b: g.at + end, text: lines2(c).join(String.fromCharCode(10)) });
      prevEnd = nextStart ?? end;
    });
    console.log(g.id.padEnd(12), parts.length, "cue(s),", pauses.length, "pauses");
  }
  // readable timing: at least 1.1 s on screen, a short tail after speech, never overlapping
  for (let i = 0; i < cues.length; i++) {
    const next = i + 1 < cues.length ? cues[i + 1].a - 0.06 : DUR;
    cues[i].b = Math.min(Math.max(cues[i].b + 0.3, cues[i].a + 1.1), next);
  }
  // caption position follows the shot under it
  const ordered = [...shots].sort((x, y) => x.at - y.at);
  const shotAt = (t) => ordered.filter((s) => s.at <= t + 0.05).pop();
  // high if any shot under the cue shows the bottom menu / map strip
  const endOf = (s) => { const i = ordered.indexOf(s); return i + 1 < ordered.length ? ordered[i + 1].at : DUR; };
  for (const c of cues) c.pos = ordered.some((s) => s.cap === "high" && s.at < c.b && endOf(s) > c.a) ? "high" : "low";
  const ts = (t) => { const ms = Math.round(t * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "out", "hugshire-trailer-v2.srt"), cues.map((c, i) => `${i + 1}\n${ts(c.a)} --> ${ts(c.b)}\n${c.text}\n`).join("\n"));
  fs.writeFileSync(path.join(DIR, "cues.json"), JSON.stringify(cues, null, 2));

  // caption cards and the transparent caption track
  const r = await Recorder.open({ width: 1920, height: 1080, scale: 1 });
  const PAGE = pathToFileURL(path.join(ROOT, "overlays", "overlay.html")).href;
  await r.page.goto(`${PAGE}?o=cap2&text=`); await r.page.evaluate(() => document.fonts.ready);
  await r.page.screenshot({ path: path.join(DIR, "blank.png"), omitBackground: true });
  for (const [i, c] of cues.entries()) {
    await r.page.goto(`${PAGE}?o=cap2&pos=${c.pos}&text=${encodeURIComponent(c.text)}`);
    await r.page.evaluate(() => document.fonts.ready);
    await r.page.screenshot({ path: path.join(DIR, `c${String(i).padStart(3, "0")}.png`), omitBackground: true });
  }
  await r.close();
  const fwd = (f) => f.split(path.sep).join("/");
  const list = []; let t = 0;
  const push = (f, d) => { if (d > 0.001) list.push(`file '${fwd(f)}'`, `duration ${d.toFixed(3)}`); };
  cues.forEach((c, i) => { push(path.join(DIR, "blank.png"), c.a - t); push(path.join(DIR, `c${String(i).padStart(3, "0")}.png`), c.b - c.a); t = c.b; });
  push(path.join(DIR, "blank.png"), DUR - t);
  list.push(`file '${fwd(path.join(DIR, "blank.png"))}'`);
  fs.writeFileSync(path.join(DIR, "list.txt"), list.join("\n"));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(DIR, "list.txt"), "-vf", "fps=30,format=argb", "-t", String(DUR), "-c:v", "qtrle", path.join(ROOT, "build", "captions-v2.mov")]);
  console.log("captions:", cues.length, "cues");
})();
