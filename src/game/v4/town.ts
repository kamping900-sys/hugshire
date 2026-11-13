/**
 * Detailed town layout (level 2). Deterministic from the cause seed, shared by client and server:
 * the server validates plot keys and blueprint sizes against this, so players can only build on
 * approved plots and roads always stay clear.
 */
import { mulberry } from "./rules";

export const TOWN_CELL = 32;
export const TOWN_W = 40;
export const TOWN_H = 28;

export type PlotSize = "S" | "M" | "L";
export type Plot = { key: string; x: number; y: number; w: number; h: number; size: PlotSize };
export type Blueprint = { key: string; name: string; size: PlotSize; sprite: string; wood: number; stone: number; blurb: string; kind: "house" | "building"; mvp: boolean };

/**
 * MVP scope: 2 houses + 4 buildings can be built (each will get 4 construction-stage sprites).
 * The others are kept only so older projects still render; they cannot be started, and the town
 * shows them as background scenery instead (see DECOR).
 * Requirements are configurable example values (whole Wood); the server converts to µ units.
 * Stone was removed (Wood is the only building material), so buildable blueprints need 0 Stone.
 */
export const BLUEPRINTS: Blueprint[] = [
  // houses (small plots)
  { key: "cottage", name: "Cozy Cottage", size: "S", sprite: "prop:cottage", wood: 30000, stone: 0, blurb: "A warm little home.", kind: "house", mvp: true },
  { key: "house", name: "Family House", size: "S", sprite: "prop:house:1", wood: 40000, stone: 0, blurb: "Room for a whole family.", kind: "house", mvp: true },
  // buildings (medium and large plots)
  { key: "bookshop", name: "Bookshop", size: "M", sprite: "prop:bookshop", wood: 200000, stone: 0, blurb: "Stories for everyone.", kind: "building", mvp: true },
  { key: "barn", name: "Big Barn", size: "M", sprite: "prop:barn", wood: 220000, stone: 0, blurb: "Room for the harvest.", kind: "building", mvp: true },
  { key: "school", name: "School", size: "L", sprite: "prop:school", wood: 1200000, stone: 0, blurb: "Classrooms full of light.", kind: "building", mvp: true },
  { key: "townHall", name: "Town Hall", size: "L", sprite: "prop:townHall", wood: 5000000, stone: 0, blurb: "The heart of the town.", kind: "building", mvp: true },
  // retired for the MVP (render only, never startable)
  { key: "gazebo", name: "Garden Gazebo", size: "S", sprite: "prop:gazebo", wood: 25000, stone: 80, blurb: "Shade for picnics.", kind: "building", mvp: false },
  { key: "tent", name: "Market Tent", size: "S", sprite: "prop:tent", wood: 18000, stone: 40, blurb: "For weekend markets.", kind: "building", mvp: false },
  { key: "clinic", name: "Clinic", size: "M", sprite: "prop:clinic", wood: 250000, stone: 1500, blurb: "Check-ups and care.", kind: "building", mvp: false },
  { key: "greenhouse", name: "Greenhouse", size: "M", sprite: "prop:greenhouse", wood: 180000, stone: 800, blurb: "Seedlings all year.", kind: "building", mvp: false },
  { key: "studio", name: "Art Studio", size: "M", sprite: "prop:studio", wood: 200000, stone: 900, blurb: "Paint, clay and music.", kind: "building", mvp: false },
  { key: "windmill", name: "Windmill", size: "L", sprite: "prop:windmill", wood: 800000, stone: 3000, blurb: "Grinds flour for the bakery.", kind: "building", mvp: false },
  { key: "lighthouse", name: "Lighthouse", size: "L", sprite: "prop:lighthouse", wood: 1000000, stone: 8000, blurb: "Guides everyone home.", kind: "building", mvp: false },
];
export const blueprint = (key: string) => BLUEPRINTS.find((b) => b.key === key);
/** What players can choose to build. */
export const BUILDABLE = BLUEPRINTS.filter((b) => b.mvp);

/** Non-buildable buildings shown as fixed background scenery around the town edges (cell coords, base row). */
export const DECOR: { sprite: string; x: number; y: number; h: number }[] = [
  { sprite: "prop:windmill", x: 38, y: 7, h: 150 },
  { sprite: "prop:lighthouse", x: 38, y: 24, h: 170 },
  { sprite: "prop:gazebo", x: 13, y: 10, h: 92 },
];

