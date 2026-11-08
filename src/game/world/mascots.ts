/**
 * The eight Hugshire helpers, drawn as shapes so they can animate and tint cheaply.
 * Style follows the mascot sheet: chibi head, aviator cap with goggles, red bandana.
 * Placeholder until final sprite art; the engine only needs `mascotShapes`.
 * Canvas 64×72, feet at (32, 68).
 */
import type { Shape } from "@/lib/animals";

export const MASCOTS = ["cat", "dog", "rabbit", "otter", "panda", "fox", "raccoon", "bird"] as const;
export type Mascot = (typeof MASCOTS)[number];

export const MASCOT_LABEL: Record<Mascot, string> = {
  cat: "Cat", dog: "Dog", rabbit: "Rabbit", otter: "Otter", panda: "Panda", fox: "Fox", raccoon: "Raccoon", bird: "Bird",
};

type Spec = {
  fur: string;
  face: string; // muzzle / face patch
  ear: "cat" | "flop" | "long" | "round" | "fox" | "none";
  earIn: string;
  earFur?: string;
  tail: "curl" | "wag" | "puff" | "flat" | "none" | "fluff" | "ring" | "wing";
  patch?: string; // eye patches (panda, raccoon)
  beak?: boolean;
};

const S: Record<Mascot, Spec> = {
  cat: { fur: "#F4A64C", face: "#FFF3E2", ear: "cat", earIn: "#FFC2A1", tail: "curl" },
  dog: { fur: "#D9A262", face: "#FFF1DD", ear: "flop", earIn: "#A86E3C", earFur: "#B37A45", tail: "wag" },
  rabbit: { fur: "#FFFBF5", face: "#FFFFFF", ear: "long", earIn: "#FFC4CC", tail: "puff" },
  otter: { fur: "#9C6B48", face: "#E7C7A3", ear: "round", earIn: "#7A5236", tail: "flat" },
  panda: { fur: "#FFFFFF", face: "#FFFFFF", ear: "round", earIn: "#2E2A2A", earFur: "#2E2A2A", tail: "none", patch: "#2E2A2A" },
  fox: { fur: "#F08A3E", face: "#FFF5EA", ear: "fox", earIn: "#3B2A22", tail: "fluff" },
  raccoon: { fur: "#A3A1A8", face: "#ECE8E4", ear: "round", earIn: "#5B5960", tail: "ring", patch: "#4F4C55" },
  bird: { fur: "#FFE07A", face: "#FFF6CF", ear: "none", earIn: "#000", tail: "wing", beak: true },
};

const INK = "#3A2A22";
const CAP = "#C98A4A";
const CAP_DARK = "#A86F36";
const LENS = "#9FD6EE";
const RIM = "#7A5534";
const SCARF = "#E2523F";
const SCARF_DARK = "#BF3E2E";

/**
 * frame: 0/1 idle bob, 2/3 walk steps.
 * back: true draws the helper seen from behind (walking up the screen).
 */
