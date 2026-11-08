"use client";
import { useEffect, useRef } from "react";
import type { WorldGame } from "@/game/world/WorldGame";
import { TILE_PX } from "@/game/world/gen";

const COLORS: Record<string, string> = {
  square: "#F58A3C", animals: "#E46F3E", food: "#9BCB78", health: "#F0A3B5", education: "#7FA8E8", arts: "#B79BE0",
  community: "#6FC2D2", nature: "#6FB98A", homes: "#D9A86A", expansion: "#E6D7B9", forest: "#8FC487", meadow: "#BFE0A6",
  lake: "#8ECFE6", grove: "#F2C4D2", hills: "#C9D6A8",
};

/** Cheap minimap: one pixel-block per tile, redrawn twice a second. Click to look there. */
export function Minimap({ game }: { game: WorldGame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c || document.hidden) return;
      const ctx = c.getContext("2d")!;
      const d = game.minimap();
      const w = d.bounds.x1 - d.bounds.x0 + 1, h = d.bounds.y1 - d.bounds.y0 + 1;
      const cell = Math.floor(Math.min(c.width / w, c.height / h));
      const ox = (c.width - w * cell) / 2, oy = (c.height - h * cell) / 2;
      ctx.fillStyle = "#A9D7EA";
      ctx.fillRect(0, 0, c.width, c.height);
      for (let ty = d.bounds.y0; ty <= d.bounds.y1; ty++)
        for (let tx = d.bounds.x0; tx <= d.bounds.x1; tx++) {
          ctx.fillStyle = COLORS[d.kindAt(tx, ty)] ?? "#BFE0A6";
          ctx.fillRect(ox + (tx - d.bounds.x0) * cell, oy + (ty - d.bounds.y0) * cell, cell - 1, cell - 1);
        }
      ctx.strokeStyle = "#3A2A22";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + (d.view.x - d.bounds.x0) * cell, oy + (d.view.y - d.bounds.y0) * cell, d.view.w * cell, d.view.h * cell);
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(ox + (d.player.x - d.bounds.x0) * cell, oy + (d.player.y - d.bounds.y0) * cell, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#F58A3C";
      ctx.beginPath();
      ctx.arc(ox + (d.player.x - d.bounds.x0) * cell, oy + (d.player.y - d.bounds.y0) * cell, 3.2, 0, Math.PI * 2);
      ctx.fill();
      (c as HTMLCanvasElement & { _m?: object })._m = { ox, oy, cell, b: d.bounds };
    };
    draw();
    const t = window.setInterval(draw, 500);
    return () => window.clearInterval(t);
  }, [game]);

  return (
    <canvas
      ref={ref}
      width={168}
      height={168}
      className="rounded-[18px] border-[2.5px] border-[#8A6448] shadow-[0_3px_0_#8A6448] cursor-pointer"
      aria-label="Minimap. Click to look at that part of the world."
      onClick={(e) => {
        const c = e.currentTarget as HTMLCanvasElement & { _m?: { ox: number; oy: number; cell: number; b: { x0: number; y0: number } } };
        if (!c._m) return;
        const r = c.getBoundingClientRect();
        const x = ((e.clientX - r.left) * (c.width / r.width) - c._m.ox) / c._m.cell + c._m.b.x0;
        const y = ((e.clientY - r.top) * (c.height / r.height) - c._m.oy) / c._m.cell + c._m.b.y0;
        game.panTo(x * TILE_PX, y * TILE_PX);
      }}
    />
  );
}
