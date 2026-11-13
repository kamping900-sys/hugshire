/**
 * Original, synthesized sound effects (Web Audio). No recorded or extracted audio is used.
 * All sounds are generated from oscillators and noise at runtime.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
export const setMuted = (m: boolean) => {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
};
export const isMuted = () => muted;

function tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, slideTo?: number) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol: number, filter: number, at = 0, q = 1) {
  const a = audio();
  if (!a || !master) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime + at;
  const s = a.createBufferSource();
  s.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = filter;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  tick: (accent = false) => tone(accent ? 1320 : 990, 0.05, "square", accent ? 0.08 : 0.05),
  /** NPC places a real log: a warm woody knock. */
  logCue: () => {
    tone(320, 0.09, "triangle", 0.22);
    noise(0.05, 0.12, 900, 0, 2);
  },
  /** NPC fake-out tell: a rising "hm?" so it can be read by ear. */
  fakeTell: () => {
    tone(420, 0.16, "sine", 0.14, 0, 700);
    tone(700, 0.08, "sine", 0.08, 0.16, 520);
  },
  chop: (perfect: boolean) => {
    noise(perfect ? 0.18 : 0.12, perfect ? 0.5 : 0.35, perfect ? 1800 : 1300, 0, 1.2);
    tone(perfect ? 180 : 150, 0.12, "triangle", 0.35, 0, 70);
    if (perfect) {
      tone(880, 0.12, "sine", 0.12, 0.04);
      tone(1320, 0.18, "sine", 0.1, 0.09);
    }
  },
  whiff: () => noise(0.14, 0.18, 2600, 0, 0.7),
  miss: () => {
    tone(220, 0.18, "sawtooth", 0.09, 0, 120);
  },
  heartLost: () => {
    tone(520, 0.1, "square", 0.07);
    tone(390, 0.16, "square", 0.07, 0.1);
  },
  read: () => tone(1040, 0.09, "sine", 0.09),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, "triangle", 0.13, i * 0.09)),
  over: () => [392, 330, 262].forEach((f, i) => tone(f, 0.24, "triangle", 0.12, i * 0.14)),
};
