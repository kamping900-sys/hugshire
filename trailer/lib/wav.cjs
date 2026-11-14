/** Minimal WAV read/write (16-bit PCM or 32-bit float), channels as Float32Arrays. */
const fs = require("fs");

function readWav(file) {
  const b = fs.readFileSync(file);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = { format: b.readUInt16LE(off + 8), ch: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
      // WAVE_FORMAT_EXTENSIBLE (what ffmpeg writes for 32-bit float): the real format is in the sub-format GUID.
      // Missing this made float samples read as integers, which distorted the V1 narration.
      if (fmt.format === 0xfffe && sz >= 40) fmt.format = b.readUInt16LE(off + 8 + 24);
    }
    if (id === "data") data = { start: off + 8, size: Math.min(sz, b.length - off - 8) };
    off += 8 + sz + (sz & 1);
  }
  if (!fmt || !data) throw new Error("bad wav " + file);
  const bytes = fmt.bits / 8, n = Math.floor(data.size / (bytes * fmt.ch));
  const chans = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++)
    for (let c = 0; c < fmt.ch; c++) {
      const p = data.start + (i * fmt.ch + c) * bytes;
      chans[c][i] = fmt.format === 3 ? b.readFloatLE(p) : fmt.bits === 16 ? b.readInt16LE(p) / 32768 : fmt.bits === 24 ? b.readIntLE(p, 3) / 8388608 : b.readInt32LE(p) / 2147483648;
    }
  return { rate: fmt.rate, chans };
}

/** Writes 32-bit float WAV. */
function writeWav(file, rate, chans) {
  const n = chans[0].length, ch = chans.length;
  const b = Buffer.alloc(44 + n * ch * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * ch * 4, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * ch * 4, 28); b.writeUInt16LE(ch * 4, 32); b.writeUInt16LE(32, 34);
  b.write("data", 36); b.writeUInt32LE(n * ch * 4, 40);
  let p = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { b.writeFloatLE(chans[c][i], p); p += 4; }
  fs.writeFileSync(file, b);
}

/** First/last sample above a threshold, padded (seconds). */
function trimBounds(x, rate, thr = 0.012, pad = 0.06) {
  let a = 0, z = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < thr) a++;
  while (z > a && Math.abs(x[z]) < thr) z--;
  return { start: Math.max(0, a / rate - pad), end: Math.min(x.length / rate, z / rate + pad) };
}

module.exports = { readWav, writeWav, trimBounds };