export function mascotShapes(m: Mascot, frame = 0, back = false): Shape[] {
  const s = S[m];
  const out: Shape[] = [];
  const E = (cx: number, cy: number, rx: number, ry: number, fill: string) => out.push({ t: "ellipse", cx, cy, rx, ry, fill });
  const P = (pts: number[], fill: string) => out.push({ t: "poly", pts, fill });
  const bob = frame === 1 ? 1 : 0;
  const step = frame === 2 ? 2.2 : frame === 3 ? -2.2 : 0;

  E(32, 68, 14, 3.6, "rgba(58,42,34,0.18)");

  // tail behind body
  const tailX = back ? 32 : 45;
  switch (s.tail) {
    case "curl": P([tailX - 2, 58, tailX + 9, 49, tailX + 11, 52, tailX + 1, 61], s.fur); E(tailX + 10, 49.5, 2.6, 2.6, s.fur); break;
    case "wag": P([tailX - 2, 58, tailX + 8, 50 + step, tailX + 10, 53 + step, tailX, 61], s.fur); break;
    case "puff": E(back ? 32 : 45, 60, 4.6, 4.6, "#FFFFFF"); break;
    case "flat": P([tailX - 3, 61, tailX + 10, 64, tailX + 10, 67, tailX - 3, 65], s.fur); break;
    case "fluff": E(tailX + 4, 54, 6, 8.5, s.fur); E(tailX + 6, 47.5, 3.4, 3.4, "#FFF5EA"); break;
    case "ring": E(tailX + 4, 55, 5, 8.5, s.fur); for (const y of [51, 56, 61]) E(tailX + 4, y, 5, 1.5, s.patch!); break;
    case "wing": break;
    case "none": break;
  }

  // feet
  E(26 - step * 0.6, 66, 4.6, 2.8, s.ear === "none" ? "#F0A23C" : s.fur === "#FFFFFF" ? "#2E2A2A" : s.fur);
  E(38 + step * 0.6, 66, 4.6, 2.8, s.ear === "none" ? "#F0A23C" : s.fur === "#FFFFFF" ? "#2E2A2A" : s.fur);

  // body
  const by = 57 + bob * 0.3;
  E(32, by, 12.5, 10, s.fur === "#FFFFFF" && m === "panda" ? "#2E2A2A" : s.fur);
  if (!back) E(32, by + 2, 7.5, 6.5, m === "panda" ? "#FFFFFF" : s.face);
  // arms / wings
  const armC = m === "panda" ? "#2E2A2A" : s.fur;
  if (s.tail === "wing") {
    P([19, by - 6, 11, by - 1, 14, by + 4, 21, by + 2], "#F6C84E");
    P([45, by - 6, 53, by - 1, 50, by + 4, 43, by + 2], "#F6C84E");
  } else {
    E(20.5, by + 1, 3.2, 4.4, armC);
    E(43.5, by + 1, 3.2, 4.4, armC);
  }

  // bandana
  if (!back) {
    P([20, by - 9, 44, by - 9, 32, by + 0.5], SCARF);
    P([22, by - 9, 42, by - 9, 41, by - 7, 23, by - 7], SCARF_DARK);
  } else {
    P([21, by - 9, 43, by - 9, 42, by - 6.5, 22, by - 6.5], SCARF);
  }

  const hy = 34 + bob;
  // ears behind head
  const ef = s.earFur ?? s.fur;
  switch (s.ear) {
    case "cat":
      P([17, hy - 4, 19, hy - 17, 28, hy - 9], ef);
      P([47, hy - 4, 45, hy - 17, 36, hy - 9], ef);
      P([19.5, hy - 7, 20.5, hy - 13.5, 26, hy - 9], s.earIn);
      P([44.5, hy - 7, 43.5, hy - 13.5, 38, hy - 9], s.earIn);
      break;
    case "fox":
      P([16, hy - 3, 18, hy - 19, 29, hy - 9], ef);
      P([48, hy - 3, 46, hy - 19, 35, hy - 9], ef);
      P([19, hy - 7, 19.8, hy - 15, 26, hy - 9], s.earIn);
      P([45, hy - 7, 44.2, hy - 15, 38, hy - 9], s.earIn);
      break;
    case "long":
      E(25, hy - 17, 4.2, 11, ef);
      E(39, hy - 17, 4.2, 11, ef);
      E(25, hy - 17, 2.1, 8, s.earIn);
      E(39, hy - 17, 2.1, 8, s.earIn);
      break;
    case "round":
      E(18.5, hy - 9, 5.2, 5.2, ef);
      E(45.5, hy - 9, 5.2, 5.2, ef);
      E(18.5, hy - 9, 2.8, 2.8, s.earIn);
      E(45.5, hy - 9, 2.8, 2.8, s.earIn);
      break;
    case "flop":
    case "none":
      break;
  }

  // head
  E(32, hy, 15.5, 13.5, s.fur);
  if (s.ear === "flop") {
    E(17.5, hy + 1, 4.4, 8.5, ef);
    E(46.5, hy + 1, 4.4, 8.5, ef);
  }
  if (s.ear === "none" && !back) P([30, hy - 13, 32, hy - 19, 34, hy - 13], "#F6C84E"); // bird tuft

  // aviator cap
  E(32, hy - 6, 15.8, 9, CAP);
  P([16.5, hy - 5, 47.5, hy - 5, 46, hy - 1.5, 18, hy - 1.5], CAP_DARK);
  if (!back) {
    // goggles on the cap
    E(26, hy - 8, 4.4, 3.6, RIM);
    E(38, hy - 8, 4.4, 3.6, RIM);
    E(26, hy - 8, 3.1, 2.5, LENS);
    E(38, hy - 8, 3.1, 2.5, LENS);
    E(25, hy - 8.8, 0.9, 0.7, "#FFFFFF");
    E(37, hy - 8.8, 0.9, 0.7, "#FFFFFF");
  } else {
    P([17, hy - 7, 47, hy - 7, 47, hy - 5.5, 17, hy - 5.5], RIM);
    return out;
  }

  // face
  if (s.patch) {
    E(25.5, hy + 3, 4.8, 3.6, s.patch);
    E(38.5, hy + 3, 4.8, 3.6, s.patch);
  }
  E(32, hy + 7, 7, 4.6, s.face);
  E(26, hy + 3, 1.8, 2.1, s.patch ? "#FFFFFF" : INK);
  E(38, hy + 3, 1.8, 2.1, s.patch ? "#FFFFFF" : INK);
  if (s.patch) {
    E(26, hy + 3.2, 1.1, 1.3, INK);
    E(38, hy + 3.2, 1.1, 1.3, INK);
  }
  E(26.6, hy + 2.2, 0.6, 0.6, "#FFFFFF");
  E(38.6, hy + 2.2, 0.6, 0.6, "#FFFFFF");
  if (s.beak) P([29, hy + 6, 35, hy + 6, 32, hy + 9.5], "#F08C2E");
  else {
    E(32, hy + 5.6, 1.7, 1.2, INK);
    P([30, hy + 7.6, 32, hy + 9, 34, hy + 7.6, 32, hy + 8.4], "#C9524A");
  }
  E(21, hy + 7, 2.4, 1.4, "#FF9E8A");
  E(43, hy + 7, 2.4, 1.4, "#FF9E8A");
  return out;
}
