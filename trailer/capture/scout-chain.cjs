// Screenshot of the Heart Tree "My deposit" tab with the onchain card (dev server in onchain mode on :3400).
process.env.TRAILER_URL = "http://localhost:3400";
const { Recorder } = require("../lib/recorder.cjs");
const { Director } = require("../lib/director.cjs");
(async () => {
  const r = await Recorder.open();
  await r.signIn("sample-fay@hugshire.test");
  await r.goto("/worldmap/town/fernhollow", { settle: 3000 });
  await r.until(() => !document.body.innerText.includes("Walking into town"), null, { max: 60000 });
  await r.pump(1500);
  const d = new Director(r, "scout");
  await d.click("Heart Tree", "nav button, nav a");
  await r.pump(1500);
  await d.click("My deposit");
  for (let i = 0; i < 30 && !(await r.page.evaluate(() => document.body.innerText.includes("Onchain · NEAR testnet"))); i++) await r.pump(500);
  await r.pump(2500);
  await r.page.screenshot({ path: "build/chain-card.png" });
  console.log(await r.page.evaluate(() => (document.body.innerText.match(/Onchain · NEAR testnet[\s\S]{0,500}/) || ["(no card)"])[0]));
  await r.close();
})();
