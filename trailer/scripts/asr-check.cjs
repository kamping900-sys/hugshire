/**
 * Transcribes narration lines with Whisper (local, onnx-community/whisper-base.en) and compares each with
 * the script, word by word. Usage: node scripts/asr-check.cjs <lines.json> [--wav <file>]
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const FFMPEG = require("ffmpeg-static");
const { readWav } = require("../lib/wav.cjs");

const norm = (s) => s.toLowerCase().replace(/forty-one percent/g, "41%").replace(/hug ?shire|hug-shire/g, "hugshire").replace(/(ree-ah|ria|rhea|ree ah)/g, "rhea").replace(/[’']/g, "'").replace(/[^a-z0-9%' ]+/g, " ").replace(/\s+/g, " ").trim();
function wer(ref, hyp) {
  const r = norm(ref).split(" "), h = norm(hyp).split(" ");
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}

async function transcriber() {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("automatic-speech-recognition", "onnx-community/whisper-base.en", { dtype: "fp32", device: "cpu" });
}
function load16k(file, start = 0, dur = null) {
  const tmp = path.join(__dirname, "..", "build", "_asr16k.wav");
  const args = ["-y", "-loglevel", "error", "-ss", String(start), ...(dur ? ["-t", String(dur)] : []), "-i", file, "-ac", "1", "-ar", "16000", "-c:a", "pcm_f32le", tmp];
  execFileSync(FFMPEG, args);
  return readWav(tmp).chans[0];
}

module.exports = { transcriber, load16k, wer, norm };

if (require.main === module) {
  (async () => {
    const lines = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const asr = await transcriber();
    let bad = 0;
    for (const l of lines) {
      const audio = load16k(l.file, l.trimStart || 0, l.dur ? l.dur + 0.2 : null);
      const out = await asr(audio);
      const e = wer(l.cap || l.text, out.text);
      if (e > 0) bad++;
      console.log(`${e === 0 ? "OK " : "XX "} ${(e * 100).toFixed(0).padStart(3)}%  ${l.id || l.scene + "_" + l.i}\n     script: ${l.cap || l.text}\n     heard:  ${out.text.trim()}`);
    }
    console.log(`\n${lines.length - bad}/${lines.length} lines transcribed exactly`);
  })();
}
