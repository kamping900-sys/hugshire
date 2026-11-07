"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorldCity, WorldScene } from "@/game/WorldScene";

export function WorldMap({ cities, focus, className }: { cities: WorldCity[]; focus?: string; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const scene = useRef<WorldScene | null>(null);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = cities.map((c) => `${c.slug}:${c.stage}:${c.helpers}`).join("|");

  useEffect(() => {
    let cancelled = false;
    let s: WorldScene | null = null;
    (async () => {
      try {
        const { WorldScene } = await import("@/game/WorldScene");
        if (cancelled || !el.current) return;
        s = new WorldScene((slug) => router.push(`/city/${slug}`));
        scene.current = s;
        await s.mount(el.current, cities, focus);
        if (!cancelled) setReady(true);
      } catch (e) {
        console.error(e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      s?.destroy();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focus]);

  return (
    <div className={`relative overflow-hidden rounded-[28px] border border-line bg-[#A9D7EA] ${className ?? ""}`}>
      <div ref={el} className="absolute inset-0" aria-label="Hugshire world map. Drag to explore, scroll or pinch to zoom, tap a town to visit." role="application" />
      {!ready && !failed && <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-ink/60">Drawing the map…</div>}
      {failed && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink/70">The map needs WebGL, which this browser has turned off. Use the list of towns below.</div>}
      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <button aria-label="Zoom in" onClick={() => scene.current?.zoomBy(1.25)} className="h-10 w-10 rounded-full bg-paper text-lg font-bold shadow-[var(--shadow-soft)] hover:bg-orange-soft">
          +
        </button>
        <button aria-label="Zoom out" onClick={() => scene.current?.zoomBy(0.8)} className="h-10 w-10 rounded-full bg-paper text-lg font-bold shadow-[var(--shadow-soft)] hover:bg-orange-soft">
          −
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-paper/90 px-3 py-1.5 text-xs font-semibold text-ink-soft">Drag to explore · tap a town</div>
    </div>
  );
}
