/**
 * Original Hugshire helper art, defined once as simple shapes and rendered both as SVG (DOM)
 * and as PixiJS textures (game), so the two always match. Placeholder until final mascot art.
 * Canvas: 64 × 64, chibi three-quarter top-down view.
 */
export const ANIMAL_LIST = ["cat", "bunny", "otter", "fox", "bear", "dog", "raccoon", "capybara"] as const;
export type AnimalKind = (typeof ANIMAL_LIST)[number];

export type Shape =
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill: string }
  | { t: "poly"; pts: number[]; fill: string };

type Spec = {
  label: string;
  blurb: string;
  body: string;
  belly: string;
  ear: "pointy" | "long" | "round" | "tiny" | "floppy";
  earInner: string;
  earColor?: string;
  tail: "thin" | "puff" | "flat" | "fluffy" | "stub" | "ringed" | "none" | "wag";
  tailColor?: string;
  mask?: string;
  muzzle?: string;
};

export const ANIMALS: Record<AnimalKind, Spec> = {
  cat: { label: "Cat", blurb: "Curious and tidy, always first to the build site.", body: "#F2A65A", belly: "#FFE7CF", ear: "pointy", earInner: "#FFC9A8", tail: "thin" },
  bunny: { label: "Bunny", blurb: "Quick hops, quicker deliveries.", body: "#F5EDE3", belly: "#FFFFFF", ear: "long", earInner: "#FFC2C8", tail: "puff", tailColor: "#FFFFFF" },
  otter: { label: "Otter", blurb: "Loves rivers, roads and holding paws.", body: "#A8734D", belly: "#EBD2B4", ear: "tiny", earInner: "#8A5B3B", tail: "flat" },
  fox: { label: "Fox", blurb: "Clever planner with a very warm tail.", body: "#EE7B3A", belly: "#FFF4E8", ear: "pointy", earInner: "#3B2A22", tail: "fluffy", tailColor: "#EE7B3A" },
  bear: { label: "Bear", blurb: "Strong hugs, stronger beams.", body: "#8C5A3C", belly: "#CFA27C", ear: "round", earInner: "#C08A63", tail: "stub", muzzle: "#D9B494" },
  dog: { label: "Dog", blurb: "Loyal, cheerful, never misses a delivery.", body: "#DDA56B", belly: "#FFF1DF", ear: "floppy", earInner: "#9C6B3F", earColor: "#9C6B3F", tail: "wag" },
  raccoon: { label: "Raccoon", blurb: "Finds treasure in every pile of rubble.", body: "#9C9AA0", belly: "#E7E3E0", ear: "round", earInner: "#5B5960", tail: "ringed", mask: "#4D4A52" },
  capybara: { label: "Capybara", blurb: "Unbothered, kind, gets along with everyone.", body: "#B4835A", belly: "#D2A77F", ear: "tiny", earInner: "#8D6342", tail: "none", muzzle: "#9A6E4A" },
};

const INK = "#2B241E";
const BLUSH = "#FF9E8A";

