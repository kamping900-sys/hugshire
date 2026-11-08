/**
 * World art. Every sprite is requested by key from the TextureBank:
 *   1. if /game/sprites/manifest.json lists the key, the PNG is used (final / generated art);
 *   2. otherwise a code-drawn placeholder is baked once and cached.
 * Swapping art never touches the engine.
 */
import { Assets, Container, Graphics, Matrix, Texture, type Renderer } from "pixi.js";
import { drawShapes } from "../art";
import { CELL, G, TILE_CELLS, TILE_PX, type Decal, type PropKind, type TileData } from "./gen";
import { mascotShapes, type Mascot } from "./mascots";

export type Baked = { tex: Texture; ax: number; ay: number; scale: number; art?: boolean };
export type Manifest = Record<string, { file: string; ax?: number; ay?: number; width?: number }>;
export type GroundTextures = Partial<Record<"grass" | "path" | "plaza" | "water", Texture>>;
/** World pixels per repeat of a ground texture; divides TILE_PX so the pattern is seamless across tiles. */
const GROUND_PERIOD = 320;

const OUT = "#6B4A33";
const ROOFS = ["#E46F3E", "#D85E55", "#C98A4B", "#8F7BB5", "#5E9C8F"];

type G2 = Graphics;
const shadow = (g: G2, w: number) => g.ellipse(0, 0, w, w * 0.28).fill({ color: "#3A2A22", alpha: 0.14 });
const line = { color: OUT, width: 2, alpha: 0.85 };

/** Generic cozy building: walls (w×h px) with a pitched roof; origin = bottom centre. */
function house(g: G2, w: number, h: number, wall: string, roof: string, roofH = w * 0.42) {
  shadow(g, w * 0.62);
  g.roundRect(-w / 2, -h, w, h, 5).fill(wall).stroke(line);
  g.poly([-w / 2 - 8, -h + 4, 0, -h - roofH, w / 2 + 8, -h + 4]).fill(roof).stroke(line);
  g.poly([-w / 2 - 8, -h + 4, 0, -h - roofH, 0, -h - roofH + 8, -w / 2 + 2, -h + 4]).fill({ color: "#FFFFFF", alpha: 0.16 });
}
function door(g: G2, x: number, w = 14, h = 22, c = "#A9714A") {
  g.roundRect(x - w / 2, -h, w, h, 4).fill(c).stroke(line);
  g.circle(x + w / 4, -h / 2, 1.4).fill("#F6D27A");
}
function win(g: G2, x: number, y: number, w = 14, h = 12) {
  g.roundRect(x - w / 2, y - h / 2, w, h, 3).fill("#FFE6A8").stroke({ color: OUT, width: 1.5 });
  g.rect(x - 0.75, y - h / 2, 1.5, h).fill(OUT);
}
const heart = (g: G2, x: number, y: number, r: number, c: string) => {
  g.circle(x - r * 0.55, y, r * 0.62).fill(c);
  g.circle(x + r * 0.55, y, r * 0.62).fill(c);
  g.poly([x - r * 1.12, y + r * 0.2, x, y + r * 1.25, x + r * 1.12, y + r * 0.2]).fill(c);
};

function tree(g: G2, c: string, c2: string, r = 18) {
  shadow(g, r);
  g.roundRect(-3.5, -16, 7, 16, 2).fill("#9A6B45");
  g.circle(0, -r - 12, r).fill(c);
  g.circle(-r * 0.6, -r - 4, r * 0.62).fill(c);
  g.circle(r * 0.6, -r - 5, r * 0.62).fill(c);
  g.circle(-r * 0.25, -r - 18, r * 0.45).fill(c2);
  g.circle(r * 0.35, -r - 10, r * 0.25).fill({ color: "#FFFFFF", alpha: 0.12 });
}

