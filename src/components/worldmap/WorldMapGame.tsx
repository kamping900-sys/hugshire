"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HudState, MyWorker, WorldGame } from "@/game/world/WorldGame";
import type { Category, WorldCause } from "@/game/world/gen";
import { demoCauses } from "@/game/world/demo";
import { MASCOT_LABEL, type Mascot } from "@/game/world/mascots";
import { Minimap } from "./Minimap";

/*
 * LEVEL 1: OVERWORLD. Each grid tile is one whole area. Real, approved organisation towns come from
 * /api/world and can be entered (level 2: the detailed town). Remaining tiles are clearly labelled
 * sample towns so the world feels full; they are not causes and cannot receive anything.
 * No money is simulated here: personal yield lives on your Heart Tree inside a town.
 */
type ApiTown = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  isSample: boolean;
  cityName: string;
  org: string;
  completed: number;
  underConstruction: number;
  constructionBps: number;
  helpers: number;
  deliveredMicro: string;
};
type Town = WorldCause & { slug?: string; real: boolean; isSample?: boolean; completed: number; underConstruction: number; constructionBps: number; summary?: string };

const CAT: Record<string, Category> = { education: "education", animals: "animals", nature: "nature", health: "health", food: "food", community: "community" };

const cardCls = "rounded-[22px] border-[2.5px] border-[#8A6448] bg-[#FFF9F0]/95 shadow-[0_4px_0_#8A644833,0_10px_30px_-12px_#3A2A2266] backdrop-blur";
const btnBase = "rounded-2xl border-[2.5px] border-[#8A6448] font-extrabold text-[#3A2A22] shadow-[0_3px_0_#8A6448] active:translate-y-[2px] active:shadow-[0_1px_0_#8A6448] transition";
const btnCls = `${btnBase} bg-[#FFF9F0]`;
const btnP = `${btnBase} bg-[#F58A3C] text-white`;

const money = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const clockStr = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

function mergeTowns(real: ApiTown[]): Town[] {
  const slots = demoCauses(64);
  const realNames = new Set(real.map((r) => r.cityName.toLowerCase()));
  return slots.map((slot, i) => {
    const r = i >= 1 ? real[i - 1] : undefined; // slot 0 stays the Hugshire town square
    if (!r) {
      const name = realNames.has(slot.name.toLowerCase()) ? `${slot.name} Meadows` : slot.name;
      return { ...slot, name, real: false, completed: 0, underConstruction: 0, constructionBps: 0, subtitle: i === 0 ? slot.subtitle : `${slot.subtitle} · sample` };
    }
    return {
      ...slot,
      id: r.id,
      slug: r.slug,
      name: r.cityName,
      subtitle: r.title,
      org: r.org,
      category: CAT[r.category] ?? slot.category,
      stage: Math.min(5, 1 + r.completed),
      helpers: r.helpers,
      deliveredUsd: Number(BigInt(r.deliveredMicro) / 10_000n) / 100,
      real: true,
      isSample: r.isSample,
      completed: r.completed,
      underConstruction: r.underConstruction,
      constructionBps: r.constructionBps,
      summary: r.summary,
    };
  });
}

