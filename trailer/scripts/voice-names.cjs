// Pronunciation tests for the brand names, scored by Whisper.
const path = require("path"), fs = require("fs");
const { transcriber, load16k } = require("./asr-check.cjs");
const TESTS = [
  "First, plant a deposit.", "Plant your deposit.", "Start by planting a deposit.",
  "Through the Hug shire Vault and Ree-uh Finance, your funds can earn variable lending yield.",
  "Through the Hug shire Vault and Rhea Finance, your funds can earn variable lending yield.",
  "Through the Hug shire Vault and RHEA Finance, your funds can earn variable lending yield.",
  "Through the Hug shire Vault, and Ree-ah Finance, your funds can earn variable lending yield.",
  "Through the Hug shire Vault and the Rhea lending market, your funds can earn variable yield.",
];
(async () => {
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
  const asr = await transcriber();
  const dir = path.join(__dirname, "..", "build", "names"); fs.mkdirSync(dir, { recursive: true });
  for (const [k, t] of TESTS.entries()) {
    const f = path.join(dir, `n${k}.wav`);
    await (await tts.generate(t, { voice: process.argv[2] || "af_heart", speed: 1.0 })).save(f);
    console.log(t.padEnd(48), "→", (await asr(load16k(f))).text.trim());
  }
})();