export function drawWorldProp(k: PropKind, v: number): G2 {
  const g = new Graphics();
  switch (k) {
    case "tree": tree(g, ["#86C27F", "#79B873", "#93C985"][v % 3], "#A5D597"); break;
    case "blossom": tree(g, ["#F7B6C8", "#F5A3BB", "#FAC7D4"][v % 3], "#FFDCE6"); break;
    case "pine":
      shadow(g, 13);
      g.rect(-3, -10, 6, 10).fill("#8D6240");
      g.poly([0, -52, 15, -24, -15, -24]).fill("#5E9F78");
      g.poly([0, -40, 18, -10, -18, -10]).fill("#69AE84");
      g.poly([0, -52, 15, -24, 0, -28]).fill({ color: "#FFFFFF", alpha: 0.1 });
      break;
    case "bush":
      shadow(g, 13);
      g.circle(-7, -8, 8).fill("#7DB874");
      g.circle(6, -9, 9).fill("#8CC683");
      g.circle(0, -14, 8).fill("#96CD8B");
      if (v % 2) for (const [x, y] of [[-6, -13], [4, -16], [7, -7]]) g.circle(x, y, 1.8).fill("#F7A6B8");
      break;
    case "flowers":
      for (const [x, y, c] of [[-6, -3, "#F7A6B8"], [2, -6, "#F6C76C"], [7, -1, "#FFFFFF"], [-1, 1, "#C9A7F0"]] as const) {
        g.rect(x - 0.6, y, 1.2, 5).fill("#6FAE7A");
        g.circle(x, y, 2.8).fill(c);
        g.circle(x, y, 1).fill("#F6C76C");
      }
      break;
    case "rock":
      shadow(g, 12);
      g.poly([-12, 0, -10, -9, -3, -14, 7, -12, 12, -5, 11, 0]).fill("#BDB4AA").stroke({ color: "#958B80", width: 1.5 });
      g.poly([-5, -11, 4, -13, 7, -9, -2, -8]).fill("#D6CEC5");
      break;
    case "rockBig":
      shadow(g, 22);
      g.poly([-22, 0, -19, -18, -6, -28, 12, -25, 21, -12, 20, 0]).fill("#B3AA9F").stroke({ color: "#8D8378", width: 2 });
      g.poly([-9, -24, 8, -26, 13, -18, -3, -16]).fill("#CFC7BE");
      break;
    case "stump":
      shadow(g, 10);
      g.ellipse(0, -4, 9, 5).fill("#9A6B45");
      g.ellipse(0, -6.5, 7, 3.5).fill("#D9B48A");
      break;
    case "mushroom":
      g.rect(-1.5, -6, 3, 6).fill("#F5EBDD");
      g.ellipse(0, -7, 6, 4).fill("#E2523F");
      g.circle(-2, -8, 1).fill("#FFFFFF");
      g.circle(2, -7, 0.9).fill("#FFFFFF");
      break;
    case "reeds":
      for (const x of [-5, -1, 3, 6]) {
        g.rect(x - 0.7, -18 + Math.abs(x), 1.4, 18 - Math.abs(x)).fill("#6E9E5E");
        g.ellipse(x, -18 + Math.abs(x), 1.6, 3.6).fill("#8D6240");
      }
      break;
    case "townHall": {
      const w = 220;
      shadow(g, 130);
      g.roundRect(-w / 2, -96, w, 96, 6).fill("#FFF4E4").stroke(line);
      g.poly([-w / 2 - 10, -92, -w / 2 + 30, -130, w / 2 - 30, -130, w / 2 + 10, -92]).fill("#D85E55").stroke(line);
      g.roundRect(-34, -168, 68, 80, 4).fill("#FFF4E4").stroke(line);
      g.poly([-42, -164, 0, -210, 42, -164]).fill("#C94E46").stroke(line);
      g.circle(0, -138, 17).fill("#FFFFFF").stroke({ color: OUT, width: 3 });
      g.rect(-1.5, -150, 3, 13).fill(OUT);
      g.rect(-1.5, -139.5, 10, 3).fill(OUT);
      g.rect(-1, -236, 2, 28).fill(OUT);
      g.poly([1, -236, 26, -229, 1, -221]).fill("#F58A3C");
      heart(g, 11, -230, 3.5, "#FFFFFF");
      door(g, 0, 26, 40);
      for (const x of [-80, -50, 50, 80]) win(g, x, -54, 18, 20);
      for (const x of [-60, 60]) g.rect(x - 4, -96, 8, 96).fill({ color: "#E9DCCB", alpha: 0.9 });
      break;
    }
    case "barn":
      house(g, 160, 92, "#D9574B", "#8E3B33", 60);
      g.rect(-34, -70, 68, 70).fill("#B8453B").stroke(line);
      g.moveTo(-34, -70).lineTo(34, 0).moveTo(34, -70).lineTo(-34, 0).stroke({ color: "#F5EBDD", width: 3 });
      g.circle(0, -112, 13).fill("#FFF4E4").stroke(line);
      g.circle(-5, -115, 3).fill(OUT);
      g.circle(5, -115, 3).fill(OUT);
      g.circle(-8, -109, 2.4).fill(OUT);
      g.circle(8, -109, 2.4).fill(OUT);
      g.ellipse(0, -107, 4.5, 3.5).fill(OUT);
      break;
    case "greenhouse":
      shadow(g, 110);
      g.roundRect(-90, -78, 180, 78, 8).fill({ color: "#D9F0EC", alpha: 0.95 }).stroke(line);
      g.poly([-96, -74, 0, -122, 96, -74]).fill({ color: "#C6E9E3", alpha: 0.95 }).stroke(line);
      for (let x = -70; x <= 70; x += 28) g.rect(x - 1.5, -78, 3, 78).fill("#FFFFFF");
      for (let x = -78; x <= 78; x += 26) {
        g.circle(x, -16, 9).fill("#7DB874");
        g.circle(x + 6, -30, 7).fill("#8CC683");
        g.circle(x - 2, -22, 2.4).fill(["#F7A6B8", "#F6C76C", "#E2523F"][Math.abs(x) % 3]);
      }
      door(g, 0, 22, 36, "#7FB6A8");
      break;
    case "windmill":
      shadow(g, 60);
      g.poly([-40, 0, -26, -132, 26, -132, 40, 0]).fill("#F6E7D2").stroke(line);
      g.poly([-34, -128, 0, -170, 34, -128]).fill("#C98A4B").stroke(line);
      door(g, 0, 22, 34);
      win(g, 0, -80);
      break;
    case "clinic":
      house(g, 160, 92, "#FFF7F3", "#F09AAE", 54);
      g.roundRect(-18, -150, 36, 36, 8).fill("#FFFFFF").stroke(line);
      g.rect(-4, -144, 8, 24).fill("#E2523F");
      g.rect(-12, -136, 24, 8).fill("#E2523F");
      door(g, 0, 26, 36, "#F09AAE");
      for (const x of [-52, 52]) win(g, x, -56, 22, 18);
      break;
    case "school":
      house(g, 220, 96, "#FFF0DC", "#E46F3E", 58);
      g.roundRect(-16, -176, 32, 30, 4).fill("#FFF0DC").stroke(line);
      g.poly([-22, -172, 0, -196, 22, -172]).fill("#C95A30").stroke(line);
      g.ellipse(0, -158, 7, 8).fill("#F6C76C").stroke({ color: OUT, width: 1.5 });
      door(g, 0, 28, 42);
      for (const x of [-80, -46, 46, 80]) win(g, x, -56, 20, 20);
      break;
    case "bookshop":
      house(g, 108, 82, "#3F7F72", "#7A4B35", 34);
      g.roundRect(-46, -50, 92, 14, 4).fill("#E2523F");
      for (let x = -42; x < 46; x += 14) g.rect(x, -50, 7, 14).fill("#FFF4E4");
      // open book on the roof
      g.poly([-40, -128, -2, -118, -2, -86, -40, -96]).fill("#FFFBF2").stroke(line);
      g.poly([40, -128, 2, -118, 2, -86, 40, -96]).fill("#FFFBF2").stroke(line);
      for (let i = 0; i < 3; i++) {
        g.rect(-34, -116 + i * 8, 26, 1.6).fill("#B8A48C");
        g.rect(8, -116 + i * 8, 26, 1.6).fill("#B8A48C");
      }
      door(g, 0, 18, 28, "#7A4B35");
      break;
    case "studio":
      house(g, 160, 90, "#F4ECFF", "#8F7BB5", 50);
      g.roundRect(-58, -76, 70, 50, 6).fill("#CFE8F7").stroke(line);
      g.ellipse(42, -128, 20, 15).fill("#F5DDB9").stroke(line);
      for (const [x, y, c] of [[34, -132, "#E2523F"], [44, -136, "#F6C76C"], [52, -128, "#5BA37A"], [40, -122, "#5E8FD9"]] as const) g.circle(x, y, 3.4).fill(c);
      door(g, 40, 22, 34, "#8F7BB5");
      break;
    case "stall": {
      shadow(g, 34);
      const c = ["#E2523F", "#5E9C8F", "#F6C76C"][v % 3];
      g.roundRect(-28, -26, 56, 26, 3).fill("#C98A4B").stroke(line);
      g.rect(-26, -58, 4, 34).fill("#8D6240");
      g.rect(22, -58, 4, 34).fill("#8D6240");
      for (let i = 0; i < 6; i++) g.rect(-32 + i * 11, -66, 11, 14).fill(i % 2 ? "#FFF4E4" : c);
      g.circle(-12, -30, 5).fill("#E2523F");
      g.circle(0, -31, 5).fill("#F6C76C");
      g.circle(12, -30, 5).fill("#86C27F");
      break;
    }
    case "tent":
      shadow(g, 100);
      g.poly([-100, 0, -80, -70, 80, -70, 100, 0]).fill("#FFF4E4").stroke(line);
      for (let i = 0; i < 8; i++) g.poly([-100 + i * 25, 0, -80 + i * 20, -70, -60 + i * 20, -70, -75 + i * 25, 0]).fill(i % 2 ? "#F58A3C" : "#FFF4E4");
      g.poly([-84, -70, 0, -120, 84, -70]).fill("#F58A3C").stroke(line);
      heart(g, 0, -92, 10, "#FFFFFF");
      g.roundRect(-18, -40, 36, 40, 6).fill("#7A4B35");
      break;
    case "lighthouse":
      shadow(g, 26);
      g.poly([-22, 0, -14, -140, 14, -140, 22, 0]).fill("#FFFFFF").stroke(line);
      for (const y of [-30, -80, -125]) g.poly([-21, y + 14, -15 + (y + 140) * 0.0, y, 15, y, 21, y + 14]).fill("#E2523F");
      g.roundRect(-16, -162, 32, 22, 3).fill("#FFE08A").stroke(line);
      g.poly([-20, -160, 0, -184, 20, -160]).fill("#D85E55").stroke(line);
      break;
    case "gazebo":
      shadow(g, 64);
      g.ellipse(0, -6, 60, 14).fill("#E9DCCB").stroke(line);
      for (const x of [-48, -16, 16, 48]) g.rect(x - 3, -70, 6, 64).fill("#FFFFFF").stroke({ color: OUT, width: 1.2 });
      g.poly([-64, -66, 0, -112, 64, -66]).fill("#F7B6C8").stroke(line);
      g.ellipse(0, -66, 64, 8).fill("#F09AAE");
      break;
    case "cottage":
      house(g, 136, 80, "#FFF1E0", "#E46F3E", 52);
      g.rect(36, -136, 14, 30).fill("#9A6B45").stroke(line);
      door(g, -20, 20, 32);
      win(g, 34, -46, 22, 18);
      break;
    case "house":
      house(g, 88, 62, ["#FFF1E0", "#FCE7D8", "#FFF6E8", "#F2ECE2"][v % 4], ROOFS[v % ROOFS.length], 40);
      door(g, 0, 16, 26);
      win(g, -26, -38);
      win(g, 26, -38);
      break;
    case "kennel":
      house(g, 48, 34, "#C98A4B", "#E2523F", 22);
      g.roundRect(-9, -22, 18, 22, 9).fill("#5B3E2B");
      break;
    case "foundation":
      shadow(g, 70);
      g.roundRect(-70, -30, 140, 30, 4).fill("#E7DCCD").stroke(line);
      g.rect(-70, -52, 6, 52).fill("#C9A27A");
      g.rect(64, -52, 6, 52).fill("#C9A27A");
      g.rect(-70, -54, 140, 5).fill("#C9A27A");
      g.roundRect(-30, -16, 22, 12, 2).fill("#D9B48A");
      break;
    case "ruin":
      shadow(g, 60);
      g.rect(-60, -40, 22, 40).fill("#CDBBA7").stroke(line);
      g.rect(-24, -22, 26, 22).fill("#BBA894").stroke(line);
      g.rect(30, -48, 24, 48).fill("#CDBBA7").stroke(line);
      g.poly([-66, 0, -40, -6, 10, -3, 64, 0]).fill("#D7C8B8");
      break;
    case "signNew":
      g.rect(-2, -44, 4, 44).fill("#8D6240");
      g.roundRect(-30, -66, 60, 34, 8).fill("#FFFBF2").stroke({ color: "#F58A3C", width: 3 });
      g.rect(-2.5, -58, 5, 18).fill("#F58A3C");
      g.rect(-9, -51.5, 18, 5).fill("#F58A3C");
      break;
    case "signCause":
      shadow(g, 18);
      g.rect(-2, -40, 4, 40).fill("#8D6240");
      g.roundRect(-22, -62, 44, 28, 6).fill("#FFFBF2").stroke({ color: OUT, width: 2 });
      heart(g, 0, -50, 7, "#F58A3C");
      break;
    case "fountain":
      shadow(g, 56);
      g.ellipse(0, -14, 56, 22).fill("#D8CFC3").stroke(line);
      g.ellipse(0, -18, 46, 16).fill("#8FCDE8");
      g.rect(-6, -54, 12, 38).fill("#D8CFC3").stroke(line);
      g.ellipse(0, -54, 20, 7).fill("#D8CFC3").stroke(line);
      g.ellipse(0, -56, 15, 4.5).fill("#A9DCF0");
      for (const [x, y] of [[-10, -64], [0, -70], [10, -64]]) g.circle(x, y, 2.5).fill({ color: "#FFFFFF", alpha: 0.85 });
      break;
    case "lamp":
      shadow(g, 7);
      g.rect(-2, -44, 4, 44).fill("#5B4636");
      g.roundRect(-7, -56, 14, 14, 4).fill("#FFE08A").stroke({ color: "#5B4636", width: 2 });
      break;
    case "bench":
      shadow(g, 26);
      g.roundRect(-26, -16, 52, 6, 2).fill("#C98A4B").stroke({ color: OUT, width: 1.2 });
      g.roundRect(-26, -26, 52, 6, 2).fill("#C98A4B").stroke({ color: OUT, width: 1.2 });
      g.rect(-22, -10, 4, 10).fill("#7A4B35");
      g.rect(18, -10, 4, 10).fill("#7A4B35");
      break;
    case "fenceH":
      g.rect(-16, -14, 32, 3).fill("#E2C49B");
      g.rect(-16, -8, 32, 3).fill("#E2C49B");
      g.rect(-15, -18, 4, 18).fill("#C9A27A");
      break;
    case "fenceV":
      g.rect(-2, -30, 4, 30).fill("#C9A27A");
      g.rect(-1, -32, 2, 4).fill("#E2C49B");
      break;
    case "hay":
      shadow(g, 16);
      g.roundRect(-15, -22, 30, 22, 6).fill("#EBC66A").stroke({ color: "#B9913A", width: 1.5 });
      g.rect(-15, -14, 30, 2).fill("#C9A04A");
      break;
    case "scarecrow":
      g.rect(-2, -48, 4, 48).fill("#8D6240");
      g.rect(-20, -38, 40, 4).fill("#8D6240");
      g.circle(0, -52, 9).fill("#F5DDB9");
      g.poly([-14, -56, 0, -70, 14, -56]).fill("#C98A4B");
      g.roundRect(-11, -42, 22, 20, 4).fill("#5E8FD9");
      break;
    case "easel":
      g.poly([-10, 0, 0, -44, 10, 0]).stroke({ color: "#8D6240", width: 3 });
      g.roundRect(-14, -40, 28, 22, 2).fill("#FFFFFF").stroke({ color: OUT, width: 1.5 });
      g.circle(-5, -30, 4).fill(["#F7A6B8", "#86C27F", "#5E8FD9", "#F6C76C"][v % 4]);
      g.circle(5, -27, 3).fill("#F58A3C");
      break;
    case "boxes":
      shadow(g, 18);
      g.roundRect(-16, -18, 18, 18, 2).fill("#D9A866").stroke({ color: OUT, width: 1.5 });
      g.roundRect(2, -14, 14, 14, 2).fill("#E5B97A").stroke({ color: OUT, width: 1.5 });
      g.roundRect(-10, -32, 16, 14, 2).fill("#F6C76C").stroke({ color: OUT, width: 1.5 });
      heart(g, -2, -26, 3, "#E2523F");
      break;
    case "well":
      shadow(g, 18);
      g.ellipse(0, -8, 16, 9).fill("#BDB3A8").stroke(line);
      g.ellipse(0, -10, 11, 5).fill("#7FB6D6");
      g.rect(-14, -36, 3, 26).fill("#9A6B45");
      g.rect(11, -36, 3, 26).fill("#9A6B45");
      g.poly([-20, -34, 0, -48, 20, -34]).fill("#E46F3E").stroke(line);
      break;
    case "flag":
      g.rect(-1.5, -64, 3, 64).fill("#6B4A33");
      g.poly([1.5, -64, 30, -56, 1.5, -46]).fill("#F58A3C");
      heart(g, 12, -57, 3.5, "#FFFFFF");
      break;
  }
  return g;
}