export function WorldMapGame() {
  const router = useRouter();
  const [real, setReal] = useState<ApiTown[] | null>(null);
  useEffect(() => {
    fetch("/api/world")
      .then((r) => r.json())
      .then((j) => setReal(j.towns ?? []))
      .catch(() => setReal([]));
  }, []);
  const causes = useMemo(() => (real ? mergeTowns(real) : null), [real]);
  const byId = useMemo(() => new Map((causes ?? []).map((c) => [c.id, c])), [causes]);
  const workers = useMemo<MyWorker[]>(() => (causes ? [{ id: "w-you", mascot: "cat", name: "You", homeCauseId: causes[Math.min(1, causes.length - 1)].id }] : []), [causes]);

  const el = useRef<HTMLDivElement>(null);
  const game = useRef<WorldGame | null>(null);
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [near, setNear] = useState<WorldCause | null>(null);
  const [panel, setPanel] = useState<Town | null>(null);
  const [speed, setSpeedState] = useState(1);
  const [drawer, setDrawer] = useState<"none" | "causes" | "perf">("none");
  const [search, setSearch] = useState("");

  // mount engine once the towns are known
  useEffect(() => {
    if (!causes || !workers.length) return;
    let g: WorldGame | null = null;
    let dead = false;
    (async () => {
      const { WorldGame } = await import("@/game/world/WorldGame");
      if (dead || !el.current) return;
      g = new WorldGame(causes, workers, workers[0].id, {
        onHud: setHud,
        onNear: setNear,
        onSelect: (c) => setPanel(byId.get(c.id) ?? null),
        onArrive: (c) => setPanel(byId.get(c.id) ?? null),
        onAutoDeliver: () => {}, // V4: no parcels on the overworld; yield is harvested from your Heart Tree
      });
      game.current = g;
      await g.mount(el.current);
      if (process.env.NODE_ENV === "development") (window as unknown as { __hugshire?: WorldGame }).__hugshire = g;
      if (!dead) setReady(true);
    })();
    return () => {
      dead = true;
      g?.destroy();
      game.current = null;
    };
  }, [causes, workers, byId]);

  // E on a real town enters it
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e" || !near) return;
      const t = byId.get(near.id);
      if (t?.real && t.slug) router.push(`/worldmap/town/${t.slug}`);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [near, byId, router]);

  const setSpeed = (s: number) => {
    setSpeedState(s);
    game.current?.setSpeed(s);
  };

  const list = causes ?? [];
  const realTowns = list.filter((c) => c.real);
  const filtered = list.filter((c) => (c.name + c.subtitle + c.org).toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.real) - Number(a.real));
  const totalBuilt = realTowns.reduce((a, c) => a + c.completed, 0);
  const totalDelivered = realTowns.reduce((a, c) => a + c.deliveredUsd, 0);
  const nearTown = near ? byId.get(near.id) : undefined;

  return (
    <div className="absolute inset-0 select-none font-sans text-[#3A2A22]">
      <div ref={el} className="absolute inset-0" role="application" aria-label="Hugshire world. WASD or arrow keys to walk, click to move, scroll to zoom, M for the world map, E to enter a town." />

      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#BFE0A6]">
          <img src="/brand/logo.png" alt="" className="h-20 w-20 animate-bounce rounded-[22px]" />
          <div className="font-extrabold">Building Hugshire…</div>
        </div>
      )}

      {/* top-left: brand */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2 sm:left-4 sm:top-4">
        <Link href="/" className={`${cardCls} pointer-events-auto flex items-center gap-2 py-1.5 pl-1.5 pr-4`}>
          <img src="/brand/logo.png" alt="" className="h-10 w-10 rounded-[14px]" />
          <span className="text-xl font-black tracking-tight">Hugshire</span>
        </Link>
        <div className={`${cardCls} pointer-events-auto max-w-[260px] p-3 text-xs font-bold leading-snug text-[#7B6A5C]`}>
          <span className="font-black text-[#3A2A22]">Overworld.</span> Each tile is a whole town. Walk to a town with a{" "}
          <span className="rounded bg-[#FDE6D4] px-1 text-[#C7601F]">real cause</span> and press <kbd className="rounded border border-[#C9B39C] bg-white px-1">E</kbd> to go inside, build together and visit your Heart Tree.
        </div>
      </div>

      {/* top-right: totals */}
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
        <div className="flex gap-2">
          <Pill icon={<HouseIcon />} label="Real towns" value={String(realTowns.length)} />
          <Pill icon={<HammerIcon />} label="Buildings finished together" value={String(totalBuilt)} />
          <Pill icon={<HeartIcon />} label="Yield delivered (confirmed)" value={money(totalDelivered)} />
        </div>
      </div>

      {/* left: tools */}
      <div className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-2 sm:left-4">
        <ToolBtn label="Towns" active={drawer === "causes"} onClick={() => setDrawer(drawer === "causes" ? "none" : "causes")}>
          <ListIcon />
        </ToolBtn>
        <ToolBtn label="Performance" active={drawer === "perf"} onClick={() => setDrawer(drawer === "perf" ? "none" : "perf")}>
          <GaugeIcon />
        </ToolBtn>
      </div>

      {drawer === "causes" && (
        <div className={`${cardCls} absolute bottom-24 left-20 top-24 flex w-80 flex-col p-3 sm:left-24`}>
          <div className="mb-2 px-1 text-sm font-black">
            {realTowns.length} real towns · {list.length - realTowns.length} sample tiles
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search towns" className="mb-2 rounded-xl border-2 border-[#E2D3C2] bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-[#F58A3C]" />
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  game.current?.panToCause(c.id);
                  setPanel(c);
                }}
                className="mb-1 flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left hover:bg-[#F6EDE2]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black">{c.name}</span>
                  <span className="block truncate text-xs font-bold text-[#7B6A5C]">{c.subtitle}</span>
                </span>
                {c.real ? <span className="shrink-0 rounded-full bg-[#FDE6D4] px-2 py-0.5 text-[10px] font-black text-[#C7601F]">enter</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {drawer === "perf" && hud && (
        <div className={`${cardCls} absolute left-20 top-1/2 w-64 -translate-y-1/2 p-4 text-sm sm:left-24`}>
          <div className="mb-2 font-black">Performance</div>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 font-bold">
            <dt className="text-[#7B6A5C]">FPS</dt><dd>{hud.fps}</dd>
            <dt className="text-[#7B6A5C]">View</dt><dd>{hud.overview ? "map (thumbnails)" : "detail"}</dd>
            <dt className="text-[#7B6A5C]">Tiles on GPU</dt><dd>{hud.tiles}</dd>
            <dt className="text-[#7B6A5C]">Sprites drawn</dt><dd>{hud.sprites}</dd>
            <dt className="text-[#7B6A5C]">Characters simulated</dt><dd>{hud.simulated}</dd>
            <dt className="text-[#7B6A5C]">Zoom</dt><dd>{hud.zoom.toFixed(2)}×</dd>
          </dl>
        </div>
      )}

      {/* near-town prompt */}
      {nearTown && !panel && (
        <button
          onClick={() => (nearTown.real && nearTown.slug ? router.push(`/worldmap/town/${nearTown.slug}`) : setPanel(nearTown))}
          className={`${btnCls} absolute bottom-24 left-1/2 -translate-x-1/2 px-5 py-3 text-sm sm:bottom-8`}
        >
          {nearTown.real ? "Enter" : "Look at"} <span className="text-[#E46F3E]">{nearTown.name}</span> <kbd className="ml-1 rounded-md border border-[#C9B39C] bg-white px-1.5 text-xs">E</kbd>
        </button>
      )}

      {/* bottom-left: world map */}
      <button onClick={() => game.current?.toggleOverview()} className={`${btnCls} absolute bottom-3 left-3 flex items-center gap-2 px-4 py-2.5 sm:bottom-4 sm:left-4`}>
        <MapIcon /> {hud?.overview ? "Back to helper" : "World Map"}
      </button>

      {/* bottom-right: minimap, zoom, time */}
      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4">
        <div className="hidden sm:block">{ready && game.current && <Minimap game={game.current} />}</div>
        <div className="flex items-end gap-2">
          <div className={`${cardCls} flex items-center gap-3 px-3 py-2`}>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((s) => (
                <button key={s} onClick={() => setSpeed(s)} className={`h-8 min-w-9 rounded-xl border-2 border-[#8A6448] px-1.5 text-xs font-black ${speed === s ? (s === 0 ? "bg-[#E2523F] text-white" : "bg-[#F6C76C]") : "bg-white"}`}>
                  {s === 0 ? "❚❚" : ">".repeat(s)}
                </button>
              ))}
            </div>
            <div className="text-right leading-tight">
              <div className="num text-sm font-black">{hud ? clockStr(hud.clock) : "--"}</div>
              <div className="text-[11px] font-bold text-[#7B6A5C]">Day {hud?.day ?? 1}</div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <button aria-label="Zoom in" onClick={() => game.current?.zoomBy(1.25)} className={`${btnCls} h-10 w-10 text-xl`}>+</button>
            <button aria-label="Zoom out" onClick={() => game.current?.zoomBy(0.8)} className={`${btnCls} h-10 w-10 text-xl`}>−</button>
          </div>
        </div>
      </div>

      {/* town panel */}
      {panel && (
        <div className={`${cardCls} absolute inset-x-3 bottom-3 max-h-[70vh] overflow-y-auto p-5 sm:inset-x-auto sm:right-4 sm:top-24 sm:bottom-auto sm:w-[360px]`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">{panel.subtitle}</div>
              <div className="text-2xl font-black leading-tight">{panel.name}</div>
              <div className="text-xs font-bold text-[#7B6A5C]">{panel.real ? `by ${panel.org}${panel.isSample ? " · sample organisation (test mode)" : ""}` : "Sample tile · not a real cause"}</div>
            </div>
            <button onClick={() => setPanel(null)} aria-label="Close" className="rounded-full px-2 text-xl font-black text-[#7B6A5C] hover:bg-[#F6EDE2]">×</button>
          </div>
          {panel.real ? (
            <>
              {panel.summary && <p className="mt-2 text-sm font-semibold text-[#5C4A3D]">{panel.summary}</p>}
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Finished" value={String(panel.completed)} />
                <Stat label="Building" value={String(panel.underConstruction)} />
                <Stat label="Helpers" value={String(panel.helpers)} />
              </div>
              {panel.underConstruction > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-black text-[#7B6A5C]">Construction in progress · {(panel.constructionBps / 100).toFixed(1)}%</div>
                  <div className="h-2.5 rounded-full bg-[#E8DCCD]">
                    <div className="h-full rounded-full bg-[#F58A3C]" style={{ width: `${Math.min(100, panel.constructionBps / 100)}%` }} />
                  </div>
                </div>
              )}
              <div className="mt-3 rounded-2xl bg-[#F6EDE2] p-2.5 text-center">
                <div className="text-[11px] font-bold text-[#7B6A5C]">Real yield delivered here (confirmed)</div>
                <div className="num text-lg font-black">{money(panel.deliveredUsd)}</div>
              </div>
              <button onClick={() => router.push(`/worldmap/town/${panel.slug}`)} className={`${btnP} mt-4 w-full py-3`}>
                Enter {panel.name}
              </button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={() => { game.current?.walkToCause(panel.id); setPanel(null); }} className={`${btnCls} py-2.5 text-sm`}>Walk here</button>
                <button onClick={() => { game.current?.fastTravel(panel.id); setPanel(null); }} className={`${btnCls} py-2.5 text-sm`}>Fast travel</button>
              </div>
              <p className="mt-3 text-[11px] font-semibold leading-snug text-[#7B6A5C]">Buildings are virtual and built with Wood and Stone. They show community effort; they are not proof of real-world impact. Real updates are on the town&apos;s Notice Board.</p>
            </>
          ) : (
            <p className="mt-3 text-sm font-semibold text-[#7B6A5C]">This tile is decorative so the world feels lived-in. It isn&apos;t an organisation and can&apos;t receive anything. Real towns are listed under Towns.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#F6EDE2] p-2">
      <div className="text-[11px] font-bold text-[#7B6A5C]">{label}</div>
      <div className="num text-lg font-black">{value}</div>
    </div>
  );
}

const HouseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="#F6C76C" stroke="#8A6448" strokeWidth="1.6" strokeLinejoin="round" /><rect x="10" y="14" width="4" height="6" fill="#E46F3E" /></svg>
);
const HammerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24"><path d="M13 7l4-3 3 3-3 4z" fill="#9AA3AD" stroke="#8A6448" strokeWidth="1.5" strokeLinejoin="round" /><path d="M14.5 9.5L5 19" stroke="#B07A4A" strokeWidth="3" strokeLinecap="round" /></svg>
);

function Pill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={`${cardCls} pointer-events-auto flex items-center gap-2 px-3 py-1.5`} title={label}>
      {icon}
      <div className="leading-tight">
        <div className="num text-base font-black">{value}</div>
        <div className="hidden text-[10px] font-bold text-[#7B6A5C] sm:block">{label}</div>
      </div>
    </div>
  );
}

function ToolBtn({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className={`${btnCls} flex h-12 w-12 items-center justify-center ${active ? "bg-[#F6C76C]" : ""}`}>
      {children}
    </button>
  );
}

const HeartIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20z" fill="#E2523F" stroke="#8A6448" strokeWidth="1.5" /></svg>
);
const ListIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A6448" strokeWidth="2.4" strokeLinecap="round"><path d="M9 7h11M9 12h11M9 17h11" /><circle cx="4.5" cy="7" r="1.4" fill="#F58A3C" stroke="none" /><circle cx="4.5" cy="12" r="1.4" fill="#F58A3C" stroke="none" /><circle cx="4.5" cy="17" r="1.4" fill="#F58A3C" stroke="none" /></svg>
);
const GaugeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A6448" strokeWidth="2.2" strokeLinecap="round"><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-5" stroke="#E46F3E" /></svg>
);
const MapIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="#CFE6B8" stroke="#8A6448" strokeWidth="1.6" strokeLinejoin="round" /><path d="M9 4v14M15 6v14" stroke="#8A6448" strokeWidth="1.4" /><path d="M12 13s-3-2.2-3-4.3A1.8 1.8 0 0 1 12 7.6a1.8 1.8 0 0 1 3 1.1C15 10.8 12 13 12 13z" fill="#E2523F" /></svg>
);
