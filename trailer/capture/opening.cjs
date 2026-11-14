// Renders the V2 opening (overlays/opening.html) to footage/v2_opening.mp4, frame-stepped.
const path = require("path");
const { pathToFileURL } = require("url");
const { Recorder } = require("../lib/recorder.cjs");
(async () => {
  const r = await Recorder.open({ width: 1920, height: 1080, scale: 1 });
  await r.page.goto(pathToFileURL(path.join(__dirname, "..", "overlays", "opening.html")).href);
  await r.page.evaluate(() => document.fonts.ready);
  r.startClip("v2_opening");
  await r.seconds(+(process.argv[2] || 17.7));
  await r.endClip();
  await r.close();
})();
