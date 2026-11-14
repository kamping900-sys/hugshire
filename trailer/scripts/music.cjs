/**
 * Original score for the Hugshire trailer, synthesised from scratch (no samples, no third-party music).
 *   node scripts/music.cjs  →  build/music.wav (48 kHz stereo)
 *
 * Key: F major. 98 BPM, so 10 bars = 24.5 s and the sections land on the scene changes.
 *   bars  0–10  thoughtful opening: solo piano over a soft pad (Dm Bb F C)
 *   bars 10–16  welcome: the main theme arrives on marimba + glockenspiel, pizzicato underneath
 *   bars 16–32  adventure: theme with plucked guitar, bass and a light shaker
 *   bars 32–42  building: brighter rhythm, woodblock and marimba ostinato
 *   bars 42–58  community: softer, piano melody over strings
 *   bars 58–69  your choice / technology: the theme returns, warmer, with strings
 *   bars 69–73.5 finale: full theme, then a long final F major chord
 * The mix later ducks this track under the narration.
 */
const path = require("path");
const fs = require("fs");
const { writeWav } = require("../lib/wav.cjs");

const SR = 48000;
const BPM = 98;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const DUR = 181;
const N = Math.ceil(DUR * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const RL = new Float32Array(N), RR = new Float32Array(N); // reverb send

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, "C#": 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const n = (s) => { const m = s.match(/^([A-G][b#]?)(-?\d)$/); return (parseInt(m[2]) + 1) * 12 + NOTE[m[1]]; };

/** Adds a mono signal (fn of time since note start) at time t (s) with pan and reverb send. */
function add(t0, dur, gain, pan, send, fn) {
  const i0 = Math.max(0, Math.floor(t0 * SR)), i1 = Math.min(N, Math.floor((t0 + dur) * SR));
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = i0; i < i1; i++) {
    const v = fn((i - t0 * SR) / SR);
    L[i] += v * gl; R[i] += v * gr;
    RL[i] += v * gl * send; RR[i] += v * gr * send;
  }
}

// ── instruments ────────────────────────────────────────────────────────────────
function piano(t, midi, len, vel = 0.5, pan = 0) {
  const f = mtof(midi), B = 0.00035, dur = Math.min(len + 1.6, 5.5);
  const parts = [];
  for (let k = 1; k <= 9; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > 15000) break;
    parts.push({ w: 2 * Math.PI * fk, a: Math.pow(k, -1.25) * (k === 1 ? 1 : 0.85), d: 0.55 + 0.32 * k + f / 900, ph: rnd() * 6.28 });
  }
  const rel = len; // damper after the written length
  add(t, dur, vel * 0.22, pan, 0.32, (x) => {
    let s = 0;
    for (const p of parts) s += p.a * Math.exp(-p.d * x) * Math.sin(p.w * x + p.ph);
    const att = Math.min(1, x / 0.004);
    const damp = x > rel ? Math.exp(-(x - rel) * 6) : 1;
    const hammer = x < 0.012 ? (rnd() * 2 - 1) * 0.15 * (1 - x / 0.012) : 0;
    return (s + hammer) * att * damp;
  });
}
function marimba(t, midi, vel = 0.5, pan = 0) {
  const f = mtof(midi);
  const parts = [{ r: 1, a: 1, d: 2.6 }, { r: 3.93, a: 0.35, d: 9 }, { r: 9.2, a: 0.12, d: 22 }];
  add(t, 1.6, vel * 0.3, pan, 0.25, (x) => {
    let s = 0;
    for (const p of parts) s += p.a * Math.exp(-p.d * x) * Math.sin(2 * Math.PI * f * p.r * x);
    return s * Math.min(1, x / 0.0015);
  });
}
function glock(t, midi, vel = 0.4, pan = 0) {
  const f = mtof(midi);
  const parts = [{ r: 1, a: 1, d: 1.1 }, { r: 2.76, a: 0.4, d: 2.4 }, { r: 5.4, a: 0.18, d: 4 }, { r: 8.93, a: 0.08, d: 7 }];
  add(t, 2.6, vel * 0.13, pan, 0.45, (x) => {
    let s = 0;
    for (const p of parts) s += p.a * Math.exp(-p.d * x) * Math.sin(2 * Math.PI * f * p.r * x);
    return s * Math.min(1, x / 0.001);
  });
}
/** Karplus–Strong pluck (pizzicato / nylon guitar). */
function pluck(t, midi, vel = 0.5, pan = 0, bright = 0.5, len = 1.4, send = 0.25) {
  const f = mtof(midi), P = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(P);
  for (let i = 0; i < P; i++) buf[i] = rnd() * 2 - 1;
  // soften the excitation for a warmer tone
  for (let pass = 0; pass < Math.round((1 - bright) * 4); pass++) for (let i = 1; i < P; i++) buf[i] = 0.5 * (buf[i] + buf[i - 1]);
  const mean = buf.reduce((a, b) => a + b, 0) / P; // no DC: it would rumble under the mix
  for (let i = 0; i < P; i++) buf[i] -= mean;
  let idx = 0;
  const decay = 0.996 - (1 - bright) * 0.004;
  const i0 = Math.floor(t * SR), i1 = Math.min(N, i0 + Math.floor(len * SR));
  const gl = vel * 0.28 * Math.cos((pan + 1) * Math.PI / 4), gr = vel * 0.28 * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = i0; i < i1; i++) {
    const nx = (idx + 1) % P;
    const v = buf[idx];
    buf[idx] = decay * 0.5 * (buf[idx] + buf[nx]);
    idx = nx;
    const env = i - i0 > (len - 0.08) * SR ? Math.max(0, (i1 - i) / (0.08 * SR)) : 1;
    L[i] += v * gl * env; R[i] += v * gr * env;
    RL[i] += v * gl * env * send; RR[i] += v * gr * env * send;
  }
}
/** Warm string pad: detuned saws through a gentle low-pass, slow attack and release. */
function strings(t, midis, len, vel = 0.4, pan = 0) {
  for (const [j, midi] of midis.entries()) {
    const f = mtof(midi);
    const det = [-0.11, -0.04, 0.03, 0.09, 0.14].map((c) => f * Math.pow(2, c / 12));
    const ph = det.map(() => rnd());
    let lp = 0, lp2 = 0;
    const cutoff = 0.05 + 0.03 * vel;
    add(t, len + 1.4, vel * 0.05, pan + (j - midis.length / 2) * 0.18, 0.5, (x) => {
      let s = 0;
      const vib = 1 + 0.0025 * Math.sin(2 * Math.PI * 5.2 * x) * Math.min(1, x / 1.2);
      for (let k = 0; k < det.length; k++) { const p = (ph[k] + det[k] * vib * x) % 1; s += 2 * p - 1; }
      lp += cutoff * (s - lp);
      lp2 += cutoff * (lp - lp2); // two gentle poles: warm, not buzzy
      const att = Math.min(1, x / 0.7);
      const rel = x > len ? Math.max(0, 1 - (x - len) / 1.4) : 1;
      return lp2 * 1.3 * att * rel;
    });
  }
}
function bass(t, midi, len, vel = 0.5) {
  const f = mtof(midi);
  add(t, len + 0.3, vel * 0.32, 0, 0.08, (x) => {
    const env = Math.min(1, x / 0.012) * Math.exp(-x * 1.6) * (x > len ? Math.max(0, 1 - (x - len) / 0.3) : 1);
    return (Math.sin(2 * Math.PI * f * x) + 0.25 * Math.sin(4 * Math.PI * f * x) + 0.08 * Math.sin(6 * Math.PI * f * x)) * env;
  });
}
function shaker(t, vel = 0.3, pan = 0.35) {
  let hp = 0, prev = 0;
  add(t, 0.09, vel * 0.12, pan, 0.1, (x) => {
    const w = rnd() * 2 - 1;
    hp = 0.85 * (hp + w - prev); prev = w;
    return hp * Math.exp(-x * 45) * Math.min(1, x / 0.006);
  });
}
function woodblock(t, vel = 0.4, pitch = 1, pan = -0.3) {
  add(t, 0.12, vel * 0.25, pan, 0.2, (x) => (Math.sin(2 * Math.PI * 880 * pitch * x) * 0.8 + Math.sin(2 * Math.PI * 1520 * pitch * x) * 0.3) * Math.exp(-x * 38));
}
function softKick(t, vel = 0.5) {
  add(t, 0.35, vel * 0.42, 0, 0.02, (x) => Math.sin(2 * Math.PI * (48 * x + 60 * (1 - Math.exp(-x * 30)) / 30)) * Math.exp(-x * 9));
}

// ── harmony and themes ─────────────────────────────────────────────────────────
const CH = {
  F: { root: n("F2"), tri: ["F3", "A3", "C4"].map(n) },
  C: { root: n("C2"), tri: ["E3", "G3", "C4"].map(n) },
  Dm: { root: n("D2"), tri: ["F3", "A3", "D4"].map(n) },
  Bb: { root: n("Bb1"), tri: ["F3", "Bb3", "D4"].map(n) },
  Am: { root: n("A1"), tri: ["E3", "A3", "C4"].map(n) },
  Gm: { root: n("G1"), tri: ["G3", "Bb3", "D4"].map(n) },
  Csus: { root: n("C2"), tri: ["F3", "G3", "C4"].map(n) },
};
const bt = (bar, beat = 0) => bar * BAR + beat * BEAT;

// main theme: 8 bars of [beat, note, beats]
const THEME = [
  [[0, "C5", 1], [1, "A4", 0.5], [1.5, "C5", 0.5], [2, "F5", 1], [3, "E5", 0.5], [3.5, "D5", 0.5]],
  [[0, "E5", 1.5], [1.5, "D5", 0.5], [2, "C5", 1], [3, "G4", 1]],
  [[0, "A4", 0.5], [0.5, "C5", 0.5], [1, "D5", 1], [2, "F5", 1], [3, "E5", 0.5], [3.5, "D5", 0.5]],
  [[0, "D5", 1], [1, "C5", 1], [2, "A4", 2]],
  [[0, "C5", 1], [1, "A4", 0.5], [1.5, "C5", 0.5], [2, "F5", 1], [3, "G5", 0.5], [3.5, "A5", 0.5]],
  [[0, "G5", 1.5], [1.5, "F5", 0.5], [2, "E5", 1], [3, "C5", 1]],
  [[0, "D5", 0.5], [0.5, "F5", 0.5], [1, "E5", 1], [2, "D5", 1], [3, "C5", 0.5], [3.5, "E5", 0.5]],
  [[0, "F5", 3], [3, "C5", 1]],
];
const THEME_CH = ["F", "C", "Dm", "Bb", "F", "C", "Bb", "F"];
const THEME_CH_ALT = ["F", "C", "Dm", "Bb", "F", "Am", "Bb", "Csus"];

function themeBars(startBar, bars, voice, vel, transpose = 0, pan = 0) {
  for (let b = 0; b < bars; b++) {
    for (const [beat, note, len] of THEME[b % 8]) {
      const t = bt(startBar + b, beat), m = n(note) + transpose;
      if (voice === "marimba") marimba(t, m, vel, pan);
      else if (voice === "glock") glock(t, m + 12, vel, pan);
      else if (voice === "piano") piano(t, m, len * BEAT, vel, pan);
      else if (voice === "pluck") pluck(t, m, vel, pan, 0.75, 1.0, 0.3);
    }
  }
}
function padChords(startBar, chords, vel = 0.35, oct = 0) {
  chords.forEach((c, i) => strings(bt(startBar + i), CH[c].tri.map((m) => m + oct), BAR * 0.98, vel));
}
function bassLine(startBar, chords, vel = 0.5, pattern = "half") {
  chords.forEach((c, i) => {
    const r = CH[c].root + 12;
    if (pattern === "whole") bass(bt(startBar + i), r, BAR * 0.9, vel);
    else if (pattern === "half") { bass(bt(startBar + i), r, BEAT * 1.8, vel); bass(bt(startBar + i, 2), r + 7, BEAT * 1.8, vel * 0.8); }
    else { for (let k = 0; k < 4; k++) bass(bt(startBar + i, k), k === 2 ? r + 7 : r, BEAT * 0.8, vel * (k === 0 ? 1 : 0.75)); }
  });
}
function pianoArp(startBar, chords, vel = 0.35, step = 0.5, oct = 12) {
  chords.forEach((c, i) => {
    const tri = CH[c].tri.map((m) => m + oct);
    const seq = [CH[c].root + 24, tri[0], tri[1], tri[2], tri[1], tri[0], tri[2], tri[1]];
    for (let k = 0; k < 4 / step; k++) piano(bt(startBar + i, k * step), seq[k % seq.length], step * BEAT * 1.6, vel * (k % 2 ? 0.8 : 1), -0.2 + 0.1 * (k % 3));
  });
}
function strum(startBar, chords, vel = 0.4) {
  // nylon-guitar pattern: down on 1, up on 2&, down on 3, up on 4
  chords.forEach((c, i) => {
    const tri = CH[c].tri;
    const voicing = [CH[c].root + 12, ...tri, tri[0] + 12];
    for (const [beat, dir, v] of [[0, 1, 1], [1.5, -1, 0.6], [2, 1, 0.85], [3, -1, 0.55], [3.5, 1, 0.5]]) {
      const ord = dir > 0 ? voicing : [...voicing].reverse();
      ord.forEach((m, k) => pluck(bt(startBar + i, beat) + k * 0.012, m, vel * v, 0.25, 0.55, 1.1, 0.2));
    }
  });
}

// ── arrangement ────────────────────────────────────────────────────────────────
// bars 0–10: thoughtful opening (solo piano, sparse, a hint of loneliness)
{
  const prog = ["Dm", "Bb", "F", "C", "Dm", "Bb", "F", "Csus", "Dm", "C"];
  prog.forEach((c, i) => {
    const t = bt(i);
    piano(t, CH[c].root + 12, BAR * 0.95, 0.32, -0.1);
    const tri = CH[c].tri.map((m) => m + 12);
    [0, 1.5, 2.5].forEach((b, k) => piano(t + b * BEAT, tri[k], BEAT * 1.4, 0.24, 0.15));
  });
  // a small rising motif that hints at the theme
  [[4, 2, "A4"], [4, 3, "C5"], [5, 0, "D5"], [6, 2, "C5"], [6, 3, "F5"], [7, 0, "E5"], [8, 2, "A4"], [8, 3, "D5"], [9, 0, "E5"], [9, 2, "G5"]].forEach(([b, beat, nt]) => piano(bt(b, beat), n(nt), BEAT * 1.5, 0.34, 0.25));
  padChords(2, prog.slice(2), 0.18, -12);
}
// bars 10–16: welcome — the theme on marimba + glock, pizzicato bass, first warmth
themeBars(10, 4, "marimba", 0.55, 0, 0.1);
themeBars(10, 4, "glock", 0.38, 0, -0.2);
padChords(10, THEME_CH.slice(0, 4), 0.25);
bassLine(10, THEME_CH.slice(0, 4), 0.42, "whole");
for (let b = 10; b < 14; b++) for (let k = 0; k < 4; k++) pluck(bt(b, k), CH[THEME_CH[(b - 10) % 8]].tri[k % 3] + 12, 0.32, -0.35, 0.8, 0.5);
// bridge into the adventure
themeBars(14, 2, "marimba", 0.5, 0, 0.1);
padChords(14, ["Bb", "Csus"], 0.28);
bassLine(14, ["Bb", "C"], 0.45, "half");
// bars 16–32: adventure (strum, bass, shaker, theme on pluck then marimba)
{
  const chords = [...THEME_CH, ...THEME_CH_ALT];
  strum(16, chords, 0.33);
  bassLine(16, chords, 0.48, "half");
  padChords(16, chords, 0.16);
  themeBars(16, 8, "marimba", 0.48, 0, 0.15);
  themeBars(24, 8, "pluck", 0.42, 12, -0.15);
  themeBars(24, 8, "glock", 0.25, 0, 0.3);
  for (let b = 16; b < 32; b++) for (let k = 0; k < 8; k++) shaker(bt(b, k * 0.5), k % 2 ? 0.22 : 0.32);
}
// bars 32–42: building (a little more energy: woodblock on the off-beats, marimba ostinato, soft kick)
{
  const chords = ["F", "C", "Dm", "Bb", "F", "C", "Bb", "C", "F", "Csus"];
  bassLine(32, chords, 0.5, "quarter");
  padChords(32, chords, 0.14);
  chords.forEach((c, i) => {
    const tri = CH[c].tri.map((m) => m + 12);
    for (let k = 0; k < 8; k++) marimba(bt(32 + i, k * 0.5), tri[[0, 1, 2, 1, 0, 2, 1, 2][k]], k % 2 ? 0.28 : 0.38, -0.25);
    softKick(bt(32 + i, 0), 0.45); softKick(bt(32 + i, 2), 0.35);
    woodblock(bt(32 + i, 1), 0.4, 1); woodblock(bt(32 + i, 3), 0.35, 1.12); woodblock(bt(32 + i, 3.5), 0.22, 1.12);
    for (let k = 0; k < 8; k++) shaker(bt(32 + i, k * 0.5), k % 2 ? 0.2 : 0.3, 0.4);
  });
  themeBars(34, 8, "glock", 0.32, 0, 0.3);
  themeBars(34, 8, "pluck", 0.36, 12, 0.1);
}
// bars 42–58: community (gentle: piano melody over strings, pizzicato heartbeat)
{
  const chords = ["Bb", "F", "Gm", "C", "Bb", "F", "Dm", "C", "Bb", "F", "Gm", "C", "Dm", "Bb", "Csus", "C"];
  padChords(42, chords, 0.3);
  bassLine(42, chords, 0.32, "whole");
  pianoArp(42, chords, 0.2, 1, 12);
  themeBars(46, 8, "piano", 0.42, 0, 0.15);
  chords.forEach((c, i) => { pluck(bt(42 + i, 0), CH[c].root + 24, 0.25, -0.3, 0.7, 0.6); pluck(bt(42 + i, 2), CH[c].tri[1] + 12, 0.18, 0.3, 0.7, 0.6); });
  [[54, "A5"], [55, "G5"], [56, "F5"], [57, "E5"]].forEach(([b, nt]) => glock(bt(b, 0), n(nt) - 12, 0.3, 0.2));
}
// bars 58–69: your choice / technology (theme returns, warm, with strings and a steady pulse)
{
  const chords = [...THEME_CH, "F", "C", "Bb"];
  padChords(58, chords, 0.32);
  bassLine(58, chords, 0.45, "half");
  strum(58, chords, 0.24);
  themeBars(58, 8, "marimba", 0.46, 0, 0.1);
  themeBars(62, 4, "glock", 0.3, 0, -0.25);
  chords.forEach((_, i) => { for (let k = 0; k < 4; k++) shaker(bt(58 + i, k + 0.5), 0.2, 0.4); });
  themeBars(66, 3, "piano", 0.38, 12, 0.2);
}
// bars 69–73.5: finale (full theme cadence, long F major chord with glock sparkle)
{
  const fin = ["Bb", "C", "F", "F"];
  padChords(69, ["Bb", "Csus"], 0.36);
  bassLine(69, ["Bb", "C"], 0.5, "half");
  [[69, 0, "D5", 1], [69, 1, "F5", 1], [69, 2, "E5", 1], [69, 3, "D5", 1], [70, 0, "C5", 1.5], [70, 1.5, "D5", 0.5], [70, 2, "E5", 1], [70, 3, "G5", 1]].forEach(([b, beat, nt, len]) => { marimba(bt(b, beat), n(nt), 0.5, 0.1); piano(bt(b, beat), n(nt), len * BEAT, 0.36, -0.15); });
  // the resolution: F major, held to the end
  const t = bt(71);
  ["F2", "C3", "F3", "A3", "C4", "F4", "A4"].forEach((nt, k) => piano(t + k * 0.03, n(nt), 6.5, 0.34, -0.3 + k * 0.1));
  strings(t, ["F3", "A3", "C4", "F4"].map(n), 6.8, 0.38);
  bass(t, n("F2"), 6.5, 0.5);
  ["C6", "F6", "A6", "C7"].forEach((nt, k) => glock(t + 0.4 + k * 0.28, n(nt) - 12, 0.32, -0.3 + k * 0.2));
  marimba(t, n("F5"), 0.5, 0.1);
  void fin;
}

// ── reverb (Freeverb-style) and master ─────────────────────────────────────────
function freeverb(inp, size = 0.86, damp = 0.35, offset = 0) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((d) => Math.round((d + offset) * SR / 44100));
  const aps = [556, 441, 341, 225].map((d) => Math.round((d + offset) * SR / 44100));
  const out = new Float32Array(N);
  const cb = combs.map((d) => ({ b: new Float32Array(d), i: 0, s: 0 }));
  const ab = aps.map((d) => ({ b: new Float32Array(d), i: 0 }));
  for (let i = 0; i < N; i++) {
    const x = inp[i] * 0.015;
    let s = 0;
    for (const c of cb) {
      const y = c.b[c.i];
      c.s = y * (1 - damp) + c.s * damp;
      c.b[c.i] = x + c.s * size;
      c.i = (c.i + 1) % c.b.length;
      s += y;
    }
    for (const a of ab) {
      const y = a.b[a.i];
      a.b[a.i] = s + y * 0.5;
      a.i = (a.i + 1) % a.b.length;
      s = y - s;
    }
    out[i] = s;
  }
  return out;
}
// keep the low end out of the reverb (less mud)
for (const buf of [RL, RR]) { let y = 0, px = 0; const a = 0.98; for (let i = 0; i < N; i++) { const x = buf[i]; y = a * (y + x - px); px = x; buf[i] = y; } }
console.log("reverb…");
const wl = freeverb(RL, 0.86, 0.35, 0), wr = freeverb(RR, 0.86, 0.35, 23);
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = L[i] + wl[i] * 0.9; R[i] = R[i] + wr[i] * 0.9; }
// master high-pass around 35 Hz
for (const buf of [L, R]) { let y = 0, px = 0; const a = 1 / (1 + 2 * Math.PI * 35 / SR); for (let i = 0; i < N; i++) { const x = buf[i]; y = a * (y + x - px); px = x; buf[i] = y; } }
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
// fade in from silence and out at the very end; soft-clip; normalise to -1 dBFS
const g = 0.89 / peak;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const env = Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (DUR - t) / 2.5));
  L[i] = Math.tanh(L[i] * g * 1.1) * env;
  R[i] = Math.tanh(R[i] * g * 1.1) * env;
}
const out = path.join(__dirname, "..", "build", "music.wav");
writeWav(out, SR, [L, R]);
console.log("wrote", out, (N / SR).toFixed(1) + "s", "peak before norm", peak.toFixed(3));
