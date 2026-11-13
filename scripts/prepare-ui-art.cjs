/**
 * Prepares the game HUD art: the hanging title board and the three bottom-menu icons.
 *   node scripts/prepare-ui-art.cjs
 * Sources: art/sheets/ui/*.webp  →  public/game/sprites/ui/*.png
 * The white surround is flood-filled to transparent from the edges (inner whites stay), then
 * everything is trimmed and shrunk to about 2× its on-screen size.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "art", "sheets", "ui");
const OUT = path.join(ROOT, "public", "game", "sprites", "ui");
fs.mkdirSync(OUT, { recursive: true });

async function cutout(name, w, h, src = SRC, out = OUT) {
  const { data, info } = await sharp(path.join(src, `${name}.webp`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const near = (i) => data[i] > 232 && data[i + 1] > 232 && data[i + 2] > 226;
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    if (!near(p * 4)) continue;
    data[p * 4 + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
  // soften the light halo left next to cleared pixels
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (!data[i + 3]) continue;
    const x = p % W;
    const nb = [p - 1, p + 1, p - W, p + W].some((q) => q >= 0 && q < W * H && Math.abs((q % W) - x) <= 1 && data[q * 4 + 3] === 0);
    if (nb && data[i] > 205 && data[i + 1] > 200 && data[i + 2] > 190) data[i + 3] = 80;
  }
  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .trim({ threshold: 1 })
    .resize(w, h, { fit: "inside" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, `${name}.png`));
}

(async () => {
  await cutout("town_board", 1000, 400);
  for (const n of ["menu_map", "menu_tree", "menu_helper"]) await cutout(n, 220, 220);
  // the town bridge (art/sheets/town/bridge.webp → public/game/sprites/town/bridge.png)
  await cutout("bridge", 600, 400, path.join(ROOT, "art", "sheets", "town"), path.join(ROOT, "public", "game", "sprites", "town"));
  for (const f of fs.readdirSync(OUT)) {
    const m = await sharp(path.join(OUT, f)).metadata();
    console.log(f, `${m.width}x${m.height}`, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + "KB");
  }
})();
