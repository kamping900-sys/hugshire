import { describe, expect, it } from "vitest";
import { CELL, G, TILE_CELLS, TILE_PX, World, causeSlots, generateTile, spiral } from "@/game/world/gen";
import { demoCauses } from "@/game/world/demo";
import { findPath } from "@/game/world/path";

const world = () => new World(demoCauses(64));

describe("grid world", () => {
  it("places causes on unique tiles, town square at the centre", () => {
    const cs = demoCauses(64);
    expect(new Set(cs.map((c) => `${c.tx},${c.ty}`)).size).toBe(64);
    expect(cs[0]).toMatchObject({ category: "square", tx: 0, ty: 0 });
    expect(spiral(9).slice(0, 3)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(causeSlots(200)).toHaveLength(200); // scales to many causes
  });

  it("generates the same tile every time (no world data to download)", () => {
    const w = world();
    const a = generateTile(w, 2, -1), b = generateTile(new World(demoCauses(64)), 2, -1);
    expect(Array.from(a.ground)).toEqual(Array.from(b.ground));
    expect(a.props).toEqual(b.props);
  });

  it("is infinite: far-away tiles are wilderness and cost nothing to keep", () => {
    const w = world();
    const t = w.tile(500, -800);
    expect(t.cause).toBeNull();
    expect(["forest", "meadow", "lake", "grove", "hills"]).toContain(t.kind);
  });

  it("caches tiles with a bounded LRU", () => {
    const w = new World(demoCauses(16), 10);
    for (let i = 0; i < 50; i++) w.tile(i, 0);
    expect((w as unknown as { cache: Map<string, unknown> }).cache.size).toBe(10);
  });

  it("every cause has a reachable door and roads on its edges", () => {
    const w = world();
    for (const c of w.causes) {
      const t = w.tile(c.tx, c.ty);
      expect(t.hall).not.toBeNull();
      expect(w.walkable(Math.floor(t.hall!.x / CELL), Math.floor(t.hall!.y / CELL))).toBe(true);
      expect(t.ground[0 * TILE_CELLS + 10]).toBe(G.ROAD); // top road
      expect(t.ground[10 * TILE_CELLS + 0]).toBe(G.ROAD); // left road
    }
  });

  it("abandoned causes show ruins, thriving ones show buildings", () => {
    const w = new World([
      { id: "a", name: "A", subtitle: "", org: "", category: "homes", tx: 0, ty: 0, stage: 0, helpers: 1, deliveredUsd: 0 },
      { id: "b", name: "B", subtitle: "", org: "", category: "homes", tx: 1, ty: 0, stage: 5, helpers: 1, deliveredUsd: 0 },
    ]);
    const kinds = (tx: number) => w.tile(tx, 0).props.map((p) => p.k);
    expect(kinds(0)).toContain("ruin");
    expect(kinds(0)).not.toContain("house");
    expect(kinds(1).filter((k) => k === "house")).toHaveLength(6);
  });
});

describe("pathfinding", () => {
  it("walks from the town square to a neighbouring cause's door", () => {
    const w = world();
    const a = w.tile(0, 0).hall!, b = w.tile(1, 0).hall!;
    const p = findPath({ x: Math.floor(a.x / CELL), y: Math.floor(a.y / CELL) }, { x: Math.floor(b.x / CELL), y: Math.floor(b.y / CELL) }, (x, y) => w.walkable(x, y), 20000);
    expect(p).not.toBeNull();
    expect(p![p!.length - 1]).toEqual({ x: Math.floor(b.x / CELL), y: Math.floor(b.y / CELL) });
    for (const c of p!) expect(w.walkable(c.x, c.y)).toBe(true);
  });

  it("delivery trucks can drive between towns on roads only", () => {
    const w = world();
    const cs = w.causes;
    const start = { x: cs[0].tx * TILE_CELLS, y: cs[0].ty * TILE_CELLS };
    const goal = { x: cs[8].tx * TILE_CELLS, y: cs[8].ty * TILE_CELLS };
    const p = findPath(start, goal, (x, y) => w.isRoad(x, y), 40000);
    expect(p?.[p.length - 1]).toEqual(goal);
    for (const c of p!) expect(w.isRoad(c.x, c.y)).toBe(true);
  });

  it("gives up gracefully within its node budget", () => {
    const p = findPath({ x: 0, y: 0 }, { x: 100000, y: 0 }, () => true, 500);
    expect(p).not.toBeNull(); // best partial path, not a hang
    expect(p!.length).toBeLessThan(600);
  });

  it("tile pixels line up with cells", () => expect(TILE_PX).toBe(CELL * TILE_CELLS));
});
