/**
 * Cozy background music, composed in code (Web Audio). No recorded or downloaded audio.
 * A soft music box plays a gentle, slightly different melody over warm pad chords
 * (Fmaj7 → Dm7 → B♭maj7 → C) at a slow tempo, through a little echo. Very quiet by design.
 */
import { audio, isMuted } from "./sfx";

const VOLUME = 0.09; // subtle: sits under the sound effects
const BPM = 70;
const BEAT = 60 / BPM;
// chords as MIDI notes (pad voicing) and the scale the melody picks from
const CHORDS = [
  [53, 57, 60, 64], // Fmaj7
  [50, 53, 57, 60], // Dm7
  [46, 50, 53, 57], // B♭maj7
  [48, 52, 55, 62], // C(add9)
];
const MELODY = [72, 74, 76, 77, 79, 81, 84]; // F major, upper register (music box)
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let out: GainNode | null = null;
let echoIn: GainNode | null = null;
let timer: number | null = null;
let nextAt = 0;
let step = 0; // beats since start
let on = false;
let wanted = true; // the player's music toggle

function readPref() {
  try {
    return window.localStorage.getItem("hs-music") !== "off";
  } catch {
    return true;
  }
}

function graph(a: AudioContext) {
  if (out) return;
  out = a.createGain();
  out.gain.value = 0;
  const tone = a.createBiquadFilter(); // round off the edges
  tone.type = "lowpass";
  tone.frequency.value = 2600;
  out.connect(tone);
  tone.connect(a.destination);
  // a soft echo for a roomy, dreamy feel
  echoIn = a.createGain();
  const delay = a.createDelay(1.5);
  delay.delayTime.value = BEAT * 0.75;
  const fb = a.createGain();
  fb.gain.value = 0.35;
  const wet = a.createGain();
  wet.gain.value = 0.35;
  echoIn.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(wet);
  wet.connect(out);
}

function pad(a: AudioContext, notes: number[], at: number, dur: number) {
  for (const n of notes) {
    for (const detune of [-6, 6]) {
      const o = a.createOscillator();
      o.type = "triangle";
      o.frequency.value = hz(n);
      o.detune.value = detune;
      const g = a.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.05, at + 1.2); // slow swell
      g.gain.setValueAtTime(0.05, at + dur - 1.2);
      g.gain.linearRampToValueAtTime(0, at + dur + 0.4);
      o.connect(g);
      g.connect(out!);
      o.start(at);
      o.stop(at + dur + 0.5);
    }
  }
}

function bell(a: AudioContext, note: number, at: number, vol = 0.22) {
  // music box: a sine with a quick shimmer partial and a long soft decay
  for (const [mult, v] of [[1, vol], [2, vol * 0.25], [3.01, vol * 0.08]] as const) {
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.value = hz(note) * mult;
    const g = a.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(v, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.2 / mult);
    o.connect(g);
    g.connect(out!);
    g.connect(echoIn!);
    o.start(at);
    o.stop(at + 2.4);
  }
}

// a tiny deterministic random so the tune wanders but feels composed
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function schedule() {
  const a = audio();
  if (!a || !out) return;
  // follow the game's mute button and the page being hidden
  const target = on && wanted && !isMuted() && !document.hidden ? VOLUME : 0;
  out.gain.setTargetAtTime(target, a.currentTime, 0.6);
  while (nextAt < a.currentTime + 1.2) {
    const bar = Math.floor(step / 4);
    const beat = step % 4;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    if (beat === 0 && bar % 2 === 0) pad(a, chord, nextAt, BEAT * 8);
    // melody: mostly on beats, sometimes an off-beat sparkle, sometimes a rest
    const r = rnd();
    if (r < 0.62) {
      const near = MELODY.filter((m) => chord.some((c) => (m - c) % 12 === 0) || rnd() < 0.4);
      bell(a, near[Math.floor(rnd() * near.length)] ?? MELODY[0], nextAt);
    }
    if (rnd() < 0.18) bell(a, MELODY[Math.floor(rnd() * MELODY.length)], nextAt + BEAT / 2, 0.12);
    // a low root note on the first beat of each chord
    if (beat === 0 && bar % 2 === 0) bell(a, chord[0] - 12, nextAt, 0.14);
    nextAt += BEAT;
    step += 1;
  }
}

/** Start the music (call from a click/keypress: browsers only allow sound after one). */
export function startMusic() {
  wanted = readPref();
  const a = audio();
  if (!a) return;
  graph(a);
  if (on) return;
  on = true;
  nextAt = a.currentTime + 0.2;
  timer = window.setInterval(schedule, 250);
  schedule();
}

/** Fade out and stop. */
export function stopMusic() {
  on = false;
  const a = audio();
  if (a && out) out.gain.setTargetAtTime(0, a.currentTime, 0.4);
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

export function musicEnabled() {
  return typeof window === "undefined" ? true : readPref();
}

/** The player's music toggle (remembered on this device). */
export function setMusicEnabled(v: boolean) {
  wanted = v;
  try {
    window.localStorage.setItem("hs-music", v ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
  if (v) startMusic();
  else {
    const a = audio();
    if (a && out) out.gain.setTargetAtTime(0, a.currentTime, 0.4);
  }
}
