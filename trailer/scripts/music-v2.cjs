/**
 * Original score for the Hugshire trailer, synthesised from scratch (no samples, no third-party music).
 *   node scripts/music-v2.cjs  →  build/music-v2.wav (V2 arrangement) (48 kHz stereo)
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
const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const DUR = 137;
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

// ── arrangement (V2, 2:16) ──────────────────────────────────────────────────────
// 100 BPM, bar = 2.4 s. Scene starts (s): home 17.6, deposit 28.3, map 44.5, build 55.0, pool 71.3,
// board 90.3, withdraw 106.6, tech 114.5, outro 122.6, "Hugshire." 128.1, end 136.1.
// bars 0–7 problem statement: soft solo piano, a hint of wistfulness
{
  const prog = ["Dm", "Bb", "F", "C", "Dm", "Bb", "Csus"];
  prog.forEach((c, i) => {
    const t = bt(i);
    piano(t, CH[c].root + 12, BAR * 0.95, 0.3, -0.1);
    const tri = CH[c].tri.map((m) => m + 12);
    [0, 1.5, 2.5].forEach((b, k) => piano(t + b * BEAT, tri[k], BEAT * 1.4, 0.22, 0.15));
  });
  [[2, 2, "A4"], [2, 3, "C5"], [3, 0, "D5"], [4, 2, "C5"], [4, 3, "F5"], [5, 0, "E5"], [6, 2, "G5"]].forEach(([b, beat, nt]) => piano(bt(b, beat), n(nt), BEAT * 1.5, 0.3, 0.25));
  padChords(1, prog.slice(1), 0.16, -12);
}
// bars 7–12 homepage reveal: the theme arrives, playful (marimba + glock + pizzicato)
themeBars(7, 4, "marimba", 0.55, 0, 0.1);
themeBars(7, 4, "glock", 0.36, 0, -0.2);
padChords(7, THEME_CH.slice(0, 4), 0.24);
bassLine(7, THEME_CH.slice(0, 4), 0.42, "whole");
for (let b = 7; b < 11; b++) for (let k = 0; k < 4; k++) pluck(bt(b, k), CH[THEME_CH[(b - 7) % 8]].tri[k % 3] + 12, 0.3, -0.35, 0.8, 0.5);
padChords(11, ["Csus"], 0.26); bassLine(11, ["C"], 0.4, "half");
[0, 1, 2, 3].forEach((k) => glock(bt(11, k), n(["C5", "D5", "E5", "G5"][k]), 0.28, 0.2));
// bars 12–18.5 deposit → fruit: gentle (theme on soft pluck over strings)
{
  const ch = ["F", "C", "Dm", "Bb", "F", "C", "Bb"];
  padChords(12, ch, 0.26);
  bassLine(12, ch, 0.34, "whole");
  pianoArp(12, ch, 0.16, 1, 12);
  themeBars(12, 7, "pluck", 0.34, 12, 0.15);
}
// bars 18.5–23 world map: adventure (strum, shaker, glock theme)
{
  const ch = ["F", "C", "Dm", "Bb", "F"];
  strum(18.5, ch, 0.32);
  bassLine(18.5, ch, 0.46, "half");
  padChords(18.5, ch, 0.14);
  themeBars(18.5, 4, "glock", 0.34, 0, 0.25);
  themeBars(18.5, 4, "marimba", 0.42, 0, -0.1);
  for (let b = 18.5; b < 23; b += 0.5) shaker(bt(b), 0.28);
}
// bars 23–29.5 play and build: brighter (woodblock, soft kick, marimba ostinato), lifting at the completion
{
  const ch = ["F", "C", "Dm", "Bb", "F", "C", "F"];
  bassLine(23, ch, 0.48, "quarter");
  padChords(23, ch, 0.14);
  ch.forEach((c, i) => {
    const tri = CH[c].tri.map((m) => m + 12);
    for (let k = 0; k < 8; k++) marimba(bt(23 + i, k * 0.5), tri[[0, 1, 2, 1, 0, 2, 1, 2][k]], k % 2 ? 0.26 : 0.36, -0.25);
    softKick(bt(23 + i, 0), 0.42); softKick(bt(23 + i, 2), 0.32);
    woodblock(bt(23 + i, 1), 0.36, 1); woodblock(bt(23 + i, 3), 0.32, 1.12);
    for (let k = 0; k < 8; k++) shaker(bt(23 + i, k * 0.5), k % 2 ? 0.18 : 0.26, 0.4);
  });
  themeBars(25, 4, "pluck", 0.36, 12, 0.1);
  themeBars(27, 2, "glock", 0.34, 0, 0.3);
}
// bars 29.5–37.5 optional ads → Community Pool: playful and bright
{
  const ch = [...THEME_CH];
  strum(29.5, ch, 0.28);
  bassLine(29.5, ch, 0.44, "half");
  padChords(29.5, ch, 0.18);
  themeBars(29.5, 8, "marimba", 0.46, 0, 0.1);
  themeBars(33.5, 4, "glock", 0.3, 0, -0.25);
  for (let b = 29.5; b < 37.5; b += 0.5) shaker(bt(b), 0.22, 0.4);
}
// bars 37.5–44.5 Notice Board: soft and sincere (piano melody over strings)
{
  const ch = ["Bb", "F", "Gm", "C", "Bb", "F", "Csus"];
  padChords(37.5, ch, 0.3);
  bassLine(37.5, ch, 0.3, "whole");
  pianoArp(37.5, ch, 0.18, 1, 12);
  themeBars(38.5, 6, "piano", 0.4, 0, 0.15);
}
// bars 44.5–48 withdrawal: calm
{
  const ch = ["F", "Am", "Bb", "Csus"];
  padChords(44.5, ch, 0.28);
  bassLine(44.5, ch, 0.3, "whole");
  pianoArp(44.5, ch, 0.17, 1, 12);
}
// bars 48–51 technology: a steady pulse building towards the finale
{
  const ch = ["Dm", "Bb", "C"];
  padChords(48, ch, 0.3);
  bassLine(48, ch, 0.4, "quarter");
  ch.forEach((c, i) => { for (let k = 0; k < 8; k++) pluck(bt(48 + i, k * 0.5), CH[c].tri[k % 3] + 12, 0.24, 0.3, 0.75, 0.4); });
  for (let b = 48; b < 51; b += 0.5) shaker(bt(b), 0.2, 0.4);
}
// bars 51–end finale: the theme, warm and full, resolving on "Hugshire."
{
  padChords(51, ["Bb", "C"], 0.36);
  bassLine(51, ["Bb", "C"], 0.48, "half");
  [[51, 0, "D5", 1], [51, 1, "F5", 1], [51, 2, "E5", 1], [51, 3, "D5", 1], [52, 0, "C5", 1.5], [52, 1.5, "D5", 0.5], [52, 2, "E5", 1], [52, 3, "G5", 1]].forEach(([b, beat, nt, len]) => { marimba(bt(b, beat), n(nt), 0.5, 0.1); piano(bt(b, beat), n(nt), len * BEAT, 0.36, -0.15); });
  const t = 128.0; // lands with "Hugshire."
  ["F2", "C3", "F3", "A3", "C4", "F4", "A4"].forEach((nt, k) => piano(t + k * 0.03, n(nt), 7.5, 0.34, -0.3 + k * 0.1));
  strings(t, ["F3", "A3", "C4", "F4"].map(n), 7.6, 0.4);
  bass(t, n("F2"), 7.5, 0.5);
  ["C6", "F6", "A6", "C7"].forEach((nt, k) => glock(t + 0.4 + k * 0.28, n(nt) - 12, 0.32, -0.3 + k * 0.2));
  marimba(t, n("F5"), 0.5, 0.1);
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
const out = path.join(__dirname, "..", "build", "music-v2.wav");
writeWav(out, SR, [L, R]);
console.log("wrote", out, (N / SR).toFixed(1) + "s", "peak before norm", peak.toFixed(3));
