/** Renders the trailer overlays from overlays/overlay.html: animated ones as transparent .mov, still ones as PNG. */
const path = require("path");
const { pathToFileURL } = require("url");
const { Recorder } = require("../lib/recorder.cjs");
const OUT = path.join(__dirname, "..", "build", "overlays");
const PAGE = pathToFileURL(path.join(__dirname, "..", "overlays", "overlay.html")).href;
const ANIM = { stat41: 6.2, stat48: 5.2, flowDeposit: 5.5, flowPool: 6.2, flowTech: 8.5, endcard: 6.6 };
(async () => {
  const only = process.argv[2];
  const r = await Recorder.open({ width: 1920, height: 1080, scale: 1 });
  for (const [name, secs] of Object.entries(ANIM)) {
    if (only && only !== name) continue;
    await r.page.goto(`${PAGE}?o=${name}`);
    await r.page.evaluate(() => document.fonts.ready);
    await r.page.waitForTimeout(200);
    r.startClip(name, { alpha: true, dir: OUT });
    await r.seconds(secs);
    await r.endClip();
  }
  if (!only || only === "badge") {
    await r.page.goto(`${PAGE}?o=badge`);
    await r.page.evaluate(() => document.fonts.ready);
    await r.page.screenshot({ path: path.join(OUT, "badge.png"), omitBackground: true });
  }
  await r.close();
})();
