/**
 * Renders the trailer from the EDL: footage shots with crossfades and looks, overlays, the disclosure badge,
 * and the loudness-normalised mix. Also writes the SRT and, with --subs, a captioned copy.
 *   node scripts/render.cjs            → out/hugshire-trailer.mp4 + out/hugshire-trailer.srt
 *   node scripts/render.cjs --subs     → also out/hugshire-trailer-subtitled.mp4
 *   node scripts/render.cjs --preview  → quick low-quality render to build/preview.mp4
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const FFMPEG = require("ffmpeg-static");
const { shots, overlays, duration: DUR } = require("../script/edl.cjs");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "out");
fs.mkdirSync(OUT, { recursive: true });
const preview = process.argv.includes("--preview");
const subs = process.argv.includes("--subs");
const FPS = 30;

function probeDur(file) {
  const r = spawnSync(FFMPEG, ["-i", file], { encoding: "utf8" });
  const m = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

// ── 1. audio: loudness-normalise the mix (two passes) ──
const MIX_RAW = path.join(ROOT, "build/mix_raw.wav"), MIX = path.join(ROOT, "build/mix.wav");
if (!fs.existsSync(MIX) || fs.statSync(MIX).mtimeMs < fs.statSync(MIX_RAW).mtimeMs) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", MIX_RAW, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const j = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf("{"), r.stderr.lastIndexOf("}") + 1));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", MIX_RAW, "-af", `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`, "-c:a", "pcm_s16le", MIX]);
  console.log("mix normalised (measured", j.input_i, "LUFS)");
}

// ── 2. subtitles (SRT) from the placed narration ──
const placed = require(path.join(ROOT, "build/voice/placed.json"));
const ts = (t) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
function wrap(text, max = 44) {
  const words = text.split(" "), lines = [""];
  for (const w of words) { if ((lines[lines.length - 1] + " " + w).trim().length > max) lines.push(w); else lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim(); }
  return lines.join("\n");
}
const cues = [];
for (const l of placed) {
  // long lines become several cues, split at commas, timed by length
  const text = l.text.replace("forty-one percent", "41%");
  const parts = text.length > 80 ? text.split(/(?<=,)\s+/).reduce((acc, p) => { if (acc.length && (acc[acc.length - 1] + " " + p).length <= 80) acc[acc.length - 1] += " " + p; else acc.push(p); return acc; }, []) : [text];
  const total = parts.reduce((s, p) => s + p.length, 0);
  let t = l.at;
  for (const p of parts) { const d = l.dur * (p.length / total); cues.push({ a: t, b: t + d, text: wrap(p) }); t += d; }
}
// keep each cue up a little after speech ends, without overlapping the next
for (let i = 0; i < cues.length; i++) cues[i].b = Math.min(cues[i].b + 0.35, i + 1 < cues.length ? cues[i + 1].a - 0.05 : DUR);
const SRT = path.join(OUT, "hugshire-trailer.srt");
fs.writeFileSync(SRT, cues.map((c, i) => `${i + 1}\n${ts(c.a)} --> ${ts(c.b)}\n${c.text}\n`).join("\n"));
console.log("srt:", cues.length, "cues");

// ── 3. video graph ──
const ordered = [...shots].sort((a, b) => a.at - b.at);
const args = ["-y", "-loglevel", "error", "-stats"];
const fc = [];
let inIdx = 0;
fc.push(`color=c=black:s=1920x1080:r=${FPS}:d=${DUR},format=yuv420p[base]`);
let last = "base";
const LOOK = {
  quiet: "eq=saturation=0.84:brightness=-0.012:gamma=0.98,colorbalance=rm=0.025:bm=-0.03,vignette=angle=PI/4.6",
  glow: "eq=saturation=1.07:brightness=0.012,colorbalance=rm=0.02:bm=-0.02,vignette=angle=PI/5.5",
  soft: "gblur=sigma=9,eq=brightness=-0.07:saturation=0.9",
};
ordered.forEach((s, i) => {
  const next = ordered[i + 1];
  const len = (next ? next.at + (next.fade || 0) : DUR) - s.at;
  const file = path.join(ROOT, "footage", s.clip + ".mp4");
  const avail = probeDur(file) - s.src[0];
  const pad = Math.max(0, len - avail + 0.1);
  args.push("-ss", String(s.src[0]), "-t", String(Math.min(len + 0.05, avail)), "-i", file);
  const f = [`[${inIdx}:v]fps=${FPS},setpts=PTS-STARTPTS`];
  if (pad > 0) f.push(`tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`);
  f.push(`trim=duration=${len.toFixed(3)}`, "setpts=PTS-STARTPTS");
  if (s.look && LOOK[s.look]) f.push(LOOK[s.look]);
  f.push("format=yuva420p");
  if (i === 0) f.push("fade=t=in:st=0:d=1.6"); // from black
  else if (s.fade) f.push(`fade=t=in:st=0:d=${s.fade}:alpha=1`);
  f.push(`setpts=PTS+${s.at}/TB`);
  fc.push(`${f.join(",")}[s${i}]`);
  fc.push(`[${last}][s${i}]overlay=eof_action=pass:shortest=0[v${i}]`);
  last = `v${i}`;
  inIdx++;
});
// overlays
overlays.forEach((o, k) => {
  const file = path.join(ROOT, "build/overlays", `${o.name}.${o.type}`);
  if (o.type === "png") {
    const d = o.to - o.at;
    args.push("-loop", "1", "-t", String(d), "-i", file);
    fc.push(`[${inIdx}:v]fps=${FPS},format=yuva420p,fade=t=in:st=0:d=0.5:alpha=1,fade=t=out:st=${(d - 0.5).toFixed(2)}:d=0.5:alpha=1,setpts=PTS-STARTPTS+${o.at}/TB[o${k}]`);
  } else {
    args.push("-i", file);
    const hold = o.hold ? `,tpad=stop_mode=clone:stop_duration=${Math.max(0, DUR - o.at - probeDur(file)).toFixed(3)}` : "";
    fc.push(`[${inIdx}:v]fps=${FPS},format=yuva420p${hold},setpts=PTS-STARTPTS+${o.at}/TB[o${k}]`);
  }
  fc.push(`[${last}][o${k}]overlay=x=0:y=${o.y || 0}:eof_action=pass[w${k}]`);
  last = `w${k}`;
  inIdx++;
});
fc.push(`[${last}]fade=t=out:st=${DUR - 1.3}:d=1.3,format=yuv420p[vout]`);
args.push("-i", MIX);
const audioIdx = inIdx;
const graphFile = path.join(ROOT, "build/graph.txt");
fs.writeFileSync(graphFile, fc.join(";\n"));
const target = preview ? path.join(ROOT, "build/preview.mp4") : path.join(OUT, "hugshire-trailer.mp4");
args.push("-filter_complex_script", graphFile, "-map", "[vout]", "-map", `${audioIdx}:a`, "-t", String(DUR), "-r", String(FPS));
if (preview) args.push("-s", "960x540", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28");
else args.push("-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-x264-params", "keyint=60:min-keyint=30");
args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", target);
console.log("rendering", target, `(${ordered.length} shots, ${overlays.length} overlays)`);
const t0 = Date.now();
execFileSync(FFMPEG, args, { stdio: "inherit" });
console.log("done in", ((Date.now() - t0) / 1000).toFixed(0), "s");

// ── 4. captioned copy ──
if (subs && !preview) {
  // captions in the brand font: a transparent caption track rendered from the SRT (capture/captions.cjs)
  execFileSync(process.execPath, [path.join(ROOT, "capture/captions.cjs")], { stdio: "inherit" });
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-stats", "-i", target, "-i", path.join(ROOT, "build/captions.mov"), "-filter_complex", "[1:v]format=yuva420p[c];[0:v][c]overlay=0:0:eof_action=pass,format=yuv420p[v]", "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", path.join(OUT, "hugshire-trailer-subtitled.mp4")], { stdio: "inherit" });
  console.log("captioned copy done");
}
