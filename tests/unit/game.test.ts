import { describe, expect, it } from "vitest";
import {
  adaptCap,
  buildCityLayout,
  commandMove,
  makeAgent,
  near,
  parcelCount,
  rng,
  selectVisibleHelpers,
  stepAgent,
  type HelperRow,
} from "@/game/sim";
import { animalShapes, ANIMAL_LIST } from "@/lib/animals";

const helpers = (n: number, mine = 0): HelperRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `h${i}`, animal: ANIMAL_LIST[i % 8], nickname: `H${i}`, mine: i < mine }));

describe("city layout", () => {
  it("is deterministic for the same seed and stage", () => {
    expect(buildCityLayout(42, "shelter", 2)).toEqual(buildCityLayout(42, "shelter", 2));
  });
  it("develops with stage: fewer ruins, more buildings", () => {
    const count = (s: number, kinds: string[]) => buildCityLayout(7, "school", s).props.filter((p) => kinds.includes(p.kind)).length;
    expect(count(0, ["house", "landmark"])).toBe(0);
    expect(count(3, ["house", "landmark"])).toBe(3);
    expect(count(5, ["house", "landmark"])).toBe(8);
    expect(count(0, ["ruin", "rock"])).toBeGreaterThan(count(5, ["ruin", "rock"]));
    expect(buildCityLayout(7, "school", 0).props.some((p) => p.kind === "hall_ruin")).toBe(true);
    expect(buildCityLayout(7, "school", 3).props.some((p) => p.kind === "hall")).toBe(true);
  });
  it("clamps stage to 0..5", () => {
    expect(buildCityLayout(1, "food", 99).stage).toBe(5);
    expect(buildCityLayout(1, "food", -3).stage).toBe(0);
  });
});

describe("helper spawning and state machine", () => {
  const layout = buildCityLayout(3, "nature", 1);
  it("spawns near the depot", () => {
    const a = makeAgent({ id: "a", animal: "fox", nickname: "Ember", mine: false }, layout, 11);
    expect(Math.abs(a.x - layout.depot.x)).toBeLessThan(200);
    expect(a.state).toBe("idle");
  });
  it("cycles idle → walk → work → carry → idle", () => {
    const a = makeAgent({ id: "a", animal: "otter", nickname: "Pip", mine: false }, layout, 5);
    const r = rng(9);
    const seen = new Set<string>();
    for (let t = 0; t < 4000 && seen.size < 4; t++) {
      stepAgent(a, 0.05, layout, r);
      seen.add(a.state);
    }
    expect([...seen].sort()).toEqual(["carry", "idle", "walk", "work"]);
  });
  it("player control moves the helper to the tapped point and stops", () => {
    const a = makeAgent({ id: "m", animal: "cat", nickname: "Miso", mine: true }, layout, 1);
    commandMove(a, 400, 300);
    expect(a.controlled).toBe(true);
    for (let t = 0; t < 400; t++) stepAgent(a, 0.05, layout, () => 0.5);
    expect(near(a, { x: 400, y: 300 }, 3)).toBe(true);
    expect(a.state).toBe("idle");
  });
  it("commands are clamped to the town", () => {
    const a = makeAgent({ id: "m", animal: "cat", nickname: "Miso", mine: true }, layout, 1);
    commandMove(a, -500, 99999);
    expect(a.tx).toBeGreaterThan(0);
    expect(a.ty).toBeLessThan(600);
  });
});

describe("rendering budget", () => {
  it("never draws more than the cap, even with thousands of supporters", () => {
    expect(selectVisibleHelpers(helpers(5000, 1), 24, 0)).toHaveLength(24);
  });
  it("always includes the viewer's own helpers first", () => {
    const v = selectVisibleHelpers(helpers(1000, 2), 10, 77);
    expect(v[0].mine && v[1].mine).toBe(true);
  });
  it("rotates which other supporters are shown", () => {
    const a = selectVisibleHelpers(helpers(100), 10, 0).map((h) => h.id);
    const b = selectVisibleHelpers(helpers(100), 10, 1).map((h) => h.id);
    expect(a).not.toEqual(b);
  });
  it("shows everyone when there is room", () => {
    expect(selectVisibleHelpers(helpers(6, 1), 24, 3)).toHaveLength(6);
  });
  it("adapts quality to frame rate", () => {
    expect(adaptCap(24, 25, 24)).toBe(12);
    expect(adaptCap(12, 60, 24)).toBe(14);
    expect(adaptCap(4, 10, 24)).toBe(4);
  });
});

describe("parcels are a view of real yield", () => {
  it("derive only from eligible yield, capped for the screen", () => {
    expect(parcelCount(0n, 1000n)).toBe(0);
    expect(parcelCount(5_500n, 1000n)).toBe(5);
    expect(parcelCount(10_000_000n, 1000n)).toBe(24);
  });
});

describe("animal art", () => {
  it("every animal renders in every frame with valid shapes", () => {
    for (const a of ANIMAL_LIST)
      for (const f of [0, 1, 2, 3]) {
        const shapes = animalShapes(a, f);
        expect(shapes.length).toBeGreaterThan(10);
        for (const s of shapes) if (s.t === "poly") expect(s.pts.length % 2).toBe(0);
      }
  });
});
