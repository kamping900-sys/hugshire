/**
 * Prepares the Wood mini-game art and the town hero objects (Heart Tree, fruit, Notice Board).
 *   node scripts/prepare-misc-art.cjs
 * Sources: art/sheets/wood/*.png and art/sheets/town/*.(png|webp)
 * Output:  public/game/sprites/wood/*.png and public/game/sprites/town/*.png
 * Everything is trimmed to its content and pre-shrunk to about 2× its on-screen size.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const out = (d) => {
  const p = path.join(ROOT, "public", "game", "sprites", d);
  fs.mkdirSync(p, { recursive: true });
  return p;
};

async function load(file) {
  const { data, info } = await sharp(file, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}
function bbox(img, x0 = 0, y0 = 0, x1 = img.W, y1 = img.H) {
  let a = x1, b = y1, c = -1, d = -1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (img.data[(y * img.W + x) * 4 + 3] > 16) {
        if (x < a) a = x;
        if (x > c) c = x;
        if (y < b) b = y;
        if (y > d) d = y;
      }
  return { x: a, y: b, w: c - a + 1, h: d - b + 1 };
}
async function save(img, box, file, height) {
  let s = sharp(img.data, { raw: { width: img.W, height: img.H, channels: 4 } }).extract({ left: box.x, top: box.y, width: box.w, height: box.h });
  const buf = await s.png().toBuffer();
  s = sharp(buf);
  if (height && box.h > height) s = s.resize({ height, kernel: "lanczos3" });
  await s.png({ compressionLevel: 9 }).toFile(file);
  console.log(path.relative(ROOT, file));
}

(async () => {
  const W = path.join(ROOT, "art", "sheets", "wood");
  const T = path.join(ROOT, "art", "sheets", "town");
  const wo = out("wood"), to = out("town");
  const has = (f) => fs.existsSync(f);

  // ── Wood mini-game ──
  if (has(path.join(W, "background.png"))) await sharp(path.join(W, "background.png"), { failOn: "none" }).resize({ width: 1536 }).png({ compressionLevel: 9 }).toFile(path.join(wo, "background.png"));
  if (has(path.join(W, "clouds.png"))) {
    const img = await load(path.join(W, "clouds.png"));
    const b = bbox(img);
    await save(img, { x: 0, y: b.y, w: img.W, h: b.h }, path.join(wo, "clouds.png"), 260);
  }
  for (const [k, h] of [["stump", 260], ["log", 260], ["axe", 320]]) {
    const f = path.join(W, `${k}.png`);
    if (!has(f)) continue;
    const img = await load(f);
    await save(img, bbox(img), path.join(wo, `${k}.png`), h);
  }
  if (has(path.join(W, "log_split.png"))) {
    // split at the emptiest column near the middle
    const img = await load(path.join(W, "log_split.png"));
    const all = bbox(img);
    let best = Math.round(img.W / 2), bestN = Infinity;
    for (let x = Math.round(all.x + all.w * 0.3); x < all.x + all.w * 0.7; x++) {
      let n = 0;
      for (let y = 0; y < img.H; y++) if (img.data[(y * img.W + x) * 4 + 3] > 16) n++;
      if (n < bestN) {
        bestN = n;
        best = x;
      }
    }
    await save(img, bbox(img, 0, 0, best, img.H), path.join(wo, "log_left.png"), 260);
    await save(img, bbox(img, best, 0, img.W, img.H), path.join(wo, "log_right.png"), 260);
  }

  // ── town hero objects ──
  const find = (base) => ["png", "webp"].map((e) => path.join(T, `${base}.${e}`)).find(has);
  const tree = find("heart_tree");
  if (tree) {
    const img = await load(tree);
    await save(img, bbox(img), path.join(to, "heart_tree.png"), 640);
  }
  const board = find("notice_board");
  if (board) {
    const img = await load(board);
    await save(img, bbox(img), path.join(to, "notice_board.png"), 480);
  }
  const fruits = find("fruits");
  if (fruits) {
    // 3 × 2 grid: red, red, red / gold, gold, bud
    const img = await load(fruits);
    const names = ["fruit_red_1", "fruit_red_2", "fruit_red_3", "fruit_gold_1", "fruit_gold_2", "fruit_bud"];
    const cw = Math.floor(img.W / 3), ch = Math.floor(img.H / 2);
    for (let i = 0; i < 6; i++) {
      const cx = (i % 3) * cw, cy = Math.floor(i / 3) * ch;
      await save(img, bbox(img, cx, cy, cx + cw, cy + ch), path.join(to, `${names[i]}.png`), 128);
    }
  }
})();
