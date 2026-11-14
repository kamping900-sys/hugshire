/**
 * V2 narration: each group of script/narration-v2.json voiced in one pass with Kokoro af_heart (fp32, local).
 * Only true silence is trimmed (1% of peak, with generous padding) so no word is ever cut.
 * Writes build/voice2/<scene>_<n>.wav and build/voice2/lines.json.
 */
const fs = require("fs"), path = require("path");
const { readWav } = require("../lib/wav.cjs");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "build", "voice2");
fs.mkdirSync(OUT, { recursive: true });
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "script", "narration-v2.json"), "utf8"));
(async () => {
  const { KokoroTTS } = await import("kokoro-js");
  let tts = null;
  const lines = [];
  for (const sc of S.scenes) {
    for (const [k, g] of sc.groups.entries()) {
      const file = path.join(OUT, `${sc.id}_${k}.wav`), key = `${g.say}|${sc.speed}|${S.voice}|fp32`;
      if (!(fs.existsSync(file) && fs.existsSync(file + ".key") && fs.readFileSync(file + ".key", "utf8") === key)) {
        tts ??= await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
        await (await tts.generate(g.say, { voice: S.voice, speed: sc.speed })).save(file);
        fs.writeFileSync(file + ".key", key);
      }
      const w = readWav(file), x = w.chans[0], sr = w.rate;
      let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
      const thr = peak * 0.01;
      let a = 0, z = x.length - 1;
      while (a < x.length && Math.abs(x[a]) < thr) a++;
      while (z > a && Math.abs(x[z]) < thr) z--;
      const start = Math.max(0, a / sr - 0.08), end = Math.min(x.length / sr, z / sr + 0.2);
      lines.push({ id: `${sc.id}_${k}`, scene: sc.id, text: g.say, cap: g.cap, gap: g.gap, file, trimStart: +start.toFixed(3), dur: +(end - start).toFixed(3) });
    }
  }
  fs.writeFileSync(path.join(OUT, "lines.json"), JSON.stringify(lines, null, 2));
  for (const sc of S.scenes) {
    const ls = lines.filter((l) => l.scene === sc.id);
    console.log(sc.id.padEnd(9), ls.reduce((s, l) => s + l.dur + l.gap, 0).toFixed(1) + "s");
  }
  console.log("total", lines.reduce((s, l) => s + l.dur + l.gap, 0).toFixed(1) + "s");
})();
