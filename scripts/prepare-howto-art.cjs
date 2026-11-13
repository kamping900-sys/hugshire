/**
 * Prepares the "How it works" illustrations.
 *   node scripts/prepare-howto-art.cjs
 * Sources: art/sheets/howto/*.webp  →  public/game/sprites/howto/*.png
 * Icons: the white surround is flood-filled to transparent from the edges (inner whites stay),
 * then trimmed and shrunk. The background is just resized.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "art", "sheets", "howto");
const OUT = path.join(ROOT, "public", "game", "sprites", "howto");
fs.mkdirSync(OUT, { recursive: true });

async function icon(name, size = 360) {
  const { data, info } = await sharp(path.join(SRC, `${name}.webp`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const near = (i) => data[i] > 232 && data[i + 1] > 232 && data[i + 2] > 228;
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
  // soften the halo: pixels next to cleared ones that are still very light become semi-transparent
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (!data[i + 3]) continue;
    const x = p % W, y = (p / W) | 0;
    const nb = [p - 1, p + 1, p - W, p + W].some((q) => q >= 0 && q < W * H && Math.abs((q % W) - x) <= 1 && data[q * 4 + 3] === 0);
    if (nb && data[i] > 210 && data[i + 1] > 210 && data[i + 2] > 200) data[i + 3] = 90;
  }
  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .trim({ threshold: 1 })
    .resize(size, size, { fit: "inside" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `${name}.png`));
}

(async () => {
  for (const n of ["money", "bank", "ad", "heart_pool"]) await icon(n);
  await sharp(path.join(SRC, "background.webp")).resize(1200).png({ compressionLevel: 9 }).toFile(path.join(OUT, "background.png"));
  for (const f of fs.readdirSync(OUT)) {
    const m = await sharp(path.join(OUT, f)).metadata();
    console.log(f, m.width + "x" + m.height, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + "KB");
  }
})();
