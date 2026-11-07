/**
 * PixiJS drawing helpers and a texture cache ("runtime atlas"): every sprite kind is drawn once
 * with Graphics, baked to a texture, and reused by every Sprite. No per-frame redraws.
 */
import { Container, Graphics, type Renderer, type Texture } from "pixi.js";
import { animalShapes, type AnimalKind, type Shape } from "@/lib/animals";
import type { MapType, PropKind } from "./sim";

function fillOf(c: string): { color: string; alpha: number } {
  const m = c.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!m) return { color: c, alpha: 1 };
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return { color: `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`, alpha: Number(m[4]) };
}

export function drawShapes(g: Graphics, shapes: Shape[], scale = 1) {
  for (const s of shapes) {
    if (s.t === "ellipse") g.ellipse(s.cx * scale, s.cy * scale, s.rx * scale, s.ry * scale).fill(fillOf(s.fill));
    else g.poly(s.pts.map((p) => p * scale)).fill(fillOf(s.fill));
  }
  return g;
}

const ACCENT: Record<MapType, string> = {
  school: "#F6C76C",
  shelter: "#F58A3C",
  nature: "#7CB98E",
  care: "#E98C9A",
  food: "#E8A24E",
  rebuild: "#8FB3D9",
};

const ROOFS = ["#E67624", "#D96B62", "#C98A4B", "#8C6A9E"];

/** Draws a prop into a Graphics at local origin (anchor bottom-centre). */
export function drawProp(kind: PropKind, variant: number, mapType: MapType): Graphics {
  const g = new Graphics();
  const shadow = (w: number) => g.ellipse(0, 0, w, w * 0.32).fill({ color: "#2B241E", alpha: 0.13 });
  switch (kind) {
    case "tree": {
      shadow(15);
      g.roundRect(-3, -14, 6, 14, 2).fill("#9A6B45");
      const c = ["#7FB77E", "#8CC38A", "#6FAE7A"][variant % 3];
      g.circle(0, -26, 15).fill(c);
      g.circle(-9, -20, 9).fill(c);
      g.circle(9, -21, 9).fill(c);
      g.circle(-4, -31, 5).fill({ color: "#FFFFFF", alpha: 0.18 });
      break;
    }
    case "pine":
      shadow(12);
      g.rect(-2.5, -9, 5, 9).fill("#8D6240");
      g.poly([0, -44, 13, -18, -13, -18]).fill("#5F9F78");
      g.poly([0, -34, 15, -8, -15, -8]).fill("#6AAE84");
      break;
    case "rock":
      shadow(14);
      g.poly([-14, 0, -12, -10, -4, -16, 8, -14, 14, -6, 13, 0]).fill("#B9B0A6");
      g.poly([-6, -13, 4, -15, 8, -10, -2, -9]).fill("#D3CBC2");
      break;
    case "ruin":
      shadow(18);
      g.rect(-16, -18, 9, 18).fill("#C9B8A6");
      g.rect(-4, -10, 8, 10).fill("#BBA894");
      g.rect(8, -22, 8, 22).fill("#C9B8A6");
      g.rect(-16, -18, 9, 3).fill("#A99683");
      g.poly([-20, 0, -12, -4, 2, -2, 18, 0]).fill("#D7C8B8");
      break;
    case "stump":
      shadow(10);
      g.ellipse(0, -4, 9, 5).fill("#9A6B45");
      g.ellipse(0, -6, 7, 3.5).fill("#D9B48A");
      break;
    case "foundation":
      shadow(30);
      g.roundRect(-40, -26, 80, 26, 4).fill("#E7DCCD");
      g.roundRect(-36, -23, 72, 20, 3).stroke({ color: "#C9B8A6", width: 2 });
      g.rect(-40, -34, 5, 34).fill("#C9A27A");
      g.rect(35, -34, 5, 34).fill("#C9A27A");
      g.rect(-40, -34, 80, 4).fill("#C9A27A");
      break;
    case "house":
    case "landmark": {
      const big = kind === "landmark";
      const w = big ? 46 : 36;
      shadow(w);
      const wall = big ? "#FFF3E3" : ["#FFF1E0", "#FCE7D8", "#FFF6E8", "#F6EADC"][variant % 4];
      const roof = big ? ACCENT[mapType] : ROOFS[variant % 4];
      g.roundRect(-w, -40, w * 2, 40, 4).fill(wall);
      g.poly([-w - 6, -38, 0, big ? -72 : -64, w + 6, -38]).fill(roof);
      g.poly([-w - 6, -38, 0, big ? -72 : -64, 0, big ? -66 : -58, -w + 2, -38]).fill({ color: "#FFFFFF", alpha: 0.15 });
      g.roundRect(-7, -22, 14, 22, 3).fill("#B9805A");
      g.roundRect(-w + 8, -32, 12, 10, 2).fill("#FFE4A8");
      g.roundRect(w - 20, -32, 12, 10, 2).fill("#FFE4A8");
      if (big) {
        // heart sign over the door of the cause's landmark
        g.circle(-4, -50, 4.5).fill("#FFFFFF");
        g.circle(4, -50, 4.5).fill("#FFFFFF");
        g.poly([-8.5, -48.5, 0, -40, 8.5, -48.5]).fill("#FFFFFF");
      }
      break;
    }
    case "hall":
      shadow(52);
      g.roundRect(-52, -50, 104, 50, 6).fill("#FFF6EC");
      g.poly([-60, -48, 0, -86, 60, -48]).fill("#F58A3C");
      g.roundRect(-10, -30, 20, 30, 4).fill("#B9805A");
      for (const x of [-38, -24, 16, 30]) g.roundRect(x, -40, 10, 12, 2).fill("#FFE4A8");
      g.circle(-5, -66, 5.5).fill("#FFF8F0");
      g.circle(5, -66, 5.5).fill("#FFF8F0");
      g.poly([-10.5, -64, 0, -54, 10.5, -64]).fill("#FFF8F0");
      break;
    case "hall_ruin":
      shadow(46);
      g.roundRect(-46, -14, 92, 14, 3).fill("#E2D4C3");
      g.rect(-46, -36, 10, 36).fill("#CDBBA7");
      g.rect(30, -28, 10, 28).fill("#CDBBA7");
      g.roundRect(-14, -46, 28, 20, 4).fill("#FFF8F0");
      g.roundRect(-14, -46, 28, 20, 4).stroke({ color: "#E67624", width: 2 });
      g.rect(-1.5, -26, 3, 26).fill("#9A6B45");
      g.circle(-3, -38, 3).fill("#F58A3C");
      g.circle(3, -38, 3).fill("#F58A3C");
      g.poly([-6, -37, 0, -31, 6, -37]).fill("#F58A3C");
      break;
    case "depot":
      shadow(28);
      g.roundRect(-30, -20, 60, 20, 4).fill("#D7A774");
      g.roundRect(-30, -20, 60, 5, 2).fill("#B9875A");
      g.rect(-26, -40, 4, 22).fill("#9A6B45");
      g.rect(22, -40, 4, 22).fill("#9A6B45");
      g.roundRect(-30, -46, 60, 8, 3).fill("#F58A3C");
      break;
    case "garden":
      g.roundRect(-14, -8, 28, 10, 3).fill("#B98A5E");
      for (const x of [-9, -3, 3, 9]) g.circle(x, -9, 3.2).fill(["#F7A6B8", "#F6C76C", "#FFFFFF", "#F7A6B8"][(x + 9) / 6]);
      break;
    case "flower":
      for (const [x, y, c] of [[-4, -3, "#F7A6B8"], [3, -5, "#F6C76C"], [6, -1, "#FFFFFF"]] as const) {
        g.rect(x - 0.6, y, 1.2, 5).fill("#6FAE7A");
        g.circle(x, y, 2.6).fill(c);
      }
      break;
    case "lamp":
      shadow(6);
      g.rect(-1.5, -30, 3, 30).fill("#6B5546");
      g.circle(0, -32, 5).fill("#FFE08A");
      g.circle(0, -32, 9).fill({ color: "#FFE08A", alpha: 0.25 });
      break;
    case "well":
      shadow(16);
      g.ellipse(0, -6, 14, 8).fill("#BDB3A8");
      g.ellipse(0, -8, 10, 5).fill("#7FB6D6");
      g.rect(-13, -30, 3, 24).fill("#9A6B45");
      g.rect(10, -30, 3, 24).fill("#9A6B45");
      g.poly([-18, -28, 0, -40, 18, -28]).fill("#E67624");
      break;
    case "fence":
      g.rect(-16, -12, 32, 3).fill("#D9B48A");
      g.rect(-14, -16, 3, 16).fill("#C9A27A");
      g.rect(11, -16, 3, 16).fill("#C9A27A");
      break;
    case "bench":
      shadow(14);
      g.roundRect(-14, -10, 28, 5, 2).fill("#C98A4B");
      g.rect(-12, -5, 3, 5).fill("#8D6240");
      g.rect(9, -5, 3, 5).fill("#8D6240");
      break;
    case "banner":
      g.rect(-1, -44, 2, 44).fill("#8D6240");
      g.poly([1, -44, 18, -40, 1, -34]).fill(ACCENT[mapType]);
      break;
  }
  return g;
}

