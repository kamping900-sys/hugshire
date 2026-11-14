const { Recorder } = require("../lib/recorder.cjs");
(async () => {
  const r = await Recorder.open();
  await r.page.goto("/", { waitUntil: "domcontentloaded" });
  const info = await r.page.evaluate(() => document.getAnimations().slice(0,5).map(a => ({ name: a.animationName, ct: a.currentTime, state: a.playState })));
  console.log("at load:", JSON.stringify(info), "perf", await r.page.evaluate(() => performance.now()));
  r.startClip("test-anim");
  await r.seconds(2.5);
  await r.endClip();
  await r.close();
})();
