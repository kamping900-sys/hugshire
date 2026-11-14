/**
 * Scenes 5 and 7: help finish the cottage in the Wood mini-game (real, server-judged chops), the results,
 * the optional simulated ad and the Community Pool demo, then back to town to see it finished.
 * Needs: node scripts/stage-db.cjs nearly
 */
const { Recorder, asMaple, townReady } = require("./common.cjs");
const { Director } = require("../lib/director.cjs");
const { readBar, resetBar } = require("../lib/bar.cjs");

const hasText = (t) => document.body.textContent.toLowerCase().includes(t.toLowerCase());

(async () => {
  const r = await Recorder.open();
  await asMaple(r);
  await r.goto("/worldmap/town/fernhollow");
  await townReady(r);
  const d = new Director(r, "s5_build");
  r.startClip("s5_build");
  await d.hold(1.0);
  if (!(await r.page.evaluate(hasText, "Help build here"))) console.log("  (not next to the cottage)");
  await r.page.keyboard.press("e");
  d.mark("plot-panel");
  await d.until(() => document.body.textContent.includes("Chop Wood"), null, 6);
  await d.hold(2.6);
  await d.click("Chop Wood");
  d.mark("guide");
  await d.until(() => document.body.textContent.includes("Start chopping"), null, 8);
  await d.hold(2.4);
  await d.click("Start chopping");
  d.mark("play");
  resetBar();
  let lastPress = -99, presses = 0, frame = 0;
  for (; frame < 45 * 30; frame++) {
    if (frame % 15 === 0 && (await r.page.evaluate(hasText, "Back to town"))) break;
    if (r.lastFrame && frame - lastPress > 14) {
      const b = await readBar(r.lastFrame).catch(() => null);
      if (b && b.marker != null && b.green) {
        const [g0, g1] = b.green, mid = (g0 + g1) / 2, half = (g1 - g0) / 2;
        if (Math.abs(b.marker - mid) < half * 0.55) {
          await r.page.keyboard.press("Space");
          lastPress = frame;
          presses++;
          d.mark(`chop${presses}`);
        }
      }
    }
    await r.frames(1);
  }
  d.mark("results");
  await d.hold(3.5);
  await d.click("Watch an ad");
  d.mark("ad");
  await d.until(() => !document.body.textContent.includes("Simulating ads"), null, 8);
  d.mark("pool-demo");
  await d.hold(9.0);
  d.mark("pool-demo-end");
  // close the pool demo, then back to town
  await d.inject();
  const closed = await r.page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].filter((x) => /got it|nice|close|lovely|continue|done/i.test(x.innerText || x.getAttribute("aria-label") || ""));
    b[b.length - 1]?.click();
    return b.map((x) => x.innerText || x.getAttribute("aria-label")).slice(-3);
  });
  console.log("  pool demo buttons:", JSON.stringify(closed));
  await d.hold(1.5);
  await d.click("Back to town");
  d.mark("back-to-town");
  await d.hold(5.0);
  await r.endClip();
  d.save();
  console.log("chops:", presses);
  await r.close();
})();