/** A baked texture plus the anchor that puts the drawing's origin back where it was drawn. */
export type Baked = { tex: Texture; ax: number; ay: number };

/** Bakes textures once per renderer. */
export class TextureBank {
  private cache = new Map<string, Baked>();
  constructor(private renderer: Renderer) {}

  private bake(key: string, make: () => Container, origin = { x: 0, y: 0 }): Baked {
    let t = this.cache.get(key);
    if (!t) {
      const c = make();
      const b = c.getLocalBounds();
      const tex = this.renderer.generateTexture({ target: c, resolution: 2, antialias: true });
      c.destroy({ children: true });
      t = { tex, ax: (origin.x - b.x) / b.width, ay: (origin.y - b.y) / b.height };
      this.cache.set(key, t);
    }
    return t;
  }

  animal(kind: AnimalKind, frame: number) {
    return this.bake(`a:${kind}:${frame}`, () => drawShapes(new Graphics(), animalShapes(kind, frame)), { x: 32, y: 57 });
  }
  prop(kind: PropKind, variant: number, mapType: MapType) {
    return this.bake(`p:${kind}:${variant}:${mapType}`, () => drawProp(kind, variant, mapType));
  }
  parcel() {
    return this.bake("parcel", () => {
      const g = new Graphics();
      g.roundRect(-8, -14, 16, 14, 3).fill("#F6C76C");
      g.rect(-1.5, -14, 3, 14).fill("#E67624");
      g.circle(-2.2, -16, 2.4).fill("#E67624");
      g.circle(2.2, -16, 2.4).fill("#E67624");
      return g;
    });
  }
  destroy() {
    for (const t of this.cache.values()) t.tex.destroy(true);
    this.cache.clear();
  }
}
