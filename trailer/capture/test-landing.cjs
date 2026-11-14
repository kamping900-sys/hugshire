// Speed and quality check: 4 seconds of the landing page.
const { Recorder } = require("../lib/recorder.cjs");
(async () => {
  const r = await Recorder.open();
  await r.goto("/", { settle: 200 });
  r.startClip("test-landing");
  await r.seconds(4);
  await r.endClip();
  await r.close();
})();
