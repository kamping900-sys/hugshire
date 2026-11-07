import { animalShapes, type AnimalKind } from "@/lib/animals";

function Animal({ kind, x, y, s = 1, frame = 0 }: { kind: AnimalKind; x: number; y: number; s?: number; frame?: number }) {
  return (
    <g transform={`translate(${x - 32 * s} ${y - 57 * s}) scale(${s})`}>
      {animalShapes(kind, frame).map((sh, i) =>
        sh.t === "ellipse" ? <ellipse key={i} cx={sh.cx} cy={sh.cy} rx={sh.rx} ry={sh.ry} fill={sh.fill} /> : <polygon key={i} points={sh.pts.join(",")} fill={sh.fill} />,
      )}
    </g>
  );
}

function House({ x, y, roof, w = 46, accent = false }: { x: number; y: number; roof: string; w?: number; accent?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="0" rx={w} ry={w * 0.3} fill="#2B241E" opacity="0.1" />
      <rect x={-w} y={-50} width={w * 2} height={50} rx="6" fill="#FFF6EC" />
      <polygon points={`${-w - 8},-48 0,${-w - 46} ${w + 8},-48`} fill={roof} />
      <rect x="-9" y="-28" width="18" height="28" rx="4" fill="#B9805A" />
      <rect x={-w + 10} y="-40" width="14" height="12" rx="2" fill="#FFE4A8" />
      <rect x={w - 24} y="-40" width="14" height="12" rx="2" fill="#FFE4A8" />
      {accent && <path d="M0 -60c-5-5-12-2-10 4l10 9 10-9c2-6-5-9-10-4z" fill="#FFF8F0" />}
    </g>
  );
}

function Tree({ x, y, c = "#8CC38A" }: { x: number; y: number; c?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="0" rx="16" ry="5" fill="#2B241E" opacity="0.1" />
      <rect x="-3" y="-16" width="6" height="16" rx="2" fill="#9A6B45" />
      <circle cx="0" cy="-30" r="17" fill={c} />
      <circle cx="-10" cy="-22" r="10" fill={c} />
      <circle cx="10" cy="-23" r="10" fill={c} />
    </g>
  );
}

/** Original illustration of a Hugshire town, built from the same shapes as the game. */
export function HeroScene() {
  return (
    <svg viewBox="0 0 640 460" className="h-auto w-full" role="img" aria-label="A cozy Hugshire town where animal helpers build and deliver parcels">
      <defs>
        <radialGradient id="glow" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#FFE9D2" />
          <stop offset="100%" stopColor="#FFF8F0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="640" height="460" fill="url(#glow)" />
      <ellipse cx="320" cy="300" rx="300" ry="150" fill="#F3E3C3" />
      <ellipse cx="320" cy="292" rx="282" ry="136" fill="#CFE6B8" />
      <path d="M90 300 Q220 250 320 290 T560 270" stroke="#EBD9BC" strokeWidth="30" fill="none" strokeLinecap="round" />
      <path d="M470 380 q40 -30 120 -10" stroke="#9CCFE6" strokeWidth="18" fill="none" strokeLinecap="round" />
      <Tree x={110} y={250} />
      <Tree x={150} y={372} c="#7FB77E" />
      <Tree x={540} y={230} c="#6FAE7A" />
      <Tree x={585} y={318} />
      <House x={240} y={262} roof="#E67624" />
      <House x={400} y={250} roof="#F58A3C" w={58} accent />
      <House x={500} y={340} roof="#D96B62" w={40} />
      {/* foundation still being built */}
      <g transform="translate(300 380)">
        <rect x="-44" y="-26" width="88" height="26" rx="4" fill="#E7DCCD" />
        <rect x="-44" y="-36" width="6" height="36" fill="#C9A27A" />
        <rect x="38" y="-36" width="6" height="36" fill="#C9A27A" />
        <rect x="-44" y="-36" width="88" height="5" fill="#C9A27A" />
      </g>
      {/* parcels */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${178 + i * 15} ${318 - (i % 2) * 6})`}>
          <rect x="-8" y="-14" width="16" height="14" rx="3" fill="#F6C76C" />
          <rect x="-1.5" y="-14" width="3" height="14" fill="#E67624" />
        </g>
      ))}
      <Animal kind="fox" x={205} y={340} s={1.05} />
      <Animal kind="bunny" x={345} y={312} s={0.95} frame={2} />
      <Animal kind="otter" x={455} y={300} s={0.95} />
      <Animal kind="bear" x={262} y={410} s={1} frame={3} />
      <Animal kind="cat" x={380} y={412} s={0.9} />
      <Animal kind="capybara" x={560} y={392} s={0.9} />
      <g transform="translate(345 262)">
        <rect x="-8" y="-14" width="16" height="14" rx="3" fill="#F6C76C" />
        <rect x="-1.5" y="-14" width="3" height="14" fill="#E67624" />
      </g>
    </svg>
  );
}
