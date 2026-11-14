/**
 * Scene 3: the real onboarding with a fresh test account, start to landing in town.
 *   node capture/s3_onboard.cjs [email]
 */
const { Recorder } = require("./common.cjs");
const { Director } = require("../lib/director.cjs");

(async () => {
  const email = process.argv[2] || `maple${Date.now().toString(36).slice(-4)}@hugshire.test`;
  const r = await Recorder.open();
  await r.page.goto("/", { waitUntil: "domcontentloaded" });
  await r.pump(2600); // title animation done
  const d = new Director(r, "s3_onboard");
  r.startClip("s3_onboard");
  d.mark("landing");
  await d.hold(1.2);
  await d.click("Start helping");
  d.mark("signin-open");
  await d.hold(1.0);
  await d.type("#signin-email", email, 2);
  await d.hold(0.4);
  await d.click("Get my code");
  d.mark("code-requested");
  await d.until(() => document.body.innerText.toLowerCase().includes("filled in the code"), null, 10);
  d.mark("code-filled");
  await d.hold(1.4);
  await d.click("Let's go");
  d.mark("signed-in");
  await d.until(() => document.body.innerText.toLowerCase().includes("who will help you build"), null, 15);
  d.mark("wizard-step1");
  await d.hold(1.2);
  await d.click("Cat");
  d.mark("picked-cat");
  await d.hold(0.8);
  await r.page.evaluate(() => { const e = document.querySelector("#nick"); if (e) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(e, ""); e.dispatchEvent(new Event("input", { bubbles: true })); } });
  await d.type("#nick", "Maple", 4);
  d.mark("named");
  await d.hold(1.0);
  await d.click("Next: choose a home town");
  await d.until(() => document.body.innerText.toLowerCase().includes("choose your home town"), null, 10);
  d.mark("step2-towns");
  await d.hold(1.4);
  await d.click("Fernhollow");
  d.mark("picked-fernhollow");
  await d.hold(1.6);
  console.log("  selected card:", await r.page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.className.includes("FDE6D4")).map((b) => b.innerText.split(String.fromCharCode(10))[0])));
  await d.click("Next: plant your Heart Tree");
  await d.until(() => document.body.innerText.toLowerCase().includes("plant your heart tree"), null, 10);
  d.mark("step3-amount");
  await d.hold(1.0);
  await d.click("$100");
  d.mark("picked-100");
  await d.hold(0.8);
  await d.click("I understand", "label");
  d.mark("risk-ticked");
  await d.hold(0.8);
  await d.click("Plant $100");
  await d.until(() => document.body.innerText.toLowerCase().includes("pay $"), null, 15);
  d.mark("checkout");
  await d.hold(4.5); // the money route animates
  await d.click("Pay $");
  d.mark("paid");
  await d.until(() => /Ta-da|What's happening|glowing/.test(document.body.innerText), null, 15);
  await d.hold(9.0); // success → glow → evolve → flash → ta-da → fall
  d.mark("to-town");
  await d.until(() => location.pathname.includes("/worldmap/town/") && !!document.querySelector("canvas"), null, 20);
  d.mark("town-loaded");
  await d.hold(8.0); // the drop from the sky and the zoom out
  d.mark("landed");
  await d.hold(4.0);
  await r.endClip();
  d.save();
  console.log("email used:", email);
  await r.close();
})();
