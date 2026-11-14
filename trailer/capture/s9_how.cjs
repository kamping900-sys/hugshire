// Scene 9: the illustrated How It Works chapters on the landing page.
const { Recorder } = require("./common.cjs");
const { Director } = require("../lib/director.cjs");
(async () => {
  const r = await Recorder.open();
  await r.page.goto("/", { waitUntil: "domcontentloaded" });
  await r.pump(2600);
  const d = new Director(r, "s9_how");
  r.startClip("s9_how");
  await d.hold(0.6);
  await d.click("How it works");
  d.mark("open");
  await d.hold(3.2);
  for (let k = 1; k <= 6; k++) {
    await d.click("Next");
    d.mark("ch" + (k + 1));
    await d.hold(3.0);
  }
  await r.endClip();
  d.save();
  await r.close();
})();