/** frame 0/1 = idle bob, 2/3 = walk steps */
export function animalShapes(kind: AnimalKind, frame = 0): Shape[] {
  const s = ANIMALS[kind];
  const bob = frame % 2 === 1 ? 1.2 : 0;
  const step = frame >= 2 ? (frame === 2 ? 2 : -2) : 0;
  const out: Shape[] = [];
  const E = (cx: number, cy: number, rx: number, ry: number, fill: string) => out.push({ t: "ellipse", cx, cy, rx, ry, fill });
  const P = (pts: number[], fill: string) => out.push({ t: "poly", pts, fill });

  // shadow
  E(32, 57, 15, 4, "rgba(43,36,30,0.16)");

  // tail (behind body)
  const tc = s.tailColor ?? s.body;
  switch (s.tail) {
    case "thin": P([44, 46, 54, 36, 57, 38, 47, 49], tc); E(55.5, 36.5, 2.2, 2.2, tc); break;
    case "puff": E(46, 49, 4.5, 4.5, tc); break;
    case "flat": P([42, 50, 55, 54, 56, 57, 41, 54], tc); break;
    case "fluffy": E(48, 44, 7, 9, tc); E(51, 37, 3.6, 3.6, "#FFF4E8"); break;
    case "stub": E(45, 50, 3, 3, s.body); break;
    case "ringed": E(48, 44, 5, 9, s.body); E(48, 41, 5, 1.6, s.mask ?? INK); E(48, 46, 5, 1.6, s.mask ?? INK); E(48, 51, 4.5, 1.4, s.mask ?? INK); break;
    case "wag": P([44, 47, 53, 38 + step, 55, 40 + step, 46, 50], tc); break;
    case "none": break;
  }

  // feet
  E(25 - step * 0.5, 54, 4.5, 3, s.body);
  E(39 + step * 0.5, 54, 4.5, 3, s.body);
  // body
  E(32, 45 + bob * 0.3, 13, 11, s.body);
  E(32, 47 + bob * 0.3, 8.5, 7, s.belly);
  // arms
  E(20.5, 45 + bob * 0.3, 3.2, 4.5, s.body);
  E(43.5, 45 + bob * 0.3, 3.2, 4.5, s.body);

  const hy = 27 + bob;
  // ears (behind head)
  const ec = s.earColor ?? s.body;
  switch (s.ear) {
    case "pointy":
      P([18, hy - 4, 21, hy - 18, 29, hy - 9], ec);
      P([46, hy - 4, 43, hy - 18, 35, hy - 9], ec);
      P([21, hy - 7, 22.5, hy - 14, 27, hy - 9], s.earInner);
      P([43, hy - 7, 41.5, hy - 14, 37, hy - 9], s.earInner);
      break;
    case "long":
      E(25, hy - 15, 4, 11, ec);
      E(39, hy - 15, 4, 11, ec);
      E(25, hy - 15, 2, 8, s.earInner);
      E(39, hy - 15, 2, 8, s.earInner);
      break;
    case "round":
      E(20.5, hy - 9, 5, 5, ec);
      E(43.5, hy - 9, 5, 5, ec);
      E(20.5, hy - 9, 2.6, 2.6, s.earInner);
      E(43.5, hy - 9, 2.6, 2.6, s.earInner);
      break;
    case "tiny":
      E(21.5, hy - 8.5, 3, 2.6, ec);
      E(42.5, hy - 8.5, 3, 2.6, ec);
      break;
    case "floppy":
      break; // drawn after the head
  }
  // head
  E(32, hy, 14.5, 12.5, s.body);
  if (s.ear === "floppy") {
    E(18.5, hy + 1, 4, 8, ec);
    E(45.5, hy + 1, 4, 8, ec);
  }
  if (s.mask) {
    E(25.5, hy + 0.5, 5.5, 3.8, s.mask);
    E(38.5, hy + 0.5, 5.5, 3.8, s.mask);
  }
  const mz = s.muzzle ?? s.belly;
  E(32, hy + 5, 6.5, 4.5, mz);
  // eyes
  E(26, hy, 1.9, 2.2, INK);
  E(38, hy, 1.9, 2.2, INK);
  E(26.6, hy - 0.8, 0.6, 0.6, "#FFFFFF");
  E(38.6, hy - 0.8, 0.6, 0.6, "#FFFFFF");
  // nose & blush
  E(32, hy + 3.4, 1.7, 1.2, INK);
  E(21.5, hy + 4.5, 2.4, 1.4, BLUSH);
  E(42.5, hy + 4.5, 2.4, 1.4, BLUSH);
  return out;
}

/** Deterministic friendly nickname suggestion. */
export function suggestNickname(kind: AnimalKind, seed: number) {
  const names: Record<AnimalKind, string[]> = {
    cat: ["Miso", "Biscuit", "Clementine", "Pepper"],
    bunny: ["Clover", "Juniper", "Mochi", "Bean"],
    otter: ["Pebble", "Ripple", "Pip", "Maple"],
    fox: ["Ember", "Saffron", "Rusty", "Juno"],
    bear: ["Bramble", "Honey", "Moss", "Barley"],
    dog: ["Waffles", "Sunny", "Noodle", "Toffee"],
    raccoon: ["Bandit", "Nibbles", "Tinker", "Dusk"],
    capybara: ["Yuzu", "Chill", "Tofu", "Lotus"],
  };
  const list = names[kind];
  return list[Math.abs(seed) % list.length];
}
