// V2 overlays: short deposit flow, pool split, sample-content badge (plus V1 overlays reused).
const path = require("path");
const { pathToFileURL } = require("url");
const { Recorder } = require("../lib/recorder.cjs");
const OUT = path.join(__dirname, "..", "build", "overlays");
const PAGE = (f, q = "") => pathToFileURL(path.join(__dirname, "..", "overlays", f)).href + q;
(async () => {
  const r = await Recorder.open({ width: 1920, height: 1080, scale: 1 });
  for (const [name, url, secs] of [["flowDeposit2", PAGE("overlay.html", "?o=flowDeposit2"), 3.6], ["poolSplit", PAGE("pool.html"), 4.7]]) {
    await r.page.goto(url); await r.page.evaluate(() => document.fonts.ready); await r.page.waitForTimeout(200);
    r.startClip(name, { alpha: true, dir: OUT }); await r.seconds(secs); await r.endClip();
  }
  await r.page.goto(PAGE("overlay.html", "?o=badgeSample")); await r.page.evaluate(() => document.fonts.ready);
  await r.page.screenshot({ path: path.join(OUT, "badgeSample.png"), omitBackground: true });
  await r.close();
})();
