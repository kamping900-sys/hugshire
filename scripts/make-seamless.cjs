/**
 * Makes square textures tileable: cross-fades each image with a copy rolled by half its size,
 * weighting the original towards the centre and the rolled copy towards the edges.
 *   node scripts/make-seamless.cjs file1.png file2.png ...
 */
const sharp = require("sharp");
(async () => {
  for (const f of process.argv.slice(2)) {
    const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, C = info.channels;
    const out = Buffer.alloc(data.length);
    const band = 0.3;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ex = Math.min(x, W - 1 - x) / (W * band), ey = Math.min(y, H - 1 - y) / (H * band);
        const w = Math.min(1, ex) * Math.min(1, ey);
        const sx = (x + W / 2) % W, sy = (y + H / 2) % H;
        for (let c = 0; c < C; c++) out[(y * W + x) * C + c] = Math.round(data[(y * W + x) * C + c] * w + data[(sy * W + sx) * C + c] * (1 - w));
      }
    await sharp(out, { raw: { width: W, height: H, channels: C } }).png().toFile(f + ".tmp.png");
    require("fs").renameSync(f + ".tmp.png", f);
    console.log("seamless:", f);
  }
})();
