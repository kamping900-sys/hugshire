// V2: places narration groups on the timeline and derives scene boundaries -> build/voice2/placed.json, script/timeline-v2.json
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const lines = require(path.join(ROOT, "build/voice2/lines.json"));
const pace = require(path.join(ROOT, "script/pacing-v2.json"));
const order = ["open", "home", "deposit", "map", "build", "pool", "board", "withdraw", "tech", "outro"];
let t = 0;
const placed = [], scenes = [];
for (const id of order) {
  const start = t;
  t += pace[id].lead;
  const ls = lines.filter((l) => l.scene === id);
  ls.forEach((l, k) => { placed.push({ ...l, at: +t.toFixed(3) }); t += l.dur + (k < ls.length - 1 ? l.gap : 0); });
  t += pace[id].tail;
  scenes.push({ id, start: +start.toFixed(2), end: +t.toFixed(2) });
}
fs.writeFileSync(path.join(ROOT, "build/voice2/placed.json"), JSON.stringify(placed, null, 2));
fs.writeFileSync(path.join(ROOT, "script/timeline-v2.json"), JSON.stringify({ fps: 30, duration: +t.toFixed(2), scenes }, null, 2));
for (const s of scenes) console.log(s.id.padEnd(9), s.start.toFixed(1).padStart(6), "→", s.end.toFixed(1).padStart(6), `(${(s.end - s.start).toFixed(1)}s)`);
for (const l of placed) console.log("   ", l.at.toFixed(2).padStart(7), (l.at + l.dur).toFixed(2).padStart(7), l.id);
console.log("total", t.toFixed(2));
