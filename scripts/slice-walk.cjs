/**
 * Cuts a 4×3 walk-cycle sheet (rows: front, side, back) into aligned animation frames.
 *   node scripts/slice-walk.cjs <sheet.png> <outDir> <name>
 * Writes <name>_<front|side|back>_<0..3>.png. Within a row every frame has the same canvas size,
 * the feet sit on the bottom edge, and the head is centred horizontally — so frames don't jitter.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function main() {
  const [src, outDir, name] = process.argv.slice(2);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const A = (x, y) => data[(y * W + x) * 4 + 3];

  // islands on a 4-px mask, shrinking the join radius until 12 figures are found
  const S = 4, mw = Math.ceil(W / S), mh = Math.ceil(H / S);
  const mask = new Uint8Array(mw * mh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A(x, y) > 40) mask[((y / S) | 0) * mw + ((x / S) | 0)] = 1;
  const islands = (R) => {
    const dil = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (mask[y * mw + x])
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < mw && ny < mh) dil[ny * mw + nx] = 1;
      }
    const seen = new Uint8Array(mw * mh), out = [];
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      if (!dil[y * mw + x] || seen[y * mw + x]) continue;
      let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
      const st = [[x, y]];
      seen[y * mw + x] = 1;
      while (st.length) {
        const [cx, cy] = st.pop();
        n++;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
          const k = ny * mw + nx;
          if (dil[k] && !seen[k]) { seen[k] = 1; st.push([nx, ny]); }
        }
      }
      if (n > 60) out.push({ x0: x0 * S, y0: y0 * S, x1: Math.min(W, (x1 + 1) * S), y1: Math.min(H, (y1 + 1) * S), n });
    }
    return out;
  };
  let boxes = [];
  for (const R of [3, 2, 1, 0]) { boxes = islands(R); if (boxes.length >= 12) break; }
  if (boxes.length < 12) throw new Error(`found ${boxes.length} figures, expected 12`);
  boxes = boxes.sort((a, b) => b.n - a.n).slice(0, 12);

  // tight pixel bbox + head centre (mean x of opaque pixels in the top 40%)
  for (const b of boxes) {
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (A(x, y) > 40) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    Object.assign(b, { x0, x1: x1 + 1, y0, y1: y1 + 1 });
    let sx = 0, n = 0;
    const yh = y0 + (y1 - y0) * 0.4;
    for (let y = y0; y < yh; y++) for (let x = x0; x <= x1; x++) if (A(x, y) > 40) { sx += x; n++; }
    b.hx = n ? sx / n : (x0 + x1) / 2;
  }

  // rows by vertical centre, then left→right
  boxes.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows = [boxes.slice(0, 4), boxes.slice(4, 8), boxes.slice(8, 12)].map((r) => r.sort((a, b) => a.x0 - b.x0));
  const poses = ["front", "side", "back"];
  fs.mkdirSync(outDir, { recursive: true });
  const report = {};
  for (let r = 0; r < 3; r++) {
    const row = rows[r];
    const half = Math.ceil(Math.max(...row.map((b) => Math.max(b.hx - b.x0, b.x1 - b.hx)))) + 4;
    const h = Math.max(...row.map((b) => b.y1 - b.y0)) + 4;
    const cw = half * 2;
    for (let i = 0; i < 4; i++) {
      const b = row[i];
      const piece = await sharp(src).extract({ left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }).png().toBuffer();
      const left = Math.round(half - (b.hx - b.x0)), top = h - 2 - (b.y1 - b.y0);
      await sharp({ create: { width: cw, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, top) }])
        .png()
        .toFile(path.join(outDir, `${name}_${poses[r]}_${i}.png`));
    }
    report[poses[r]] = `${cw}x${h}`;
  }
  console.log(JSON.stringify({ name, sheet: `${W}x${H}`, frames: report }));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