/** Ground + flat decals for one tile, drawn into a Graphics (baked to a texture by the engine). */
export function drawTileGround(t: TileData, detail = true, gt: GroundTextures = {}): Graphics {
  const g = new Graphics();
  const ox = t.tx * TILE_PX, oy = t.ty * TILE_PX;
  const civ = !!t.cause || t.kind === "expansion";
  const base = t.kind === "forest" ? "#B5D9A0" : t.kind === "hills" ? "#C7DCA6" : civ ? "#C9E5B2" : "#BFE0A6";
  const texFill = (tex: Texture | undefined) =>
    tex ? { texture: tex, matrix: new Matrix().scale(GROUND_PERIOD / tex.width, GROUND_PERIOD / tex.height), textureSpace: "global" as const } : null;
  const grass = texFill(gt.grass);
  g.rect(0, 0, TILE_PX, TILE_PX).fill(grass ?? base);
  if (grass && t.kind === "forest") g.rect(0, 0, TILE_PX, TILE_PX).fill({ color: "#5E9F78", alpha: 0.12 });
  if (detail && !grass) {
    // soft grass texture, deterministic
    let s = (t.tx * 73856093) ^ (t.ty * 19349663);
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 70; i++) g.circle(rnd() * TILE_PX, rnd() * TILE_PX, 6 + rnd() * 18).fill({ color: "#FFFFFF", alpha: 0.05 });
    for (let i = 0; i < 90; i++) {
      const x = rnd() * TILE_PX, y = rnd() * TILE_PX;
      g.moveTo(x, y).lineTo(x + 2, y - 5).moveTo(x + 3, y).lineTo(x + 4, y - 4).stroke({ color: "#8FC27E", width: 1.4, alpha: 0.7 });
    }
  }
  const at = (x: number, y: number) => t.ground[y * TILE_CELLS + x];
  const C: Record<number, string> = { [G.ROAD]: "#EBD7B5", [G.WATER]: "#8ECFE6", [G.SOIL]: "#B9875A", [G.PLAZA]: "#EFE2CC", [G.SAND]: "#F3E3C3", [G.DIRT]: "#DCCBA6", [G.PLANK]: "#C69A6A" };
  for (let y = 0; y < TILE_CELLS; y++)
    for (let x = 0; x < TILE_CELLS; x++) {
      const c = at(x, y);
      if (c === G.GRASS) continue;
      const tf = c === G.WATER ? texFill(gt.water) : c === G.PLAZA ? texFill(gt.plaza) : c === G.ROAD || c === G.DIRT || c === G.SAND || c === G.SOIL ? texFill(gt.path) : null;
      // paved cells are square so neighbours join without grass showing through the corners
      const r = c === G.WATER ? 10 : tf || c === G.PLAZA || c === G.ROAD ? 0 : 6;
      const pad = c === G.WATER ? 2 : 0;
      g.roundRect(x * CELL - pad, y * CELL - pad, CELL + pad * 2, CELL + pad * 2, r).fill(tf ?? C[c]);
      if (tf && c === G.SAND) g.rect(x * CELL, y * CELL, CELL, CELL).fill({ color: "#FFF3D6", alpha: 0.35 });
      if (tf && c === G.SOIL) g.rect(x * CELL, y * CELL, CELL, CELL).fill({ color: "#6B3E1E", alpha: 0.45 });
      if (tf && c === G.DIRT) g.rect(x * CELL, y * CELL, CELL, CELL).fill({ color: "#8A6448", alpha: 0.08 });
      if (c === G.PLANK) g.rect(x * CELL, y * CELL + 15, CELL, 2).fill("#9C7148");
      if (c === G.PLAZA && detail && !gt.plaza && (x + y) % 2 === 0) g.roundRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6, 3).fill({ color: "#FFFFFF", alpha: 0.25 });
    }
  if (detail) {
    // road edge stones and centre dashes
    for (let y = 0; y < TILE_CELLS; y++)
      for (let x = 0; x < TILE_CELLS; x++)
        if (at(x, y) === G.ROAD && ((x === 0 && y > 1) || (y === 0 && x > 1)) && (x + y) % 3 === 0)
          g.roundRect(x * CELL + (y === 0 ? 8 : 26), y * CELL + (y === 0 ? 26 : 8), y === 0 ? 14 : 4, y === 0 ? 4 : 14, 2).fill({ color: "#FFFFFF", alpha: 0.55 });
    // water shine
    for (let y = 0; y < TILE_CELLS; y++)
      for (let x = 0; x < TILE_CELLS; x++)
        if (at(x, y) === G.WATER && (x * 7 + y * 3) % 5 === 0) g.moveTo(x * CELL + 6, y * CELL + 14).quadraticCurveTo(x * CELL + 12, y * CELL + 10, x * CELL + 18, y * CELL + 14).stroke({ color: "#FFFFFF", width: 2, alpha: 0.5 });
  }
  for (const d of t.decals) drawDecal(g, d, d.x - ox, d.y - oy);
  return g;
}

