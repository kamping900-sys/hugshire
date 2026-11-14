/** Burned-in caption track: one Manrope caption card per SRT cue, assembled into a transparent .mov. */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");
const FFMPEG = require("ffmpeg-static");
const { Recorder } = require("../lib/recorder.cjs");
const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "build", "captions");
fs.mkdirSync(DIR, { recursive: true });
const PAGE = pathToFileURL(path.join(ROOT, "overlays", "overlay.html")).href;
const toS = (s) => { const [h, m, r] = s.split(":"); const [sec, ms] = r.split(","); return +h * 3600 + +m * 60 + +sec + +ms / 1000; };
const cues = fs.readFileSync(path.join(ROOT, "out", "hugshire-trailer.srt"), "utf8").trim().split(/\r?\n\r?\n/).map((b) => {
  const [, time, ...text] = b.split(/\r?\n/);
  const [a, z] = time.split(" --> ").map(toS);
  return { a, z, text: text.join("\n") };
});
(async () => {
  const r = await Recorder.open({ width: 1920, height: 1080, scale: 1 });
  const shot = async (file, text) => {
    await r.page.goto(`${PAGE}?o=caption&text=${encodeURIComponent(text)}`);
    await r.page.evaluate(() => document.fonts.ready);
    await r.page.screenshot({ path: file, omitBackground: true });
  };
  await shot(path.join(DIR, "blank.png"), "");
  await r.page.evaluate(() => { document.getElementById("capText").style.display = "none"; });
  await r.page.screenshot({ path: path.join(DIR, "blank.png"), omitBackground: true });
  for (const [i, c] of cues.entries()) await shot(path.join(DIR, `c${String(i).padStart(3, "0")}.png`), c.text);
  await r.close();
  // concat list: blank gaps and cues, each with its duration
  const lines = [];
  let t = 0;
  const push = (f, d) => { if (d > 0.001) { lines.push(`file '${f.replace(/\\/g, "/")}'`, `duration ${d.toFixed(3)}`); } };
  cues.forEach((c, i) => { push(path.join(DIR, "blank.png"), c.a - t); push(path.join(DIR, `c${String(i).padStart(3, "0")}.png`), c.z - c.a); t = c.z; });
  push(path.join(DIR, "blank.png"), 180 - t);
  lines.push(`file '${path.join(DIR, "blank.png").replace(/\\/g, "/")}'`);
  fs.writeFileSync(path.join(DIR, "list.txt"), lines.join("\n"));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(DIR, "list.txt"), "-vf", "fps=30,format=argb", "-t", "180", "-c:v", "qtrle", path.join(ROOT, "build", "captions.mov")]);
  console.log("caption track:", cues.length, "cues");
})();
