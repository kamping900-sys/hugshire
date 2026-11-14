/**
 * Reads the Wood mini-game's timing bar from a captured frame: where the dark marker is and where the
 * green (Perfect) zone is. Used to time the chop like a sharp-eyed player; the server still judges it.
 */
const sharp = require("sharp");

let cal = null; // { y, x0, x1 } once the bar has been found

async function readBar(jpeg) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const px = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i + 1], data[i + 2]]; };
  const isTrack = ([r, g, b]) => Math.abs(r - 234) < 14 && Math.abs(g - 220) < 14 && Math.abs(b - 200) < 16;
  const isGreen = ([r, g, b]) => g > 150 && g - r > 50 && g - b > 30;
  const isYellow = ([r, g, b]) => r > 220 && g > 185 && b < 130;
  const isDark = ([r, g, b]) => r < 90 && g < 75 && b < 65;
  if (!cal) {
    // the bar sits in the top part of the game overlay: the row with the most beige track pixels
    let best = null;
    for (let y = 40; y < H * 0.45; y += 2) {
      let n = 0, g = 0, x0 = -1, x1 = -1;
      for (let x = 0; x < W; x++) { const p = px(x, y); if (isTrack(p)) { n++; if (x0 < 0) x0 = x; x1 = x; } else if (isGreen(p)) g++; }
      if (n > W * 0.2 && g > 20 && (!best || n > best.n)) best = { y, n, x0, x1 };
    }
    if (!best) return null;
    cal = { y: best.y, x0: best.x0, x1: best.x1 };
  }
  const { y, x0, x1 } = cal;
  let gMin = Infinity, gMax = -1, dSum = 0, dN = 0;
  for (let x = x0; x < x1; x++) {
    const p = px(x, y);
    if (isGreen(p)) { gMin = Math.min(gMin, x); gMax = Math.max(gMax, x); }
    if (isDark(p)) { dSum += x; dN++; }
  }
  if (!dN || gMax < 0) return { cal, marker: dN ? dSum / dN : null, green: null };
  // the marker can hide part of the green zone: widen the zone to include it when they touch
  const marker = dSum / dN;
  if (marker > gMax && marker - gMax < 12) gMax = marker;
  if (marker < gMin && gMin - marker < 12) gMin = marker;
  return { cal, marker, green: [gMin, gMax], width: x1 - x0 };
}

function resetBar() { cal = null; }

module.exports = { readBar, resetBar };
