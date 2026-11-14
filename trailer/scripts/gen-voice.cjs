/**
 * Narration: every line of script/narration.json is spoken by Kokoro (af_heart, Apache-2.0, runs locally),
 * saved as its own WAV, and its length measured. Writes build/voice/lines.json for the timeline.
 *   node scripts/gen-voice.cjs            (only missing lines)
 *   node scripts/gen-voice.cjs --force    (all lines)
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "build", "voice");
fs.mkdirSync(OUT, { recursive: true });
const script = JSON.parse(fs.readFileSync(path.join(ROOT, "script", "narration.json"), "utf8"));
const force = process.argv.includes("--force");

function wavSeconds(file) {
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24), bits = b.readUInt16LE(34), ch = b.readUInt16LE(22);
  let off = 12;
  while (off < b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") return sz / (rate * ch * (bits / 8)); off += 8 + sz; }
  return 0;
}

(async () => {
  const { KokoroTTS } = await import("kokoro-js");
  let tts = null;
  const lines = [];
  for (const sc of script.scenes) {
    sc.lines.forEach((ln, i) => lines.push({ scene: sc.id, i, text: ln.t, gap: ln.gap, speed: ln.speed ?? sc.speed ?? 1, file: path.join(OUT, `${sc.id}_${String(i).padStart(2, "0")}.wav`) }));
  }
  for (const l of lines) {
    const key = `${l.text}|${l.speed}|${script.voice}`;
    const meta = l.file + ".key";
    if (!force && fs.existsSync(l.file) && fs.existsSync(meta) && fs.readFileSync(meta, "utf8") === key) continue;
    tts ??= await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
    const audio = await tts.generate(l.text, { voice: script.voice, speed: l.speed });
    await audio.save(l.file);
    fs.writeFileSync(meta, key);
    console.log("voiced", path.basename(l.file), JSON.stringify(l.text.slice(0, 50)));
  }
  const { readWav, trimBounds } = require("../lib/wav.cjs");
  for (const l of lines) {
    const w = readWav(l.file);
    const t = trimBounds(w.chans[0], w.rate);
    l.trimStart = +t.start.toFixed(3);
    l.dur = +(t.end - t.start).toFixed(3); // spoken length without the silence Kokoro leaves at each end
  }
  fs.writeFileSync(path.join(OUT, "lines.json"), JSON.stringify(lines, null, 2));
  // report how each scene's narration fits its slot
  for (const sc of script.scenes) {
    const ls = lines.filter((l) => l.scene === sc.id);
    const need = sc.lead + ls.reduce((s, l) => s + l.dur + l.gap, 0);
    console.log(`${sc.id.padEnd(4)} slot ${(sc.end - sc.start).toFixed(1)}s  narration ${need.toFixed(1)}s  ${need > sc.end - sc.start ? "OVER" : "ok"}`);
  }
})();
