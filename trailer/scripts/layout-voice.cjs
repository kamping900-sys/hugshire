// Places every narration line on the trailer timeline (scene start + lead, then line + gap) -> build/voice/placed.json
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const lines = require(path.join(ROOT, "build/voice/lines.json"));
const script = require(path.join(ROOT, "script/narration.json"));
const tl = require(path.join(ROOT, "script/timeline.json"));
const out = [];
for (const sc of tl.scenes) {
  const meta = script.scenes.find((s) => s.id === sc.id);
  let t = sc.start + meta.lead;
  for (const l of lines.filter((x) => x.scene === sc.id)) {
    out.push({ ...l, at: +t.toFixed(3) });
    t += l.dur + l.gap;
  }
  const last = out[out.length - 1];
  if (last.at + last.dur > sc.end) console.log("!! overflow", sc.id, (last.at + last.dur - sc.end).toFixed(2));
}
fs.writeFileSync(path.join(ROOT, "build/voice/placed.json"), JSON.stringify(out, null, 2));
for (const l of out) console.log(l.scene.padEnd(4), l.at.toFixed(2).padStart(7), "→", (l.at + l.dur).toFixed(2).padStart(7), l.text.slice(0, 70));
