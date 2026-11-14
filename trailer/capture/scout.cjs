// Single frames for scouting shots: node capture/scout.cjs <url> <name> [hideHud]
const { Recorder, asMaple, hud, townReady } = require("./common.cjs");
(async () => {
  const r = await Recorder.open();
  await asMaple(r);
  await r.goto(process.argv[2]);
  await townReady(r);
  if (process.argv[4]) await hud(r, false);
  await r.pump(500);
  await r.page.screenshot({ path: `build/scout-${process.argv[3]}.png` });
  console.log("pos", JSON.stringify(await r.page.evaluate(() => document.body.innerText.slice(0, 300))));
  await r.close();
})();
