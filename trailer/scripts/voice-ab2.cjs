// Re-voice the worst V1 lines with fp32 and transcribe them, to confirm the quantised model is the cause.
const fs = require("fs"), path = require("path");
(async () => {
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
  const L = require("../build/voice/lines.json").filter((l) => ["s7_2", "s5_3", "s3_1", "s1_3", "s2_0", "s6_0", "s3_2", "s1_2"].includes(`${l.scene}_${l.i}`));
  const out = [];
  for (const l of L) {
    const f = path.join(__dirname, "..", "build", `ab32-${l.scene}_${l.i}.wav`);
    await (await tts.generate(l.text, { voice: "af_heart", speed: l.speed })).save(f);
    out.push({ id: `${l.scene}_${l.i}`, text: l.text, file: f });
  }
  fs.writeFileSync(path.join(__dirname, "..", "build", "ab32.json"), JSON.stringify(out, null, 1));
})();
