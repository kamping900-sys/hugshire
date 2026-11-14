/**
 * Renders trailer V2 from script/edl-v2.cjs: shots with crossfades and looks, overlays and badges, the
 * loudness-normalised V2 mix, switchable English captions (mov_text) in the clean file, and a burned-in
 * CC copy (captions from capture/captions-v2.cjs).
 *   node scripts/render-v2.cjs [--preview]
 *   → out/hugshire-trailer-v2.mp4, out/hugshire-trailer-v2-cc.mp4 (out/hugshire-trailer-v2.srt from captions-v2)
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const FFMPEG = require("ffmpeg-static");
const { shots, overlays, duration: DUR } = require("../script/edl-v2.cjs");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "out");
fs.mkdirSync(OUT, { recursive: true });
const preview = process.argv.includes("--preview");
const subs = !process.argv.includes("--preview");
const FPS = 30;

function probeDur(file) {
  const r = spawnSync(FFMPEG, ["-i", file], { encoding: "utf8" });
  const m = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

// ── 1. audio: loudness-normalise the mix (two passes) ──
const MIX_RAW = path.join(ROOT, "build/mix2_raw.wav"), MIX = path.join(ROOT, "build/mix2.wav");
if (!fs.existsSync(MIX) || fs.statSync(MIX).mtimeMs < fs.statSync(MIX_RAW).mtimeMs) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", MIX_RAW, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const j = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf("{"), r.stderr.lastIndexOf("}") + 1));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", MIX_RAW, "-af", `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`, "-ar", "48000", "-c:a", "pcm_s16le", MIX]);
  console.log("mix normalised (measured", j.input_i, "LUFS)");
}

// ── 2. captions: out/hugshire-trailer-v2.srt and build/captions-v2.mov come from capture/captions-v2.cjs
const SRT = path.join(OUT, "hugshire-trailer-v2.srt");
if (!fs.existsSync(SRT)) execFileSync(process.execPath, [path.join(ROOT, "capture/captions-v2.cjs")], { stdio: "inherit" });

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
  const avail = probeDur(file) - s.src;
  const pad = Math.max(0, len - avail + 0.1);
  args.push("-ss", String(s.src), "-t", String(Math.min(len + 0.05, avail)), "-i", file);
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
args.push("-i", SRT);
const subIdx = inIdx + 1;
const graphFile = path.join(ROOT, "build/graph-v2.txt");
fs.writeFileSync(graphFile, fc.join(";\n"));
const target = preview ? path.join(ROOT, "build/preview-v2.mp4") : path.join(OUT, "hugshire-trailer-v2.mp4");
args.push("-filter_complex_script", graphFile, "-map", "[vout]", "-map", `${audioIdx}:a`, "-map", `${subIdx}:s`, "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-metadata:s:s:0", "title=English", "-t", String(DUR), "-r", String(FPS));
if (preview) args.push("-s", "960x540", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28");
else args.push("-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-x264-params", "keyint=60:min-keyint=30");
args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", target);
console.log("rendering", target, `(${ordered.length} shots, ${overlays.length} overlays)`);
const t0 = Date.now();
execFileSync(FFMPEG, args, { stdio: "inherit" });
console.log("done in", ((Date.now() - t0) / 1000).toFixed(0), "s");

// ── 4. burned-in CC copy
if (subs && !preview) {
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-stats", "-i", target, "-i", path.join(ROOT, "build/captions-v2.mov"), "-filter_complex", "[1:v]format=yuva420p[c];[0:v][c]overlay=0:0:eof_action=pass,format=yuv420p[v]", "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", path.join(OUT, "hugshire-trailer-v2-cc.mp4")], { stdio: "inherit" });
  console.log("CC copy done");
}
