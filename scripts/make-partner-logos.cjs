/**
 * Draws the three partner marks used in the money-flow steps as small SVGs:
 *   node scripts/make-partner-logos.cjs   →  public/brand/{coinbase,near,rhea}.svg
 * Swap any of them for an official file with the same name if you have one.
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "public", "brand");
fs.mkdirSync(OUT, { recursive: true });

// Coinbase: blue rounded square, white "C" ring with a slot on the right
const coinbase = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><mask id="c"><rect width="512" height="512" fill="#000"/><circle cx="256" cy="256" r="163" fill="#fff"/><circle cx="256" cy="256" r="82" fill="#000"/><rect x="300" y="242" width="140" height="28" fill="#000"/></mask></defs>
<rect width="512" height="512" rx="96" fill="#0052FF"/>
<rect width="512" height="512" fill="#fff" mask="url(#c)"/>
</svg>`;

// NEAR: orange square, white rounded "N" with the two arrow flags
const near = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<rect width="400" height="400" rx="72" fill="#FF5A00"/>
<path d="M176 232 L114 286 L114 100 L286 300 L286 114 L224 168" fill="none" stroke="#F4F4F2" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// RHEA: dark navy square, neon-green paw inside a laurel wreath
const leaves = [];
// two arcs of leaves, from the bottom up each side, each leaf lying along the arc
const CX = 200, CY = 206, R = 124;
for (let k = 0; k < 7; k++) {
  const th = 112 + k * 17; // degrees, y-down: 90 = straight below the centre
  const t = (th * Math.PI) / 180;
  const x = CX + R * Math.cos(t), y = CY + R * Math.sin(t);
  const rot = th - 40; // tipped outward from the arc like laurel leaves
  leaves.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="10" ry="23" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
  const mx = 2 * CX - x; // mirrored on the right
  leaves.push(`<ellipse cx="${mx.toFixed(1)}" cy="${y.toFixed(1)}" rx="10" ry="23" transform="rotate(${(-rot).toFixed(1)} ${mx.toFixed(1)} ${y.toFixed(1)})"/>`);
}
const rhea = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<rect width="400" height="400" rx="72" fill="#1B2030"/>
<g fill="none" stroke="#33E6A6" stroke-width="9" stroke-linejoin="round" stroke-linecap="round">
<path d="M184 330 L216 318 M216 330 L184 318"/>
${leaves.join("\n")}
<path d="M200 176 C232 176 262 214 262 246 C262 268 244 276 226 270 C214 266 206 262 200 262 C194 262 186 266 174 270 C156 276 138 268 138 246 C138 214 168 176 200 176 Z"/>
<ellipse cx="146" cy="168" rx="17" ry="24" transform="rotate(-24 146 168)"/>
<ellipse cx="182" cy="134" rx="17" ry="26" transform="rotate(-8 182 134)"/>
<ellipse cx="218" cy="134" rx="17" ry="26" transform="rotate(8 218 134)"/>
<ellipse cx="254" cy="168" rx="17" ry="24" transform="rotate(24 254 168)"/>
</g>
</svg>`;

fs.writeFileSync(path.join(OUT, "coinbase.svg"), coinbase);
fs.writeFileSync(path.join(OUT, "near.svg"), near);
fs.writeFileSync(path.join(OUT, "rhea.svg"), rhea);
console.log("wrote", fs.readdirSync(OUT).join(", "));
