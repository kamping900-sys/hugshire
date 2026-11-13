/**
 * Prepares the side-scrolling road art for the drop-in slots in public/game/sprites/road/.
 *   node scripts/prepare-road-art.cjs <srcDir>
 * - parallax strips: trims empty transparent rows, then makes the left/right edges tile seamlessly
 *   (the last band of columns is cross-faded into the first, then cut off)
 * - van and gate: trimmed to their bounding box
 * Tolerates slightly malformed PNGs from image generators (failOn: none).
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const STRIPS = ["sky", "clouds", "mountains", "hills", "treeline", "road", "foreground"];
const OBJECTS = ["van", "gate"];
const OUT = path.join(__dirname, "..", "public", "game", "sprites", "road");

async function load(file) {
  const { data, info } = await sharp(file, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}
const TARGET_H = { sky: 1024, clouds: 560, mountains: 680, hills: 560, treeline: 500, road: 520, foreground: 220, van: 300, gate: 560 };
const save = (data, W, H, file) => {
  const k = path.basename(file, ".png");
  const th = TARGET_H[k] ?? H;
  const img = sharp(data, { raw: { width: W, height: H, channels: 4 } });
  return (th < H ? img.resize({ height: th, kernel: "lanczos3" }) : img).png({ compressionLevel: 9 }).toFile(file);
};

function bbox({ data, W, H }, rowsOnly) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (rowsOnly) return { x0: 0, y0, x1: W - 1, y1 };
  return { x0, y0, x1, y1 };
}
function crop(img, b) {
  const W = b.x1 - b.x0 + 1, H = b.y1 - b.y0 + 1;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) img.data.copy(out, y * W * 4, ((b.y0 + y) * img.W + b.x0) * 4, ((b.y0 + y) * img.W + b.x1 + 1) * 4);
  return { data: out, W, H };
}
function seamless(img, band) {
  const { data, W, H } = img;
  const NW = W - band;
  const out = Buffer.alloc(NW * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < NW; x++) {
      const o = (y * NW + x) * 4;
      const a = (y * W + x) * 4;
      if (x >= band) {
        data.copy(out, o, a, a + 4);
        continue;
      }
      // blend the start of the image with the cut-off tail, so out[NW-1] → out[0] is continuous
      const t = x / band;
      const b = (y * W + NW + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(data[a + c] * t + data[b + c] * (1 - t));
    }
  return { data: out, W: NW, H };
}

/** Image followed by its mirror: both joins match pixel-for-pixel, with no blending (no ghosts). */
function mirrorTile(img) {
  const { data, W, H } = img;
  const out = Buffer.alloc(W * 2 * H * 4);
  for (let y = 0; y < H; y++) {
    data.copy(out, y * W * 2 * 4, y * W * 4, (y + 1) * W * 4);
    for (let x = 0; x < W; x++) data.copy(out, (y * W * 2 + W + x) * 4, (y * W + W - 1 - x) * 4, (y * W + W - x) * 4);
  }
  return { data: out, W: W * 2, H };
}

function padTop(img, n) {
  const out = Buffer.alloc(img.W * (img.H + n) * 4);
  img.data.copy(out, img.W * n * 4);
  return { data: out, W: img.W, H: img.H + n };
}

/** For see-through strips: cut at the column (in the last 35%) whose alpha profile best matches column 0. No blending, so no ghosts. */
function cleanCut(img) {
  const { data, W, H } = img;
  let best = W, bestD = Infinity;
  for (let x = Math.round(W * 0.65); x < W; x++) {
    let d = 0;
    for (let y = 0; y < H; y += 2) d += Math.abs(data[(y * W + x) * 4 + 3] - data[(y * W) * 4 + 3]);
    if (d < bestD) { bestD = d; best = x; }
  }
  return crop(img, { x0: 0, y0: 0, x1: best - 1, y1: H - 1 });
}

(async () => {
  const src = process.argv[2];
  fs.mkdirSync(OUT, { recursive: true });
  for (const k of STRIPS) {
    const f = path.join(src, `${k}.png`);
    if (!fs.existsSync(f)) continue;
    let img = await load(f);
    if (k !== "sky" && k !== "road") img = crop(img, bbox(img, true));
    // road: uniform stripes, a soft cross-fade is invisible. Busy layers: mirror tiling (blending them leaves ghosts).
    img = k === "road" ? seamless(img, Math.round(img.W * 0.14)) : k === "sky" ? img : mirrorTile(img);
    if (k !== "sky" && k !== "road") img = padTop(img, 6); // stops the tiling sampler bleeding the bottom row in at the top edge
    await save(img.data, img.W, img.H, path.join(OUT, `${k}.png`));
    console.log(`${k}: ${img.W}×${img.H}`);
  }
  for (const k of OBJECTS) {
    const f = path.join(src, `${k}.png`);
    if (!fs.existsSync(f)) continue;
    let img = await load(f);
    // the generated van has a chopped parcel on its roof: drop everything above the roof rack (the game draws clean parcels)
    if (k === "van") for (let i = 0; i < Math.round(img.H * 0.25) * img.W; i++) img.data[i * 4 + 3] = 0;
    img = crop(img, bbox(img, false));
    await save(img.data, img.W, img.H, path.join(OUT, `${k}.png`));
    console.log(`${k}: ${img.W}×${img.H}`);
  }
})();
