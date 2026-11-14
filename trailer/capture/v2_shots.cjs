/**
 * New shots for trailer V2 (the "after" stage: node scripts/stage-db.cjs after).
 *   node capture/v2_shots.cjs home life lifeWide tree board
 */
const { Recorder, asMaple, hud, camera, ease, townReady } = require("./common.cjs");
const { Director } = require("../lib/director.cjs");

const hasText = (t) => document.body.textContent.toLowerCase().includes(t.toLowerCase());
async function walkUntil(r, key, text, max = 4) {
  await r.page.keyboard.down(key);
  let found = false;
  for (let i = 0; i < max * 30 && !found; i++) { await r.frames(1); if (text) found = await r.page.evaluate(hasText, text); }
  await r.page.keyboard.up(key);
  return found;
}
async function walkFor(r, key, seconds) { await r.page.keyboard.down(key); await r.seconds(seconds); await r.page.keyboard.up(key); }
async function press(r, key) { await r.page.keyboard.down(key); await r.frames(2); await r.page.keyboard.up(key); }
async function inTown(slug, opts) {
  const r = await Recorder.open(opts);
  await asMaple(r);
  await r.goto(`/worldmap/town/${slug}`);
  await townReady(r);
  return r;
}

const shots = {
  // the homepage, from first paint: the title drops in, the village road scrolls, a slow push-in
  async home() {
    const r = await Recorder.open();
    await r.page.goto("/", { waitUntil: "domcontentloaded" });
    r.startClip("v2_home");
    await r.frames(Math.round(12 * 30), async (i, t) => { await camera(r, 1 + 0.07 * ease(t / 12), 0.5, 0.4); });
    await r.endClip();
    await r.close();
  },

  // the finished village, close: Maple strolls past the new buildings and the other animals
  async life() {
    const r = await inTown("fernhollow");
    await hud(r, false);
    await r.pump(400);
    r.startClip("v2_life");
    await r.seconds(0.4);
    await walkFor(r, "ArrowUp", 1.5);
    await walkFor(r, "ArrowRight", 2.2);
    await walkFor(r, "ArrowUp", 1.0);
    await r.seconds(1.4);
    await r.endClip();
    await r.close();
  },

  // a wider look at the busy town (bigger viewport), Maple heading across the plaza
  async lifeWide() {
    const r = await inTown("fernhollow", { width: 1920, height: 1080, scale: 1 });
    await hud(r, false);
    await r.pump(400);
    r.startClip("v2_life_wide");
    await r.frames(7 * 30, async (i, t) => {
      await camera(r, 1.04 - 0.04 * ease(t / 7), 0.5, 0.5);
      if (i === 15) await r.page.keyboard.down("ArrowUp");
      if (i === 15 + 50) { await r.page.keyboard.up("ArrowUp"); await r.page.keyboard.down("ArrowLeft"); }
      if (i === 15 + 50 + 55) await r.page.keyboard.up("ArrowLeft");
    });
    await r.endClip();
    await r.close();
  },

  // the Heart Tree with fruit, Maple beside it, HUD hidden
  async tree() {
    const r = await inTown("fernhollow");
    await hud(r, false);
    await r.pump(300);
    // get to the tree before recording
    await r.page.keyboard.down("ArrowUp"); await r.pump(1400); await r.page.keyboard.up("ArrowUp");
    await r.page.keyboard.down("ArrowLeft");
    for (let i = 0; i < 60 && !(await r.page.evaluate(hasText, "Visit your Heart Tree")); i++) await r.pump(50, 50);
    await r.page.keyboard.up("ArrowLeft");
    await r.pump(600);
    r.startClip("v2_tree");
    await r.frames(5 * 30, async (i, t) => { await camera(r, 1 + 0.06 * ease(t / 5), 0.42, 0.5); });
    await r.endClip();
    await r.close();
  },

  // through the busy town to the Notice Board, read the posts, then back out to the town
  async board() {
    const r = await inTown("fernhollow");
    const d = new Director(r, "v2_board");
    r.startClip("v2_board");
    await d.hold(0.5);
    await walkFor(r, "ArrowUp", 1.4);
    await walkUntil(r, "ArrowLeft", "Visit your Heart Tree", 3);
    await walkFor(r, "ArrowUp", 0.45);
    let ok = await walkUntil(r, "ArrowRight", "Read the Notice Board", 4);
    if (!ok) ok = await walkUntil(r, "ArrowUp", "Read the Notice Board", 1.5);
    d.mark("at-board");
    await d.hold(0.6);
    await press(r, "e");
    d.mark("board-open");
    await d.hold(2.6);
    for (let i = 0; i < 135; i++) {
      await r.page.evaluate(() => { const sc = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); const s = sc[sc.length - 1]; if (s) s.scrollTop += 4; });
      await r.frames(1);
    }
    d.mark("scrolled");
    await d.hold(1.2);
    await r.page.keyboard.press("Escape");
    d.mark("closed");
    await d.hold(0.6);
    await walkFor(r, "ArrowDown", 1.2);
    await d.hold(1.5);
    await r.endClip();
    d.save();
    await r.close();
  },
};

(async () => {
  for (const name of process.argv.slice(2)) { console.log("== shot", name); await shots[name](); }
})();
