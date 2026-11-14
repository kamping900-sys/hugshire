/**
 * Town shots with the protagonist (Fay's helper, the cat Maple, home town Fernhollow).
 *   node capture/town_shots.cjs <shot>    shots: s2walk s3tree s4map s6board s8withdraw
 * Needs the "before" stage (node scripts/stage-db.cjs before).
 */
const { Recorder, asMaple, hud, camera, ease, townReady } = require("./common.cjs");
const { Director } = require("../lib/director.cjs");

const hasText = (t) => document.body.textContent.toLowerCase().includes(t.toLowerCase());

/** Holds a key while recording until the page shows some text (or max seconds). */
async function walkUntil(r, key, text, max = 4) {
  await r.page.keyboard.down(key);
  let found = false;
  for (let i = 0; i < max * 30 && !found; i++) {
    await r.frames(1);
    if (text) found = await r.page.evaluate(hasText, text);
  }
  await r.page.keyboard.up(key);
  return found;
}
async function walkFor(r, key, seconds) {
  await r.page.keyboard.down(key);
  await r.seconds(seconds);
  await r.page.keyboard.up(key);
}
async function press(r, key) {
  await r.page.keyboard.down(key);
  await r.frames(2);
  await r.page.keyboard.up(key);
}

async function inTown(slug, opts) {
  const r = await Recorder.open(opts);
  await asMaple(r);
  await r.goto(`/worldmap/town/${slug}`);
  await townReady(r);
  return r;
}

const shots = {
  // Scene 2: Maple trots to the Heart Tree; its ring lights up, red fruit on the branches
  async s2walk() {
    const r = await inTown("fernhollow");
    await hud(r, false);
    await r.pump(400);
    r.startClip("s2_walk_to_tree");
    await r.seconds(0.6);
    await walkFor(r, "ArrowUp", 1.4);
    await walkUntil(r, "ArrowLeft", "Visit your Heart Tree", 3);
    await walkFor(r, "ArrowLeft", 0.25);
    await r.seconds(4.5);
    await r.endClip();
    await r.close();
  },

  // Scene 3: open the Heart Tree, pick two fruits, send the parcel, switch auto-send on
  async s3tree() {
    const r = await inTown("fernhollow");
    const d = new Director(r, "s3_tree");
    r.startClip("s3_tree");
    await d.hold(0.8);
    await d.click("Heart Tree", "nav button, nav a");
    d.mark("tree-open");
    await d.until(() => !!document.querySelector('button[title^="Pick $"]'), null, 8);
    await d.hold(2.2);
    for (let k = 0; k < 2; k++) {
      await r.page.evaluate(() => { const b = [...document.querySelectorAll('button[title^="Pick $"]')].filter((x) => !x.disabled); b[b.length - 1]?.click(); });
      d.mark("pick" + k);
      await d.hold(1.0);
    }
    await d.hold(1.2);
    d.mark("parcel");
    await d.click("Send to");
    d.mark("sent");
    await d.hold(3.0);
    await d.click("Auto-send my interest daily");
    d.mark("auto");
    await d.hold(2.5);
    await r.endClip();
    d.save();
    await r.close();
  },

  // Scene 4: from Fernhollow to the world map, drive along the road, into the next town
  async s4map() {
    const r = await inTown("fernhollow");
    const d = new Director(r, "s4_map");
    r.startClip("s4_map");
    await d.hold(1.0);
    await d.click("World map", "nav button, nav a");
    d.mark("to-map");
    await d.until(() => location.pathname === "/worldmap" && !!document.querySelector("canvas"), null, 15);
    await d.hold(2.0);
    d.mark("map");
    // drive west in gentle slow motion past Inkwell Hollow, then let the strip bring the van to Pawsbury's gate
    r.timeScale = 0.5;
    await r.page.keyboard.down("ArrowLeft");
    d.mark("drive");
    await d.hold(4.4);
    await r.page.keyboard.up("ArrowLeft");
    await d.click("Pawsbury");
    await d.hold(3.0);
    r.timeScale = 1;
    await d.hold(1.2);
    d.mark("stopped");
    await press(r, "ArrowUp");
    d.mark("enter");
    await d.until(() => location.pathname.includes("/worldmap/town/") && !!document.querySelector("canvas"), null, 15);
    d.mark("town2");
    await d.hold(6.0);
    await r.endClip();
    d.save();
    await r.close();
  },

  // Scene 6: walk to the Notice Board and read the organisation's posts
  async s6board() {
    const r = await inTown("fernhollow");
    const d = new Director(r, "s6_board");
    r.startClip("s6_board");
    await d.hold(0.6);
    // via the Heart Tree (a reliable landmark), then along the top of the plaza to the board
    await walkFor(r, "ArrowUp", 1.4);
    await walkUntil(r, "ArrowLeft", "Visit your Heart Tree", 3);
    await walkFor(r, "ArrowUp", 0.45);
    let ok = await walkUntil(r, "ArrowRight", "Read the Notice Board", 4);
    if (!ok) ok = await walkUntil(r, "ArrowUp", "Read the Notice Board", 1.5);
    if (!ok) ok = await walkUntil(r, "ArrowDown", "Read the Notice Board", 1.5);
    console.log("  at board:", ok);
    d.mark("at-board");
    await d.hold(1.0);
    await press(r, "e");
    d.mark("board-open");
    await d.hold(3.5);
    // slow scroll through the posts
    for (let i = 0; i < 150; i++) {
      await r.page.evaluate(() => { const sc = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); const s = sc[sc.length - 1]; if (s) s.scrollTop += 4; });
      await r.frames(1);
    }
    d.mark("scrolled");
    await d.hold(2.0);
    await r.endClip();
    d.save();
    await r.close();
  },

  // Scene 7: the golden fruit from the ad, on the Heart Tree's Community gift tab (auto delivery by default)
  async s7gift() {
    const r = await inTown("fernhollow");
    const d = new Director(r, "s7_gift");
    r.startClip("s7_gift");
    await d.hold(0.6);
    await d.click("Heart Tree", "nav button, nav a");
    await d.until(() => document.body.innerText.includes("My deposit"), null, 8);
    await d.hold(1.6);
    await d.click("Community gift");
    d.mark("gift-tab");
    await d.hold(3.5);
    await d.click("Pick a town");
    d.mark("pick");
    await d.hold(3.0);
    await d.click("Auto delivery");
    d.mark("auto");
    await d.hold(2.5);
    await r.endClip();
    d.save();
    await r.close();
  },

  // Scene 8: Heart Tree → My deposit → Withdraw: options, the route back, then "on its way"
  async s8withdraw() {
    const r = await inTown("fernhollow");
    const d = new Director(r, "s8_withdraw");
    r.startClip("s8_withdraw");
    await d.hold(0.6);
    await d.click("Heart Tree", "nav button, nav a");
    await d.until(() => !!document.querySelector('button[title^="Pick $"]') || document.body.innerText.includes("My deposit"), null, 8);
    await d.hold(1.2);
    await d.click("My deposit");
    d.mark("deposit-tab");
    await d.hold(3.0);
    await d.click("Withdraw");
    d.mark("withdraw-modal");
    await d.hold(2.0);
    await d.click("25%");
    d.mark("25");
    await d.hold(3.5);
    await d.click("Withdraw $");
    d.mark("submitted");
    await d.hold(5.5);
    await r.endClip();
    d.save();
    await r.close();
  },
};

(async () => {
  for (const name of process.argv.slice(2)) {
    console.log("== shot", name);
    await shots[name]();
  }
})();
