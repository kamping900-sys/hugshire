/**
 * Cuts a transparent sprite sheet into separate PNGs.
 *   node scripts/slice-sheet.cjs <sheet.png> <outDir> name1,name2,...  [--rows N]
 * Finds islands of opaque pixels (on a downsampled alpha mask, so a building's chimney smoke or
 * a tree's leaves stay attached), orders them row by row, left to right, and crops each with padding.
 * Prints the boxes so the order can be checked against the names.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function main() {
  const [src, outDir, namesArg, ...rest] = process.argv.slice(2);
  const names = (namesArg || "").split(",").filter(Boolean);
  const rowsArg = rest.indexOf("--rows") >= 0 ? Number(rest[rest.indexOf("--rows") + 1]) : 0;
  const img = sharp(src).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, S = 4; // mask cell = 4×4 px
  const mw = Math.ceil(W / S), mh = Math.ceil(H / S);
  const mask = new Uint8Array(mw * mh);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 24) mask[Math.floor(y / S) * mw + Math.floor(x / S)] = 1;
  // Join nearby parts of one object by dilating the mask; shrink the radius until we find enough objects.
  let boxes = [];
  for (const R of [3, 2, 1, 0]) {
    boxes = islands(R);
    if (!names.length || boxes.length >= names.length) break;
  }
  function islands(R) {
  const dil = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      if (!mask[y * mw + x]) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < mw && ny < mh) dil[ny * mw + nx] = 1;
      }
    }
  const seen = new Uint8Array(mw * mh);
  const found = [];
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      if (!dil[y * mw + x] || seen[y * mw + x]) continue;
      let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
      const st = [[x, y]];
      seen[y * mw + x] = 1;
      while (st.length) {
        const [cx, cy] = st.pop();
        n++;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
          const k = ny * mw + nx;
          if (dil[k] && !seen[k]) { seen[k] = 1; st.push([nx, ny]); }
        }
      }
      if (n > 40) found.push({ x0: x0 * S, y0: y0 * S, x1: Math.min(W, (x1 + 1) * S), y1: Math.min(H, (y1 + 1) * S), n });
    }
  return found;
  }
  // keep the biggest islands if there are more than names
  if (names.length && boxes.length > names.length) boxes = boxes.sort((a, b) => b.n - a.n).slice(0, names.length);
  // row ordering: cluster by vertical centre
  boxes.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows = [];
  for (const b of boxes) {
    const cy = (b.y0 + b.y1) / 2, h = b.y1 - b.y0;
    const row = rows.find((r) => Math.abs(r.cy - cy) < Math.max(r.h, h) * 0.5);
    if (row) { row.items.push(b); row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length; }
    else rows.push({ cy, h, items: [b] });
  }
  if (rowsArg && rows.length !== rowsArg) console.warn(`warning: found ${rows.length} rows, expected ${rowsArg}`);
  const ordered = rows.flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  for (let i = 0; i < ordered.length; i++) {
    const b = ordered[i];
    const pad = 6;
    const left = Math.max(0, b.x0 - pad), top = Math.max(0, b.y0 - pad);
    const width = Math.min(W, b.x1 + pad) - left, height = Math.min(H, b.y1 + pad) - top;
    const name = names[i] || `sprite_${i}`;
    await sharp(src).extract({ left, top, width, height }).png().toFile(path.join(outDir, `${name}.png`));
    out.push({ name, width, height });
  }
  console.log(JSON.stringify({ sheet: `${W}x${H}`, found: ordered.length, sprites: out }));
}
main().catch((e) => { console.error(e); process.exit(1); });
