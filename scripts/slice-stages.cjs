/**
 * Cuts 2×2 construction-stage sheets into four aligned sprites.
 *   node scripts/slice-stages.cjs <srcDir>          (files named <blueprintKey>.png|webp)
 * Output: public/game/sprites/stages/<key>_1.png … _4.png
 * - an opaque flat background (e.g. black or white) is removed by flood fill from the edges
 * - every stage is cropped with the SAME box (the union of the four panels' content), so the
 *   building keeps its footprint and baseline as it grows (anchor: bottom centre)
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "public", "game", "sprites", "stages");

function removeFlatBackground(data, W, H) {
  const i0 = 0;
  if (data[i0 + 3] < 250) return 0; // already transparent
  const bg = [data[0], data[1], data[2]];
  const near = (i) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 60;
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  let n = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    if (!near(p * 4)) continue;
    data[p * 4 + 3] = 0;
    n++;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
  // a near-black background also hides inside closed shapes (timber frames): clear it everywhere
  if (bg[0] + bg[1] + bg[2] < 30)
    for (let p = 0; p < W * H; p++) if (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2] < 36 && data[p * 4 + 3]) {
      data[p * 4 + 3] = 0;
      n++;
    }
  // soften the halo left by anti-aliasing against the old background
  for (let p = 0; p < W * H; p++) {
    if (data[p * 4 + 3] === 0) continue;
    const x = p % W, y = (p / W) | 0;
    let edge = false;
    for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < W * H && data[q * 4 + 3] === 0 && Math.abs((q % W) - x) <= 1 && Math.abs(((q / W) | 0) - y) <= 1) edge = true;
    if (edge && near(p * 4)) data[p * 4 + 3] = 90;
  }
  return n;
}

(async () => {
  const src = process.argv[2];
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const key = f.replace(/\.(png|webp)$/i, "");
    if (key === f) continue;
    const { data, info } = await sharp(path.join(src, f), { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const removed = removeFlatBackground(data, W, H);
    const hw = W >> 1, hh = H >> 1;
    const panels = [
      [0, 0],
      [hw, 0],
      [0, hh],
      [hw, hh],
    ];
    // union of content boxes in panel-local coordinates
    let x0 = hw, y0 = hh, x1 = -1, y1 = -1;
    for (const [px, py] of panels)
      for (let y = 0; y < hh; y++)
        for (let x = 0; x < hw; x++)
          if (data[((py + y) * W + px + x) * 4 + 3] > 20) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
    const pad = 4;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(hw - 1, x1 + pad);
    y1 = Math.min(hh - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    for (let k = 0; k < 4; k++) {
      const [px, py] = panels[k];
      const out = Buffer.alloc(cw * ch * 4);
      for (let y = 0; y < ch; y++) data.copy(out, y * cw * 4, ((py + y0 + y) * W + px + x0) * 4, ((py + y0 + y) * W + px + x1 + 1) * 4);
      await sharp(out, { raw: { width: cw, height: ch, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${key}_${k + 1}.png`));
    }
    console.log(`${key}: 4 stages ${cw}×${ch}${removed ? ` (removed ${removed} background px)` : ""}`);
  }
})();
