// A/B: the same sentence with the q8 and fp32 Kokoro weights; counts sharp sample jumps (crackle).
const path = require("path");
const { readWav } = require("../lib/wav.cjs");
(async () => {
  const { KokoroTTS } = await import("kokoro-js");
  const line = "As that yield adds up, heart-shaped fruits grow on your very own Heart Tree.";
  for (const dtype of ["q8", "fp32"]) {
    const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype, device: "cpu" });
    const f = path.join(__dirname, "..", "build", `ab-${dtype}.wav`);
    await (await tts.generate(line, { voice: "af_heart", speed: 0.97 })).save(f);
    const x = readWav(f).chans[0];
    let j = 0, p = 0; for (let i = 1; i < x.length; i++) { if (Math.abs(x[i] - x[i - 1]) > 0.35) j++; p = Math.max(p, Math.abs(x[i])); }
    console.log(dtype, "jumps", j, "peak", p.toFixed(2), "len", (x.length / 24000).toFixed(2) + "s");
  }
})();