function drawDecal(g: Graphics, d: Decal, x: number, y: number) {
  switch (d.k) {
    case "crops":
      for (let i = 0; i < 3; i++) {
        const cx = x + 6 + i * 10, cy = y + 16;
        g.ellipse(cx, cy, 4, 6).fill(["#7DB874", "#9BCF7E", "#86C27F"][d.v]);
        if (d.v === 1) g.circle(cx, cy - 5, 2.2).fill("#F08A3E");
        if (d.v === 2) g.circle(cx, cy - 4, 1.8).fill("#E2523F");
      }
      break;
    case "picnic":
      g.roundRect(x, y, 64, 44, 4).fill(d.v ? "#F7B6C8" : "#F58A3C");
      for (let i = 0; i < 4; i++) g.rect(x + i * 16, y, 8, 44).fill({ color: "#FFFFFF", alpha: 0.45 });
      g.circle(x + 18, y + 18, 6).fill("#C98A4B");
      break;
    case "lily":
      g.circle(x + 12, y + 12, 8).fill("#7DB874");
      g.circle(x + 15, y + 10, 3).fill("#F7B6C8");
      break;
    case "dash":
      for (let i = 0; i < 15 * 4; i++) {
        const side = Math.floor(i / 15), k = i % 15;
        const px = side === 0 ? k * 32 : side === 1 ? 480 : side === 2 ? 480 - k * 32 : 0;
        const py = side === 0 ? 0 : side === 1 ? k * 32 : side === 2 ? 480 : 480 - k * 32;
        g.roundRect(x + px + 4, y + py - 2, side % 2 ? 4 : 16, side % 2 ? 16 : 4, 2).fill({ color: "#FFFFFF", alpha: 0.9 });
      }
      break;
    default:
      break;
  }
}