const SIZE: Record<PlotSize, [number, number]> = { S: [5, 4], M: [7, 5], L: [9, 7] };

/** No roads in the area map: a meadow town. Kept as an (empty) export for older callers and tests. */
export const ROADS: { x: number; y: number; w: number; h: number }[] = [];

/** Compact meadow town: 10 plots around a small stone plaza, a river along the east side. */
const PLOT_TEMPLATE: { x: number; y: number; size: PlotSize }[] = [
  { x: 2, y: 2, size: "L" },
  { x: 21, y: 2, size: "L" },
  { x: 13, y: 3, size: "M" },
  { x: 2, y: 11, size: "M" },
  { x: 26, y: 11, size: "S" },
  { x: 26, y: 17, size: "S" },
  { x: 2, y: 19, size: "M" },
  { x: 10, y: 21, size: "S" },
  { x: 23, y: 22, size: "M" },
  { x: 15, y: 22, size: "S" },
];

export type TownProp = { key: string; x: number; y: number; h: number; flip?: boolean };

export type TownLayout = {
  seed: number;
  plots: Plot[];
  entrance: { x: number; y: number };
  noticeBoard: { x: number; y: number };
  heartTree: { x: number; y: number };
  plaza: { x: number; y: number; w: number; h: number };
  /** River centre (in cells) for each row, and its width in cells. Rows in `bridgeRows` are crossable. */
  river: { cx: number[]; width: number; bridgeRows: number[] };
  props: TownProp[];
};

export function plotsFor(): Plot[] {
  return PLOT_TEMPLATE.map((p, i) => {
    const [w, h] = SIZE[p.size];
    return { key: `p${i + 1}`, x: p.x, y: p.y, w, h, size: p.size };
  });
}

export function isPlot(key: string) {
  return plotsFor().find((p) => p.key === key);
}

export function riverCentre(seed: number) {
  const ph = ((seed >>> 0) % 628) / 100;
  return Array.from({ length: TOWN_H }, (_, y) => 34.5 + Math.sin(y / 4.2 + ph) * 1.6);
}

export function isRiver(l: Pick<TownLayout, "river">, x: number, y: number) {
  const c = l.river.cx[Math.max(0, Math.min(TOWN_H - 1, y))];
  return Math.abs(x + 0.5 - c) < l.river.width / 2;
}

