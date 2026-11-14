/** Shared shot helpers for the capture scripts. */
const { Recorder } = require("../lib/recorder.cjs");

const FAY = "sample-fay@hugshire.test"; // sample supporter: $325 deposit, home town Fernhollow, real test-mode yield

/** Signs in as the protagonist and makes her active helper the orange cat "Maple". */
async function asMaple(r) {
  await r.signIn(FAY);
  const j = await r.api("GET", "/api/journey");
  const h = j.helpers.find((x) => x.town?.slug === "fernhollow") ?? j.helpers[0];
  await r.api("POST", "/api/journey", { action: "renameHelper", helperId: h.id, animal: "cat", nickname: "Maple" });
  await r.api("POST", "/api/journey", { action: "activeHelper", helperId: h.id });
  return h.id;
}

/** Hides the HUD for clean establishing shots (presentation only; the game is unchanged). */
async function hud(r, show) {
  await r.page.evaluate((show) => {
    let st = document.getElementById("__trailer_hud");
    if (!st) { st = document.createElement("style"); st.id = "__trailer_hud"; document.head.appendChild(st); }
    st.textContent = show ? "" : `body * { visibility: hidden !important; } canvas, canvas * { visibility: visible !important; }`;
  }, show);
}

/** A camera move on top of the page: scale around a point (0..1 of the screen). */
async function camera(r, scale, ox = 0.5, oy = 0.5) {
  await r.page.evaluate(([s, x, y]) => {
    const b = document.body;
    b.style.transformOrigin = `${x * 100}% ${y * 100}%`;
    b.style.transform = s === 1 ? "" : `scale(${s})`;
  }, [scale, ox, oy]);
}

const ease = (u) => (1 - Math.cos(Math.min(1, Math.max(0, u)) * Math.PI)) / 2;

/** Waits for the town canvas and its first painted frames. */
async function townReady(r) {
  await r.until(() => !!document.querySelector("canvas") && !document.body.innerText.includes("Walking into town"), null, { max: 30000 });
  await r.pump(1500);
}

module.exports = { Recorder, FAY, asMaple, hud, camera, ease, townReady };
