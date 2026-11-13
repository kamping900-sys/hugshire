"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RoadTown, RoadWorld } from "@/game/v4/RoadWorld";

import { CauseInfoModal, TitleBoard } from "@/components/town/TownBoard";
import { BackgroundMusic } from "@/components/BackgroundMusic";

/*
 * LEVEL 1: a side-scrolling road. Drive the van left/right (A/D or arrows, Shift/Space to boost),
 * press ↑ / E at a town gate to go in, or tap a town on the strip to auto-drive there.
 */
type ApiTown = { id: string; slug: string; title: string; summary: string; cityName: string; category: string; completed: number; underConstruction: number; constructionBps: number; helpers: number; deliveredMicro: string; org: string };

const card = "rounded-[22px] border-[2.5px] border-[#8A6448] bg-[#FFF9F0]/95 shadow-[0_4px_0_#8A644833,0_10px_30px_-12px_#3A2A2266] backdrop-blur";
const btnBase = "rounded-2xl border-[2.5px] border-[#8A6448] font-extrabold text-[#3A2A22] shadow-[0_3px_0_#8A6448] active:translate-y-[2px] active:shadow-[0_1px_0_#8A6448] transition select-none";
const btn = `${btnBase} bg-[#FFF9F0]`;
const btnP = `${btnBase} bg-[#F58A3C] text-white`;