export function townLayout(seed: number): TownLayout {
  const r = mulberry(seed || 1);
  const plots = plotsFor();
  const plaza = { x: 17, y: 11, w: 8, h: 7 };
  const entrance = { x: 20, y: TOWN_H - 1 };
  const noticeBoard = { x: 23, y: 12 };
  const heartTree = { x: 13, y: 15 };
  const river = { cx: riverCentre(seed), width: 3.2, bridgeRows: [14, 15] };
  const props: TownProp[] = [];
  const taken = new Set<string>();
  const near = (x: number, y: number, d: number) =>
    plots.some((p) => x >= p.x - d && x < p.x + p.w + d && y >= p.y - d && y < p.y + p.h + d) ||
    (x >= plaza.x - 1 && x < plaza.x + plaza.w + 1 && y >= plaza.y - 1 && y < plaza.y + plaza.h + 1) ||
    Math.hypot(x - heartTree.x, y - heartTree.y) < 3.6 ||
    Math.hypot(x - noticeBoard.x, y - noticeBoard.y) < 2 ||
    (Math.abs(x - entrance.x) < 2 && y > plaza.y + plaza.h - 2) || // footpath to the plaza
    (y >= plaza.y + 2 && y <= plaza.y + 4 && x > heartTree.x && x < plaza.x) || // footpath to the heart tree
    DECOR.some((dc) => Math.abs(x - dc.x) < 3 && y <= dc.y + 1 && y > dc.y - 5);
  const free = (x: number, y: number, d = 1) => x >= 0 && y >= 0 && x < TOWN_W && y < TOWN_H && !near(x, y, d) && !isRiver({ river }, x, y) && !isRiver({ river }, x + 1, y) && !isRiver({ river }, x - 1, y) && !taken.has(`${x},${y}`);
  const put = (key: string, x: number, y: number, h: number, spacing = 1) => {
    for (let dx = -spacing + 1; dx < spacing; dx++) for (let dy = -spacing + 1; dy < spacing; dy++) taken.add(`${x + dx},${y + dy}`);
    props.push({ key, x, y, h, flip: r() < 0.5 });
  };
  const TREES = ["prop:tree:0", "prop:tree:1", "prop:tree:2", "prop:tree:3", "prop:pine", "prop:blossom", "prop:pine", "prop:tree:1"];
  // a soft ring of trees around the edges
  for (let k = 0; k < 500 && props.length < 46; k++) {
    const side = Math.floor(r() * 4);
    const x = side === 0 ? Math.floor(r() * 2) : side === 1 ? TOWN_W - 1 - Math.floor(r() * 2) : Math.floor(r() * TOWN_W);
    const y = side === 2 ? Math.floor(r() * 2) : side === 3 ? TOWN_H - 1 - Math.floor(r() * 1) : Math.floor(r() * TOWN_H);
    if (free(x, y, 0)) put(TREES[Math.floor(r() * TREES.length)], x, y, 92 + r() * 40, 2);
  }
  // little groves inside
  for (let k = 0; k < 400 && props.length < 66; k++) {
    const x = 1 + Math.floor(r() * (TOWN_W - 2)), y = 1 + Math.floor(r() * (TOWN_H - 2));
    if (free(x, y, 1)) put(TREES[Math.floor(r() * TREES.length)], x, y, 84 + r() * 36, 2);
  }
  // bushes, flowers, mushrooms, stumps
  const SMALL = ["prop:flowers", "prop:flowers", "prop:bush:0", "prop:bush:1", "prop:bush:2", "prop:bush:3", "prop:mushroom", "prop:stump", "prop:rock"];
  for (let k = 0; k < 900 && props.length < 150; k++) {
    const x = Math.floor(r() * TOWN_W), y = Math.floor(r() * TOWN_H);
    if (free(x, y, 0)) put(SMALL[Math.floor(r() * SMALL.length)], x, y, 30 + r() * 18, 1);
  }
  // riverbank reeds and stones
  for (let y = 1; y < TOWN_H - 1; y += 2) {
    if (river.bridgeRows.includes(y)) continue;
    const c = river.cx[y];
    const bank = r() < 0.5 ? Math.floor(c - river.width / 2 - 1) : Math.ceil(c + river.width / 2);
    if (!near(bank, y, 0) && !taken.has(`${bank},${y}`)) put(r() < 0.65 ? "prop:reeds" : "prop:rockBig", bank, y, r() < 0.65 ? 40 : 34, 1);
  }
  // plaza furniture and a small farm corner
  const fixed: [string, number, number, number][] = [
    ["prop:fountain", plaza.x + 3, plaza.y + 3, 74],
    ["prop:bench", plaza.x + 1, plaza.y + 6, 36],
    ["prop:bench", plaza.x + 6, plaza.y + 6, 36],
    ["prop:lamp", plaza.x, plaza.y, 70],
    ["prop:lamp", plaza.x + plaza.w - 1, plaza.y + plaza.h - 1, 70],
    ["prop:lamp", plaza.x, plaza.y + plaza.h - 1, 70],
    ["prop:well", 10, 17, 58],
    ["prop:hay", 10, 9, 40],
    ["prop:scarecrow", 11, 7, 62],
    ["prop:stall", 15, 19, 62],
    ["prop:boxes", 20, 9, 34],
  ];
  for (const [k, x, y, h] of fixed) {
    props.push({ key: k, x, y, h });
    taken.add(`${x},${y}`);
  }
  return { seed, plots, entrance, noticeBoard, heartTree, plaza, river, props };
}

/** Visual construction stage from progress (0..1). */
export function stageOf(progress: number, status: string): 0 | 1 | 2 | 3 | 4 {
  if (status === "completed" || progress >= 1) return 4;
  if (progress >= 0.75) return 3;
  if (progress >= 0.25) return 2;
  return 1; // reserved or just started: foundation
}
export const STAGE_NAMES = ["Empty plot", "Foundation", "Scaffolding", "Nearly done", "Completed"] as const;
