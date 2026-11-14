// Quick check of a few Kokoro female voices on one line of the script.
const path = require("path");
const fs = require("fs");
(async () => {
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
  const out = path.join(__dirname, "..", "build", "voice-test");
  fs.mkdirSync(out, { recursive: true });
  const line = "Welcome to Hugshire. A little world, with a lot of heart.";
  for (const v of (process.argv[2] || "af_heart,af_bella,af_nicole,bf_emma").split(",")) {
    const audio = await tts.generate(line, { voice: v, speed: 0.95 });
    audio.save(path.join(out, `${v}.wav`));
    console.log("saved", v);
  }
})();