/** Texture cache: manifest PNGs first, code-drawn placeholders otherwise. */
export class WorldTextures {
  private cache = new Map<string, Baked>();
  private manifest: Manifest = {};
  ground: GroundTextures = {};
  constructor(private renderer: Renderer) {}

  async loadManifest(url = "/game/sprites/manifest.json") {
    try {
      const r = await fetch(url, { cache: "no-cache" });
      if (!r.ok) return;
      this.manifest = (await r.json()) as Manifest;
      await Promise.all(
        Object.entries(this.manifest).map(async ([k, m]) => {
          const tex = (await Assets.load(`/game/sprites/${m.file}`)) as Texture;
          if (k.startsWith("ground:")) {
            tex.source.addressMode = "repeat";
            this.ground[k.slice(7) as keyof GroundTextures] = tex;
            return;
          }
          const scale = m.width ? m.width / tex.width : 1;
          tex.source.scaleMode = "linear";
          this.cache.set(k, { tex, ax: m.ax ?? 0.5, ay: m.ay ?? 0.94, scale, art: true });
        }),
      );
    } catch {
      /* no generated art yet: placeholders are used */
    }
  }

  private bake(k: string, make: () => Container, origin = { x: 0, y: 0 }, resolution = 2): Baked {
    let b = this.cache.get(k);
    if (b) return b;
    const c = make();
    const lb = c.getLocalBounds();
    const tex = this.renderer.generateTexture({ target: c, resolution, antialias: true });
    c.destroy({ children: true });
    b = { tex, ax: (origin.x - lb.x) / lb.width, ay: (origin.y - lb.y) / lb.height, scale: 1 };
    this.cache.set(k, b);
    return b;
  }

