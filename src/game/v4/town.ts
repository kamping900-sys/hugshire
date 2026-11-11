/**
 * Detailed town layout (level 2). Deterministic from the cause seed, shared by client and server:
 * the server validates plot keys and blueprint sizes against this, so players can only build on
 * approved plots and roads always stay clear.
 */
import { mulberry } from "./rules";

export const TOWN_CELL = 32;
export const TOWN_W = 60;
export const TOWN_H = 42;

export type PlotSize = "S" | "M" | "L";
export type Plot = { key: string; x: number; y: number; w: number; h: number; size: PlotSize };
export type Blueprint = { key: string; name: string; size: PlotSize; sprite: string; wood: number; stone: number; blurb: string };

/** Configurable example requirements (whole resources). The server converts to µ units. */
export const BLUEPRINTS: Blueprint[] = [
  { key: "cottage", name: "Cozy Cottage", size: "S", sprite: "prop:cottage", wood: 300, stone: 150, blurb: "A warm little home." },
  { key: "gazebo", name: "Garden Gazebo", size: "S", sprite: "prop:gazebo", wood: 250, stone: 80, blurb: "Shade for picnics." },
  { key: "tent", name: "Market Tent", size: "S", sprite: "prop:tent", wood: 180, stone: 40, blurb: "For weekend markets." },
  { key: "bookshop", name: "Bookshop", size: "M", sprite: "prop:bookshop", wood: 2000, stone: 1000, blurb: "Stories for everyone." },
  { key: "clinic", name: "Clinic", size: "M", sprite: "prop:clinic", wood: 2500, stone: 1500, blurb: "Check-ups and care." },
  { key: "greenhouse", name: "Greenhouse", size: "M", sprite: "prop:greenhouse", wood: 1800, stone: 800, blurb: "Seedlings all year." },
  { key: "studio", name: "Art Studio", size: "M", sprite: "prop:studio", wood: 2000, stone: 900, blurb: "Paint, clay and music." },
  { key: "barn", name: "Big Barn", size: "M", sprite: "prop:barn", wood: 2200, stone: 700, blurb: "Room for the harvest." },
  { key: "school", name: "School", size: "L", sprite: "prop:school", wood: 12000, stone: 6000, blurb: "Classrooms full of light." },
  { key: "windmill", name: "Windmill", size: "L", sprite: "prop:windmill", wood: 8000, stone: 3000, blurb: "Grinds flour for the bakery." },
  { key: "lighthouse", name: "Lighthouse", size: "L", sprite: "prop:lighthouse", wood: 10000, stone: 8000, blurb: "Guides everyone home." },
  { key: "townHall", name: "Town Hall", size: "L", sprite: "prop:townHall", wood: 50000, stone: 20000, blurb: "The heart of the town." },
];
export const blueprint = (key: string) => BLUEPRINTS.find((b) => b.key === key);

const SIZE: Record<PlotSize, [number, number]> = { S: [5, 4], M: [7, 5], L: [9, 7] };

/** Roads: a main street (rows 19-21), a cross street (cols 28-31) and two lanes. */
export const ROADS: { x: number; y: number; w: number; h: number }[] = [
  { x: 0, y: 19, w: TOWN_W, h: 3 },
  { x: 28, y: 0, w: 4, h: TOWN_H },
  { x: 6, y: 6, w: 22, h: 2 },
  { x: 32, y: 33, w: 22, h: 2 },
];

const PLOT_TEMPLATE: { x: number; y: number; size: PlotSize }[] = [
  // north of the main street
  { x: 18, y: 10, size: "L" },
  { x: 34, y: 11, size: "L" },
  { x: 7, y: 11, size: "M" },
  { x: 45, y: 12, size: "M" },
  { x: 8, y: 1, size: "S" },
  { x: 16, y: 1, size: "S" },
  { x: 36, y: 3, size: "M" },
  { x: 47, y: 4, size: "S" },
  // south of the main street
  { x: 7, y: 24, size: "M" },
  { x: 17, y: 24, size: "M" },
  { x: 35, y: 24, size: "L" },
  { x: 47, y: 25, size: "S" },
  { x: 9, y: 33, size: "S" },
  { x: 18, y: 33, size: "S" },
  { x: 35, y: 36, size: "S" },
  { x: 44, y: 36, size: "S" },
];

export type TownLayout = {
  seed: number;
  plots: Plot[];
  roads: typeof ROADS;
  entrance: { x: number; y: number };
  noticeBoard: { x: number; y: number };
  heartTree: { x: number; y: number };
  pond: { x: number; y: number; r: number };
  trees: { x: number; y: number; v: number }[];
  flowers: { x: number; y: number; v: number }[];
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

const blocked = (x: number, y: number, plots: Plot[]) =>
  ROADS.some((r) => x >= r.x - 1 && x < r.x + r.w + 1 && y >= r.y - 1 && y < r.y + r.h + 1) ||
  plots.some((p) => x >= p.x - 1 && x < p.x + p.w + 1 && y >= p.y - 1 && y < p.y + p.h + 1);

export function townLayout(seed: number): TownLayout {
  const r = mulberry(seed || 1);
  const plots = plotsFor();
  const entrance = { x: 30, y: TOWN_H - 1 };
  const noticeBoard = { x: 33, y: 27 };
  const heartTree = { x: 25, y: 31 };
  const pond = { x: 54, y: 39, r: 2 };
  const trees: TownLayout["trees"] = [];
  const flowers: TownLayout["flowers"] = [];
  const reserved = (x: number, y: number) =>
    blocked(x, y, plots) ||
    Math.hypot(x - heartTree.x, y - heartTree.y) < 3.5 ||
    Math.hypot(x - noticeBoard.x, y - noticeBoard.y) < 2.5 ||
    Math.hypot(x - pond.x, y - pond.y) < pond.r + 1.5;
  for (let k = 0; k < 900 && trees.length < 70; k++) {
    const x = Math.floor(r() * TOWN_W), y = Math.floor(r() * TOWN_H);
    const edge = x < 3 || y < 1 || x > TOWN_W - 4 || y > TOWN_H - 3;
    if ((edge || r() < 0.25) && !reserved(x, y) && !trees.some((t) => Math.abs(t.x - x) < 2 && Math.abs(t.y - y) < 2)) trees.push({ x, y, v: Math.floor(r() * 4) });
  }
  for (let k = 0; k < 600 && flowers.length < 90; k++) {
    const x = Math.floor(r() * TOWN_W), y = Math.floor(r() * TOWN_H);
    if (!reserved(x, y)) flowers.push({ x, y, v: Math.floor(r() * 5) });
  }
  return { seed, plots, roads: ROADS, entrance, noticeBoard, heartTree, pond, trees, flowers };
}

/** Visual construction stage from progress (0..1). */
export function stageOf(progress: number, status: string): 0 | 1 | 2 | 3 | 4 {
  if (status === "completed" || progress >= 1) return 4;
  if (progress >= 0.75) return 3;
  if (progress >= 0.25) return 2;
  return 1; // reserved or just started: foundation
}
export const STAGE_NAMES = ["Empty plot", "Foundation", "Scaffolding", "Nearly done", "Completed"] as const;
