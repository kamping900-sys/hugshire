/** node scripts/montage.cjs <dir> <out.png> — grid preview of sprites in file order (for checking names). */
const sharp = require("sharp"); const fs = require("fs"); const path = require("path");
(async () => {
  const [dir, out] = process.argv.slice(2);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const cell = 160, cols = 6, rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(files.map(async (f) => {
    const img = await sharp(path.join(dir, f)).resize(cell - 10, cell - 26, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const label = Buffer.from(`<svg width="${cell}" height="22"><text x="4" y="16" font-family="Arial" font-size="14" fill="#333">${f.replace(".png", "")}</text></svg>`);
    return { img, label };
  }));
  const comp = [];
  tiles.forEach((t, i) => { const x = (i % cols) * cell, y = Math.floor(i / cols) * cell; comp.push({ input: t.img, left: x + 5, top: y + 22 }, { input: t.label, left: x, top: y }); });
  await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: "#e9e4dc" } }).composite(comp).png().toFile(out);
})();
