/**
 * Trailer V2 mix: the regenerated narration (build/voice2), the V2 score ducked about 9 dB under speech,
 * and synthesised effects placed from script/edl-v2.cjs and the capture marks. Writes build/mix2_raw.wav.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const FFMPEG = require("ffmpeg-static");
const { readWav, writeWav } = require("../lib/wav.cjs");
const { shots, duration } = require("../script/edl-v2.cjs");

const ROOT = path.join(__dirname, "..");
const SR = 48000, DUR = duration, N = Math.ceil(DUR * SR);
const VL = new Float32Array(N), VR = new Float32Array(N); // voice
const ML = new Float32Array(N), MR = new Float32Array(N); // music
const SL = new Float32Array(N), SRr = new Float32Array(N); // effects
let seed = 777;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ── map a moment in a capture to the trailer timeline via the EDL ──
const ordered = [...shots].sort((a, b) => a.at - b.at);
function shotEnd(i) { return i + 1 < ordered.length ? ordered[i + 1].at : DUR; }
function T(clip, srcT) {
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    if (s.clip !== clip) continue;
    const t = s.at + (srcT - s.src);
    if (srcT >= s.src - 0.01 && t <= shotEnd(i) + 0.01) return t;
  }
  return null;
}
const marks = (clip) => { try { return Object.fromEntries(require(path.join(ROOT, "footage", clip + ".json")).map((m) => [m.name, m.t])); } catch { return {}; } };

// ── voice ──
const placed = require(path.join(ROOT, "build/voice2/placed.json"));
const V48 = path.join(ROOT, "build/voice2_48k");
fs.mkdirSync(V48, { recursive: true });
for (const l of placed) {
  const out = path.join(V48, path.basename(l.file));
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(l.file).mtimeMs)
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", l.file, "-ar", "48000", "-af", "aresample=filter_size=64:phase_shift=10:cutoff=0.97", "-c:a", "pcm_s24le", out]);
  const w = readWav(out).chans[0];
  const a = Math.floor(l.trimStart * SR), b = Math.min(w.length, a + Math.ceil(l.dur * SR));
  // level by the loudness of the speech itself (pauses excluded), never letting a peak pass 0.7
  let pk = 0;
  for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(w[i]));
  let rms = 0, n = 0;
  for (let i = a; i < b; i++) if (Math.abs(w[i]) > pk * 0.05) { rms += w[i] * w[i]; n++; }
  rms = Math.sqrt(rms / Math.max(1, n));
  const g = Math.min(0.13 / Math.max(rms, 1e-4), 0.7 / Math.max(pk, 1e-4));
  const at = Math.floor(l.at * SR);
  for (let i = a; i < b; i++) {
    const j = at + (i - a);
    if (j >= N) break;
    const k = i - a, edge = Math.min(1, k / 240, (b - i) / 480); // tiny fades, no clicks
    VL[j] += w[i] * g * edge; VR[j] += w[i] * g * edge;
  }
}

// ── music, with automation and ducking ──
const mus = readWav(path.join(ROOT, "build/music-v2.wav"));
const musicLevel = (t) => {
  let g = 0.6;
  if (t < 17.6) g = 0.62;                       // problem statement: soft
  if (t >= 55 && t < 66.6) g = 0.54;            // play and build: lines over the busiest music
  if (t >= 66.6 && t < 71.3) g = 0.72;          // the town grows: music comes up after the lines
  if (t >= 71.3 && t < 90.3) g = 0.52;          // ads + pool: bright music, keep the lines clear
  if (t >= 59.3 && t < 60.2) g *= 0.6;          // the PERFECT chop lands in the clear
  if (t >= 90.3 && t < 114.5) g = 0.56;         // Notice Board + withdrawal: gentle
  if (t >= 122.6) g = 0.52;                     // finale: stay under the closing lines…
  if (t >= 131.1) g = 0.52 + 0.48 * Math.min(1, (t - 131.1) / 1.6); // …then swell into the logo
  return g;
};
// voice presence envelope (attack 120 ms, release 700 ms)
const env = new Float32Array(N);
{
  let e = 0;
  const att = Math.exp(-1 / (0.12 * SR)), rel = Math.exp(-1 / (0.7 * SR));
  for (let i = 0; i < N; i++) {
    const x = Math.min(1, Math.abs(VL[i]) * 12);
    e = x > e ? att * e + (1 - att) * x : rel * e + (1 - rel) * x;
    env[i] = e;
  }
  // look-ahead so the music starts to dip just before a line
  const la = Math.floor(0.15 * SR);
  for (let i = 0; i < N - la; i++) env[i] = Math.max(env[i], env[i + la]);
}
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const duck = 1 - 0.72 * Math.min(1, env[i] * 1.4); // about -11 dB under speech
  const g = musicLevel(t) * duck;
  ML[i] = (mus.chans[0][i] || 0) * g;
  MR[i] = (mus.chans[1][i] || 0) * g;
}

// ── effects ──
function sfx(t0, dur, gain, pan, fn) {
  if (t0 == null) return;
  const i0 = Math.max(0, Math.floor(t0 * SR)), i1 = Math.min(N, Math.floor((t0 + dur) * SR));
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = i0; i < i1; i++) { const v = fn((i - t0 * SR) / SR); SL[i] += v * gl; SRr[i] += v * gr; }
}
const sine = (f, x) => Math.sin(2 * Math.PI * f * x);
function pop(t, g = 0.25, f = 700, pan = 0) { sfx(t, 0.12, g, pan, (x) => sine(f * (1 + 2.5 * Math.exp(-x * 60)), x) * Math.exp(-x * 30)); }
function click(t, g = 0.18, pan = 0) { sfx(t, 0.05, g, pan, (x) => (sine(2400, x) * 0.6 + (rnd() * 2 - 1) * 0.4) * Math.exp(-x * 120)); }
function chime(t, g = 0.22, notes = [1046.5, 1318.5, 1568], gap = 0.07, pan = 0) {
  notes.forEach((f, k) => sfx(t + k * gap, 1.2, g * (1 - k * 0.12), pan + (k - 1) * 0.2, (x) => (sine(f, x) + 0.3 * sine(f * 2.76, x) * Math.exp(-x * 4)) * Math.exp(-x * 3.2) * Math.min(1, x / 0.002)));
}
function sparkle(t, len = 1.6, g = 0.14) {
  const n = Math.floor(len * 14);
  for (let k = 0; k < n; k++) { const f = 1600 + rnd() * 2600; sfx(t + rnd() * len, 0.5, g * (0.5 + rnd() * 0.5), rnd() * 1.6 - 0.8, (x) => sine(f, x) * Math.exp(-x * 9) * Math.min(1, x / 0.003)); }
}
function whoosh(t, len = 0.7, g = 0.22, up = true, pan = 0) {
  let lp = 0, lp2 = 0;
  sfx(t, len, g, pan, (x) => {
    const u = x / len;
    const c = 0.02 + 0.25 * (up ? u : 1 - u);
    lp += c * ((rnd() * 2 - 1) - lp); lp2 += c * (lp - lp2);
    return lp2 * 3 * Math.sin(Math.PI * Math.min(1, u)) ;
  });
}
function thunk(t, g = 0.45) {
  // axe into wood: low knock + short crack
  sfx(t, 0.35, g, 0.05, (x) => sine(120 * (1 + Math.exp(-x * 40)), x) * Math.exp(-x * 16));
  let hp = 0, prev = 0;
  sfx(t + 0.005, 0.18, g * 0.8, 0.1, (x) => { const w = rnd() * 2 - 1; hp = 0.7 * (hp + w - prev); prev = w; return hp * Math.exp(-x * 28); });
  sfx(t + 0.04, 0.4, g * 0.35, -0.2, (x) => (sine(310, x) + sine(470, x) * 0.6) * Math.exp(-x * 11)); // the halves clatter
}
function coins(t, n = 6, g = 0.16) { for (let k = 0; k < n; k++) { const f = 2600 + rnd() * 1500; sfx(t + k * 0.11 + rnd() * 0.04, 0.35, g, rnd() - 0.5, (x) => (sine(f, x) + 0.5 * sine(f * 1.5, x)) * Math.exp(-x * 14)); } }
function pageTurn(t, g = 0.2) { let lp = 0; sfx(t, 0.45, g, 0.2, (x) => { lp += 0.35 * ((rnd() * 2 - 1) - lp); return lp * Math.sin(Math.PI * x / 0.45) * (0.6 + 0.4 * Math.sin(x * 70)); }); }
function footsteps(t0, t1, every = 0.27, g = 0.09) { for (let t = t0; t < t1; t += every) { let lp = 0; sfx(t, 0.08, g * (0.8 + rnd() * 0.4), (rnd() - 0.5) * 0.3, (x) => { lp += 0.2 * ((rnd() * 2 - 1) - lp); return lp * Math.exp(-x * 50); }); } }
function bird(t, g = 0.06, pan = 0) {
  const base = 2600 + rnd() * 1800, n = 2 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) { const s = t + k * (0.09 + rnd() * 0.05), d = 0.06 + rnd() * 0.05, sw = 400 + rnd() * 900; sfx(s, d, g, pan, (x) => sine(base + sw * Math.sin(Math.PI * x / d), x) * Math.sin(Math.PI * x / d)); }
}
function birds(t0, t1, density = 0.6, g = 0.05) { for (let t = t0; t < t1; t += 1 / density * (0.5 + rnd())) bird(t, g * (0.6 + rnd() * 0.6), rnd() * 1.6 - 0.8); }
function wind(t0, t1, g = 0.05) { let lp = 0, lp2 = 0; sfx(t0, t1 - t0, g, 0, (x) => { const m = 0.5 + 0.5 * Math.sin(x * 0.7) * Math.sin(x * 0.23 + 1); lp += 0.01 * ((rnd() * 2 - 1) - lp); lp2 += 0.02 * (lp - lp2); return lp2 * 18 * (0.4 + 0.6 * m) * Math.min(1, x / 2, (t1 - t0 - x) / 2); }); }
function hum(t0, t1, g = 0.05) { sfx(t0, t1 - t0, g, 0, (x) => (sine(62, x) + 0.4 * sine(124, x) + 0.15 * sine(186 + 3 * Math.sin(x * 8), x)) * Math.min(1, x / 0.6, (t1 - t0 - x) / 0.8)); }

// ambience
birds(37.9, 44.5, 0.4, 0.035);
birds(51.6, 58.6, 0.6, 0.04);
birds(63.0, 71.3, 0.8, 0.045);
birds(88.6, 96.5, 0.7, 0.045);
birds(104.0, 106.6, 0.6, 0.04);
birds(122.6, 135.5, 0.9, 0.05);
footsteps(90.6, 92.9, 0.26, 0.07);
footsteps(93.7, 96.0, 0.26, 0.07);
// problem statement
sparkle(0.4, 1.2, 0.07);
chime(5.72, 0.16, [1318.5, 1760], 0.06);   // 41% lands
chime(11.37, 0.16, [1396.9, 1864.7], 0.06); // 48% lands
pop(14.75, 0.12, 900); sparkle(14.8, 1.0, 0.08); // the sprout
// homepage reveal
sparkle(17.9, 1.6, 0.06); whoosh(17.5, 0.6, 0.08, true);
// deposit → fruit → cause
const ob = marks("s3_onboard");
for (const k of ["picked-cat", "picked-fernhollow", "picked-100"]) pop(T("s3_onboard", ob[k]), 0.18, 760);
sparkle(T("s3_onboard", 23.0), 2.0, 0.11);
chime(T("s3_onboard", 24.65), 0.11, [1046.5, 1318.5, 1568, 2093]); // ta-da (under a line: soft)
sparkle(37.95, 0.9, 0.05);
const tr = marks("s3_tree");
pop(T("s3_tree", tr["pick0"]), 0.24, 900); pop(T("s3_tree", tr["pick1"]), 0.24, 1000);
chime(T("s3_tree", 6.3), 0.17, [784, 1046.5]);
// world map
whoosh(T("s4_map", 1.2), 0.8, 0.15, true);
hum(46.4, 51.5, 0.045);
whoosh(T("s4_map", 12.0), 0.8, 0.15, false);
// play and build
const bd = marks("s5_build");
click(T("s5_build", 1.0), 0.16); pop(T("s5_build", 1.05), 0.16, 620);
for (const k of [2]) { const t = T("s5_build", bd["chop" + k]); if (t == null) continue; whoosh(t - 0.13, 0.15, 0.12, true, -0.1); thunk(t, 0.3); chime(t + 0.02, k === 2 ? 0.18 : 0.12, [1318.5, 1760], 0.05, 0.15); }
chime(T("s5_build", 19.65), 0.13, [784, 988, 1175, 1568], 0.11); // building complete (soft: under a line)
chime(T("s5_build", 34.6), 0.14, [1046.5, 1568], 0.08);
sparkle(66.6, 1.4, 0.08);
// optional ads → pool
click(T("s5_build", 22.95), 0.15);
whoosh(T("s5_build", 23.1), 0.45, 0.12, false);
coins(T("s5_build", 27.0), 7, 0.12);
sparkle(80.2, 0.8, 0.05);
[1.4, 1.5, 1.6, 1.7].forEach((d) => pop(80.0 + d, 0.06, 1100));
[2.0, 2.15, 2.3, 2.45].forEach((d, k) => pop(80.0 + d, 0.05, 700 + k * 60));
const gf = marks("s7_gift");
click(T("s7_gift", gf["pick"]), 0.15); click(T("s7_gift", gf["auto"]), 0.15);
sparkle(88.7, 1.0, 0.08);
// Notice Board
const vb = marks("v2_board");
pageTurn(T("v2_board", vb["board-open"]), 0.2);
whoosh(T("v2_board", vb["closed"]), 0.4, 0.1, false);
// withdrawal
const wd = marks("s8_withdraw");
for (const k of ["withdraw-modal", "25"]) click(T("s8_withdraw", wd[k]), 0.15);
chime(112.15, 0.13, [880, 1318.5]);
// technology
click(114.6, 0.1);
// finale: sparkle as the logo pops, small plinks as the letters drop
sparkle(127.9, 1.4, 0.07);
"Hugshire".split("").forEach((_, i) => pop(127.8 + 0.45 + i * 0.07 + 0.5, 0.03, 1200 + i * 60));

// ── sum, gentle bus compression on effects, write ──
const out = [new Float32Array(N), new Float32Array(N)];
for (let i = 0; i < N; i++) {
  out[0][i] = VL[i] + ML[i] + Math.tanh(SL[i] * 1.2) * 0.85;
  out[1][i] = VR[i] + MR[i] + Math.tanh(SRr[i] * 1.2) * 0.85;
}
// fade the very start and end
for (let i = 0; i < N; i++) { const t = i / SR; const f = Math.min(1, t / 0.8, (DUR - t) / 1.8); out[0][i] *= f; out[1][i] *= f; }
writeWav(path.join(ROOT, "build/mix2_raw.wav"), SR, out);
// stems for checking
writeWav(path.join(ROOT, "build/stem2_voice.wav"), SR, [VL, VR]);
console.log("mix written");
