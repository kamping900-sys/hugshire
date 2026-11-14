// Clarity bake-off: tricky V2 lines in several Kokoro female voices, scored by Whisper word error rate.
const path = require("path"), fs = require("fs");
const { transcriber, load16k, wer } = require("./asr-check.cjs");
const LINES = [
  ["Meet Hug shire.", "Meet Hugshire."],
  ["Through the Hug shire Vault and Rhea Finance, your funds can earn variable lending yield.", "Through the Hugshire Vault and Rhea Finance, your funds can earn variable lending yield."],
  ["The shared charity budget is split equally among eligible supporters.", null],
  ["And almost half of adults say pressure to give puts them off.", null],
  ["Harvest it, choose a cause, and turn your earnings into kindness.", null],
  ["And designed so every payout to a cause can be verified on the Near blockchain.", null],
  ["Play, contribute resources, and help build something together.", null],
  ["Forty-one percent of Americans who didn't donate said they couldn't afford to.", "41% of Americans who didn't donate said they couldn't afford to."],
];
const VOICES = (process.argv[2] || "af_heart,af_bella,af_nicole,af_sarah,af_sky,af_nova,af_aoede,af_kore,af_alloy,bf_emma,bf_isabella").split(",");
const SPEED = +(process.argv[3] || 1.0);
(async () => {
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
  const asr = await transcriber();
  const dir = path.join(__dirname, "..", "build", "bakeoff");
  fs.mkdirSync(dir, { recursive: true });
  const res = [];
  for (const v of VOICES) {
    let tot = 0, words = 0, misses = [];
    for (const [k, [say, ref]] of LINES.entries()) {
      const f = path.join(dir, `${v}_${SPEED}_${k}.wav`);
      await (await tts.generate(say, { voice: v, speed: SPEED })).save(f);
      const heard = (await asr(load16k(f))).text.trim();
      const r = ref || say, e = wer(r, heard), n = r.split(" ").length;
      tot += e * n; words += n;
      if (e > 0) misses.push(`"${heard}"`);
    }
    res.push({ v, wer: tot / words, misses });
    console.log(v.padEnd(12), (100 * tot / words).toFixed(1).padStart(5) + "%", misses.slice(0, 3).join(" | "));
  }
})();