  prop(k: PropKind, v: number) {
    return this.cache.get(`prop:${k}:${v}`) ?? this.cache.get(`prop:${k}`) ?? this.bake(`prop:${k}:${v}`, () => drawWorldProp(k, v));
  }
  /** Generated art has one image per pose (front / side / back); the engine adds a walking bob. */
  mascot(m: Mascot, frame: number, back: boolean, side = false) {
    const pose = back ? "back" : side ? "side" : "front";
    const man = this.cache.get(`mascot:${m}:${pose}`) ?? this.cache.get(`mascot:${m}:front`);
    if (man) return man;
    return this.bake(`m:${m}:${frame}:${back ? 1 : 0}`, () => drawShapes(new Graphics(), mascotShapes(m, frame, back)), { x: 32, y: 68 }, 2);
  }
  parcel() {
    return this.bake("parcel", () => {
      const g = new Graphics();
      g.roundRect(-9, -16, 18, 16, 3).fill("#F6C76C").stroke({ color: OUT, width: 1.5 });
      g.rect(-1.5, -16, 3, 16).fill("#E46F3E");
      heart(g, 0, -20, 3.5, "#E2523F");
      return g;
    });
  }
  truck() {
    return this.cache.get("vehicle:truck") ?? this.bake("truck", () => {
      const g = new Graphics();
      shadow(g, 40);
      g.roundRect(-44, -44, 56, 38, 6).fill("#F6C76C").stroke(line);
      heart(g, -16, -26, 8, "#F58A3C");
      g.roundRect(10, -40, 32, 34, 8).fill("#F58A3C").stroke(line);
      g.roundRect(20, -36, 18, 14, 4).fill("#CFE8F7").stroke({ color: OUT, width: 1.5 });
      for (const x of [-28, 26]) {
        g.circle(x, -6, 9).fill("#3A2A22");
        g.circle(x, -6, 4).fill("#D8CFC3");
      }
      return g;
    }, { x: 0, y: 0 });
  }
  sheep() {
    return this.cache.get("animal:sheep") ?? this.bake("sheep", () => {
      const g = new Graphics();
      shadow(g, 12);
      for (const [x, y] of [[-6, -12], [0, -15], [6, -12], [-3, -8], [4, -8]]) g.circle(x, y, 7).fill("#FFFFFF");
      g.ellipse(10, -12, 5, 6).fill("#3A2A22");
      g.rect(-6, -4, 3, 5).fill("#3A2A22");
      g.rect(4, -4, 3, 5).fill("#3A2A22");
      return g;
    });
  }
  destroy() {
    for (const b of this.cache.values()) b.tex.destroy(true);
    this.cache.clear();
  }
}