export function RoadWorldMap() {
  const router = useRouter();
  const from = useSearchParams().get("from");
  const [api, setApi] = useState<ApiTown[] | null>(null);
  useEffect(() => {
    fetch("/api/world")
      .then((r) => r.json())
      .then((j) => setApi(j.towns ?? []))
      .catch(() => setApi([]));
  }, []);
  const towns = useMemo<RoadTown[] | null>(() => {
    if (!api) return null;
    // only active causes are on the road (no decorative stops)
    const real = api.map<RoadTown>((t) => ({ id: t.id, slug: t.slug, name: t.cityName, subtitle: t.title, category: t.category, completed: t.completed, underConstruction: t.underConstruction, constructionBps: t.constructionBps, real: true }));
    return real;
  }, [api]);

  const el = useRef<HTMLDivElement>(null);
  const game = useRef<RoadWorld | null>(null);
  const [ready, setReady] = useState(false);
  const [near, setNear] = useState<RoadTown | null>(null);
  const [hud, setHud] = useState({ x: 0, speed: 0, worldW: 1, boosting: false });
  // "Press A/D to drive" overlay: shown on load, gone as soon as the van moves
  const [intro, setIntro] = useState(true);
  const [info, setInfo] = useState<ApiTown | null>(null);
  // which way the mini van faces on the strip
  const [vanDir, setVanDir] = useState<1 | -1>(1);
  const lastX = useRef<number | null>(null);
  useEffect(() => {
    const prev = lastX.current;
    lastX.current = hud.x;
    if (prev === null) return;
    if (hud.x > prev + 0.5) setVanDir(1);
    else if (hud.x < prev - 0.5) setVanDir(-1);
  }, [hud.x]); // "about this cause" from the stop board
  const [home, setHome] = useState<{ slug: string; cityName: string } | null>(null);
  useEffect(() => {
    fetch("/api/journey")
      .then((r) => r.json())
      .then((j) => j.home && setHome(j.home))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (intro && Math.abs(hud.speed) > 5) setIntro(false);
  }, [hud.speed, intro]);
  useEffect(() => {
    if (!intro) return;
    const k = (e: KeyboardEvent) => ["a", "d", "arrowleft", "arrowright"].includes(e.key.toLowerCase()) && setIntro(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [intro]);

  useEffect(() => {
    if (!towns) return;
    let g: RoadWorld | null = null;
    let dead = false;
    (async () => {
      const { RoadWorld } = await import("@/game/v4/RoadWorld");
      if (dead || !el.current) return;
      g = new RoadWorld(towns, {
        onNear: setNear,
        onHud: setHud,
        onEnter: (t) => t.slug && router.push(`/worldmap/town/${t.slug}`),
      });
      game.current = g;
      if (process.env.NODE_ENV === "development") (window as unknown as { __hsRoad?: unknown }).__hsRoad = g; // dev-only debugging handle
      await g.mount(el.current);
      const back = towns.find((t) => t.slug === from);
      if (back) g.placeAt(back.id);
      if (!dead) setReady(true);
    })();
    return () => {
      dead = true;
      g?.destroy();
      game.current = null;
    };
  }, [towns, router, from]);

  const pedal = (p: -1 | 0 | 1) => game.current?.setPedal(p);
  const nearInfo = near?.real ? api?.find((a) => a.id === near.id) : undefined;

  // back to the town you drove out of (else your home town)
  const backTo = from ?? home?.slug;
  const backName = api?.find((t) => t.slug === backTo)?.cityName ?? (backTo === home?.slug ? home?.cityName : undefined);
  const backButton = backTo ? (
    <Link href={`/worldmap/town/${backTo}`} className={`${btn} flex items-center gap-2 px-4 py-2.5 text-sm`}>
      <span className="text-lg leading-none">←</span> Back to {backName ?? "town"}
    </Link>
  ) : (
    <Link href="/" className={`${btn} flex items-center gap-2 px-4 py-2.5 text-sm`}>
      <span className="text-lg leading-none">←</span> Home
    </Link>
  );

  return (
    <div className="absolute inset-0 select-none font-sans text-[#3A2A22]">
      <div ref={el} className="absolute inset-0" role="application" aria-label="Hugshire road. A and D or arrow keys to drive, Shift or Space to boost, up arrow or E to enter a town." />
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#BFE3F2]">
          <img src="/brand/logo.png" alt="" className="h-20 w-20 animate-bounce rounded-[22px]" />
          <div className="font-extrabold">Warming up the van…</div>
        </div>
      )}

      {/* at a stop: a hanging title board (the "▲ Enter town" sign over the gate is drawn by the game) */}
      {near && !intro && (
        <div key={near.id} className="hs-drop-in absolute inset-x-0 top-[58px] z-20 flex flex-col items-center xl:-top-3">
          <TitleBoard title={near.name} subtitle={nearInfo ? `${near.subtitle} · ${nearInfo.org}` : near.subtitle} onInfo={nearInfo ? () => setInfo(nearInfo) : undefined} />
        </div>
      )}

      {/* bottom: town strip (mini-map) */}
      {towns && (
        <div
          className="absolute inset-x-3 bottom-3 rounded-[26px] border-[3px] border-[#6B4A33] px-5 pb-2.5 pt-2 shadow-[0_5px_0_#6B4A33,0_14px_28px_rgba(0,0,0,0.3)] sm:inset-x-auto sm:left-1/2 sm:w-[min(800px,92vw)] sm:-translate-x-1/2"
          style={{ background: "repeating-linear-gradient(180deg, #DCA266 0 12px, #D49858 12px 14px)" }}
        >
          {/* nail heads */}
          <span aria-hidden className="absolute left-2.5 top-2.5 h-2.5 w-2.5 rounded-full bg-[#6B4A33]" />
          <span aria-hidden className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full bg-[#6B4A33]" />
          <div className="relative mx-3 h-[86px]">
            {/* the road */}
            <div className="absolute inset-x-[-14px] top-[44px] h-4 rounded-full border-[3px] border-[#6B4A33] bg-[#8F8478] shadow-[inset_0_3px_0_rgba(0,0,0,0.18)]">
              <div className="absolute inset-x-3 top-1/2 h-[3px] -translate-y-1/2" style={{ background: "repeating-linear-gradient(90deg, #FFD34D 0 10px, transparent 10px 20px)" }} />
            </div>
            {towns.map((t, i) => {
              const x = game.current?.townX(t.id) ?? 0;
              const pct = ready ? (x / hud.worldW) * 100 : (i + 1) * (100 / (towns.length + 1));
              const here = near?.id === t.id;
              const isHome = home?.slug === t.slug;
              const cat = api?.find((a) => a.id === t.id)?.category ?? t.category;
              const emoji = ({ animals: "🐾", education: "📚", nature: "🌿", health: "🩺", food: "🥕", community: "🤝" } as Record<string, string>)[cat] ?? "🏡";
              return (
                <button key={t.id} onClick={() => game.current?.driveTo(t.id)} title={`Drive to ${t.name}`} className="group absolute top-0 z-10 flex -translate-x-1/2 flex-col items-center" style={{ left: `${pct}%` }}>
                  {/* town badge on a little post */}
                  <span className={`relative flex h-10 w-10 items-center justify-center rounded-full border-[3px] text-xl shadow-[0_3px_0_#6B4A33] transition group-hover:-translate-y-1 ${here ? "hs-town-here border-[#6B4A33] bg-[#FFD34D]" : "border-[#6B4A33] bg-[#FFF9F0]"}`}>
                    {emoji}
                    {isHome && <span className="absolute -right-2 -top-2 rounded-full border-2 border-[#6B4A33] bg-[#F58A3C] px-1 text-[9px] leading-4">🏠</span>}
                  </span>
                  <span aria-hidden className="h-[7px] w-1 bg-[#6B4A33]" />
                  <span aria-hidden className={`-mt-px h-3 w-3 rounded-full border-[3px] border-[#6B4A33] ${here ? "bg-[#FFD34D]" : "bg-[#FFF9F0]"}`} />
                  <span className={`mt-1 whitespace-nowrap rounded-full border-2 border-[#6B4A33] px-2 text-[10px] font-black leading-4 shadow-[0_2px_0_#6B4A33] sm:text-[11px] ${here ? "bg-[#F58A3C] text-white" : "bg-[#FFF9F0] text-[#3A2A22]"}`}>{t.name}</span>
                  <span className="pointer-events-none absolute -top-7 hidden whitespace-nowrap rounded-full bg-[#3A2A22] px-2 py-0.5 text-[10px] font-black text-[#FFF9F0] group-hover:block">Drive here ▶</span>
                </button>
              );
            })}
            {/* the van rides the road, facing where it's going */}
            <span className="pointer-events-none absolute top-[32px] z-0 -translate-x-1/2" style={{ left: `${(hud.x / hud.worldW) * 100}%` }} aria-hidden>
              <img src="/game/sprites/road/van.png" alt="" className={`h-7 w-auto ${Math.abs(hud.speed) > 5 ? "hs-van-idle" : ""}`} style={{ transform: vanDir < 0 ? "scaleX(-1)" : undefined }} />
            </span>
          </div>
        </div>
      )}

      <BackgroundMusic className="bottom-28 sm:bottom-32" />
      {/* the world map stays clean: just the way back (no profile or money stats here) */}
      <div className="absolute left-3 top-3 z-30 sm:left-4 sm:top-4">{backButton}</div>
      {info && <CauseInfoModal town={info} onClose={() => setInfo(null)} />}

      {/* first time on the road: how to drive (disappears as soon as you move) */}
      {intro && ready && (
        <button type="button" onClick={() => setIntro(false)} className="hs-fade absolute inset-0 z-40 flex flex-col items-center justify-center bg-[rgba(28,18,12,0.55)] text-[#FFF9F0]">
          <img src="/game/sprites/road/van.png" alt="" className="hs-van-idle h-24 w-auto sm:h-32" />
          <div className="mt-5 flex items-center gap-3">
            <div className="flex gap-1.5">
              {["A", "D"].map((k) => (
                <kbd key={k} className="flex h-14 w-14 items-center justify-center rounded-2xl border-[3px] border-b-[6px] border-[#8A6448] bg-[#FFF9F0] text-2xl font-black text-[#3A2A22]">{k}</kbd>
              ))}
            </div>
            <span className="text-lg font-black">or</span>
            <div className="flex gap-1.5">
              {["←", "→"].map((k) => (
                <kbd key={k} className="flex h-14 w-14 items-center justify-center rounded-2xl border-[3px] border-b-[6px] border-[#8A6448] bg-[#FFF9F0] text-2xl font-black text-[#3A2A22]">{k}</kbd>
              ))}
            </div>
          </div>
          <div className="mt-4 text-3xl font-black sm:text-4xl" style={{ textShadow: "0 3px 0 #8A6448" }}>to drive the van</div>
          <div className="mt-2 text-sm font-bold opacity-85">Stop at a town and press ↑ to drive in · Shift to boost</div>
          <div className="mt-6 animate-pulse text-xs font-black uppercase tracking-widest opacity-70 sm:hidden">Tap to start</div>
        </button>
      )}

      {/* touch pedals */}
      <div className="absolute bottom-24 left-3 flex gap-2 sm:hidden">
        <button className={`${btn} h-16 w-16 text-2xl`} aria-label="Drive left" onPointerDown={() => pedal(-1)} onPointerUp={() => pedal(0)} onPointerLeave={() => pedal(0)} onPointerCancel={() => pedal(0)}>◀</button>
        <button className={`${btn} h-16 w-16 text-2xl`} aria-label="Drive right" onPointerDown={() => pedal(1)} onPointerUp={() => pedal(0)} onPointerLeave={() => pedal(0)} onPointerCancel={() => pedal(0)}>▶</button>
      </div>
      <button
        className={`${btnP} absolute bottom-24 right-3 h-16 w-20 text-sm sm:hidden`}
        onPointerDown={() => game.current?.setBoost(true)}
        onPointerUp={() => game.current?.setBoost(false)}
        onPointerLeave={() => game.current?.setBoost(false)}
      >
        BOOST
      </button>
    </div>
  );
}
