/**
 * Scene 1 (quiet village, "before") and Scene 2 (walk to the Heart Tree, logo reveal).
 * Needs the DB staged with: node scripts/stage-db.cjs before
 */
const { Recorder, asMaple, hud, camera, ease, townReady } = require("./common.cjs");

async function hold(r, keys, on) {
  for (const k of keys) on ? await r.page.keyboard.down(k) : await r.page.keyboard.up(k);
}

(async () => {
  const only = process.argv[2];

  if (!only || only === "s1") {
    // wide, HUD-free establishing shot of the nearly empty village
    const r = await Recorder.open({ width: 2560, height: 1440, scale: 0.75 });
    await asMaple(r);
    await r.goto("/worldmap/town/fernhollow");
    await townReady(r);
    await hud(r, false);
    await r.pump(800);
    r.startClip("s1_before_wide");
    const N = 27 * 30;
    await r.frames(N, async (i, t) => {
      await camera(r, 1 + 0.1 * ease(t / 27), 0.47, 0.62); // slow push-in
      if (i === Math.round(7 * 30)) await hold(r, ["ArrowLeft"], true);
      if (i === Math.round(7.5 * 30)) await hold(r, ["ArrowLeft"], false);
      if (i === Math.round(9 * 30)) await hold(r, ["ArrowUp"], true);
      if (i === Math.round(9.15 * 30)) await hold(r, ["ArrowUp"], false);
    });
    await r.endClip();
    await r.close();
  }

  if (!only || only === "s2") {
    // Maple trots from the cottage to the Heart Tree; its ring lights up and the fruit shows
    const r = await Recorder.open();
    await asMaple(r);
    await r.goto("/worldmap/town/fernhollow");
    await townReady(r);
    await hud(r, false);
    await r.pump(500);
    r.startClip("s2_walk_to_tree");
    await r.frames(10 * 30, async (i, t) => {
      if (i === 15) await hold(r, ["ArrowUp"], true);
      if (i === 15 + 45) { await hold(r, ["ArrowUp"], false); await hold(r, ["ArrowLeft"], true); }
      if (i === 15 + 45 + 50) { await hold(r, ["ArrowLeft"], false); await hold(r, ["ArrowUp"], true); }
      if (i === 15 + 45 + 50 + 40) await hold(r, ["ArrowUp"], false);
    });
    await r.endClip();
    await r.close();
  }

  if (only === "s10") {
    // the same wide angle as the opening, now that every plot is finished; the camera eases back out
    const r = await Recorder.open({ width: 2560, height: 1440, scale: 0.75 });
    await asMaple(r);
    await r.goto("/worldmap/town/fernhollow");
    await townReady(r);
    await hud(r, false);
    await r.pump(800);
    r.startClip("s10_after_wide");
    await r.frames(14 * 30, async (i, t) => {
      await camera(r, 1.1 - 0.1 * ease(t / 14), 0.47, 0.62);
    });
    await r.endClip();
    await r.close();
  }

  if (!only || only === "logo") {
    // the real landing title animation (letters drop in) as the logo reveal
    const r = await Recorder.open();
    await r.page.goto("/", { waitUntil: "domcontentloaded" });
    r.startClip("s2_landing_logo");
    await r.seconds(6);
    await r.endClip();
    await r.close();
  }
})();
