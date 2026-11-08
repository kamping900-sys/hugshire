"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HudState, MyWorker, WorldGame } from "@/game/world/WorldGame";
import type { WorldCause } from "@/game/world/gen";
import { demoCauses } from "@/game/world/demo";
import { MASCOT_LABEL, type Mascot } from "@/game/world/mascots";
import { Minimap } from "./Minimap";

/*
 * DEMO STATE. Balances, yield and moves here are simulated in the browser so the world can be
 * played without an account. In the real app these come from the ledger APIs.
 */
const APR = 0.0896; // RHEA USDC supply APR read on 2026-11-07
const DEMO_TIME_ACCEL = 6000; // demo yield runs much faster than real time (labelled in the UI)
const PARCEL_USD = 0.01;

const cardCls = "rounded-[22px] border-[2.5px] border-[#8A6448] bg-[#FFF9F0]/95 shadow-[0_4px_0_#8A644833,0_10px_30px_-12px_#3A2A2266] backdrop-blur";
const btnCls = "rounded-2xl border-[2.5px] border-[#8A6448] bg-[#FFF9F0] font-extrabold text-[#3A2A22] shadow-[0_3px_0_#8A6448] active:translate-y-[2px] active:shadow-[0_1px_0_#8A6448] transition";

const money = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const clockStr = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

export function WorldMapGame() {
  const causes = useMemo(() => demoCauses(64), []);
  const byId = useMemo(() => new Map(causes.map((c) => [c.id, c])), [causes]);
  const workers = useMemo<MyWorker[]>(
    () => [
      { id: "w-hugi", mascot: "cat", name: "Hugi", homeCauseId: causes[0].id },
      { id: "w-ember", mascot: "fox", name: "Ember", homeCauseId: causes[3].id },
      { id: "w-pip", mascot: "bird", name: "Pip", homeCauseId: causes[6].id },
    ],
    [causes],
  );

  const el = useRef<HTMLDivElement>(null);
  const game = useRef<WorldGame | null>(null);
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [near, setNear] = useState<WorldCause | null>(null);
  const [panel, setPanel] = useState<WorldCause | null>(null);
  const [controlled, setControlled] = useState(workers[0].id);
  const [homes, setHomes] = useState<Record<string, string>>(() => Object.fromEntries(workers.map((w) => [w.id, w.homeCauseId])));
  const [support, setSupport] = useState<Record<string, number>>(() => ({ [causes[0].id]: 150, [causes[3].id]: 80, [causes[6].id]: 50 }));
  const [accrued, setAccrued] = useState<Record<string, number>>({});
  const [delivered, setDelivered] = useState<Record<string, number>>({});
  const [speed, setSpeedState] = useState(1);
  const [drawer, setDrawer] = useState<"none" | "helpers" | "causes" | "perf">("none");
  const [search, setSearch] = useState("");
  const [move, setMove] = useState<{ to: WorldCause } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const supportRef = useRef(support);
  supportRef.current = support;
  const homesRef = useRef(homes);
  homesRef.current = homes;
  const accruedRef = useRef(accrued);
  accruedRef.current = accrued;

  const flash = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 4200);
  }, []);

  const deliver = useCallback(
    (workerId: string, cause: WorldCause, auto: boolean) => {
      const amt = accruedRef.current[workerId] ?? 0;
      const parcels = Math.floor(amt / PARCEL_USD);
      if (parcels <= 0) return false;
      const usd = parcels * PARCEL_USD;
      setAccrued((a) => ({ ...a, [workerId]: (a[workerId] ?? 0) - usd }));
      setDelivered((d) => ({ ...d, [cause.id]: (d[cause.id] ?? 0) + usd }));
      game.current?.setCarry(workerId, 0);
      game.current?.celebrate(cause.id);
      const w = workers.find((x) => x.id === workerId)!;
      flash(`${w.name} ${auto ? "auto-delivered" : "delivered"} ${parcels} parcel${parcels > 1 ? "s" : ""} (${money(usd)} of yield) to ${cause.name}`);
      return true;
    },
    [flash, workers],
  );
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  // mount engine once
  useEffect(() => {
    let g: WorldGame | null = null;
    let dead = false;
    (async () => {
      const { WorldGame } = await import("@/game/world/WorldGame");
      if (dead || !el.current) return;
      g = new WorldGame(causes, workers, workers[0].id, {
        onHud: setHud,
        onNear: setNear,
        onSelect: (c) => setPanel(c),
        onArrive: (c) => setPanel(c),
        onAutoDeliver: (wid, c) => deliverRef.current(wid, c, true),
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
  }, [causes, workers]);

  // demo yield accrual per worker (from the support at its home cause)
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.hidden || speed === 0) return;
      setAccrued((a) => {
        const next = { ...a };
        for (const w of workers) {
          const usd = supportRef.current[homesRef.current[w.id]] ?? 0;
          next[w.id] = (next[w.id] ?? 0) + (usd * APR * DEMO_TIME_ACCEL * speed * 0.5) / 31_536_000;
          game.current?.setCarry(w.id, Math.floor(next[w.id] / PARCEL_USD));
        }
        return next;
      });
    }, 500);
    return () => window.clearInterval(t);
  }, [speed, workers]);

  const setSpeed = (s: number) => {
    setSpeedState(s);
    game.current?.setSpeed(s);
  };
  const choose = (id: string) => {
    setControlled(id);
    game.current?.setControlled(id);
    setDrawer("none");
  };

  const ctrl = workers.find((w) => w.id === controlled)!;
  const carryUsd = accrued[controlled] ?? 0;
  const carryParcels = Math.floor(carryUsd / PARCEL_USD);
  const totalSupport = Object.values(support).reduce((a, b) => a + b, 0);
  const totalDelivered = Object.values(delivered).reduce((a, b) => a + b, 0);
  const filtered = causes.filter((c) => (c.name + c.subtitle + c.org).toLowerCase().includes(search.toLowerCase()));

  async function confirmMove(fromId: string, to: WorldCause, amount: number) {
    setMove(null);
    setPanel(null);
    const from = byId.get(fromId)!;
    flash(`Moving ${money(amount)} of support from ${from.name} to ${to.name}…`);
    await game.current?.sendTruck(fromId, to.id, true);
    setSupport((s) => {
      const n = { ...s, [fromId]: (s[fromId] ?? 0) - amount, [to.id]: (s[to.id] ?? 0) + amount };
      if (n[fromId] <= 0.0001) delete n[fromId];
      return n;
    });
    // a helper whose cause has no support left follows the money
    setHomes((h) => {
      const left = (supportRef.current[fromId] ?? 0) - amount;
      if (left > 0.0001) return h;
      const n = { ...h };
      for (const [wid, cid] of Object.entries(h))
        if (cid === fromId) {
          n[wid] = to.id;
          game.current?.setWorkerHome(wid, to.id);
        }
      return n;
    });
    flash(`${money(amount)} of support now works for ${to.name}. Its yield goes there from now on.`);
  }

  return (
    <div className="absolute inset-0 select-none font-sans text-[#3A2A22]">
      <div ref={el} className="absolute inset-0" role="application" aria-label="Hugshire world. WASD or arrow keys to walk, click to move, scroll to zoom, M for the world map, E to visit a cause." />

      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#BFE0A6]">
          <img src="/brand/logo.png" alt="" className="h-20 w-20 animate-bounce rounded-[22px]" />
          <div className="font-extrabold">Building Hugshire…</div>
        </div>
      )}

      {/* top-left: brand + controlled helper */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2 sm:left-4 sm:top-4">
        <Link href="/" className={`${cardCls} pointer-events-auto flex items-center gap-2 py-1.5 pl-1.5 pr-4`}>
          <img src="/brand/logo.png" alt="" className="h-10 w-10 rounded-[14px]" />
          <span className="text-xl font-black tracking-tight">Hugshire</span>
        </Link>
        <div className={`${cardCls} pointer-events-auto flex items-center gap-3 p-2.5 pr-4`}>
          <button onClick={() => setDrawer(drawer === "helpers" ? "none" : "helpers")} className="relative">
            <img src={`/mascots/${ctrl.mascot}.png`} alt={MASCOT_LABEL[ctrl.mascot]} className="h-14 w-14 rounded-2xl border-2 border-[#8A6448] bg-white object-cover" />
            <span className="absolute -bottom-1 -right-1 rounded-full bg-[#F58A3C] px-1.5 text-[10px] font-black text-white">switch</span>
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-black">{ctrl.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${hud?.mode === "auto" ? "bg-[#DCEFF9] text-[#2F6E92]" : "bg-[#FDE6D4] text-[#C7601F]"}`}>{hud?.mode === "auto" ? "AUTO" : "YOU"}</span>
            </div>
            <div className="text-xs font-bold text-[#7B6A5C]">
              Home: {byId.get(homes[controlled])?.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-sm font-black">
              <ParcelIcon /> {carryParcels} <span className="text-xs font-bold text-[#7B6A5C]">parcels · {money(carryUsd, 3)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* top-right: totals */}
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
        <div className="flex gap-2">
          <Pill icon={<HeartIcon />} label="Support working" value={money(totalSupport, 0)} />
          <Pill icon={<ParcelIcon />} label="Yield delivered" value={money(totalDelivered)} />
        </div>
        <div className="rounded-full bg-[#3A2A22]/85 px-3 py-1 text-[11px] font-bold text-[#FFF8F0]">Demo world · fake causes & balances · no money moves</div>
      </div>

      {/* left: tools */}
      <div className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-2 sm:left-4">
        <ToolBtn label="Helpers" active={drawer === "helpers"} onClick={() => setDrawer(drawer === "helpers" ? "none" : "helpers")}>
          <PawIcon />
        </ToolBtn>
        <ToolBtn label="Causes" active={drawer === "causes"} onClick={() => setDrawer(drawer === "causes" ? "none" : "causes")}>
          <ListIcon />
        </ToolBtn>
        <ToolBtn label="Performance" active={drawer === "perf"} onClick={() => setDrawer(drawer === "perf" ? "none" : "perf")}>
          <GaugeIcon />
        </ToolBtn>
      </div>

      {drawer === "helpers" && (
        <div className={`${cardCls} absolute left-20 top-1/2 w-72 -translate-y-1/2 p-3 sm:left-24`}>
          <div className="mb-2 px-1 text-sm font-black">Your helpers</div>
          {workers.map((w) => (
            <button key={w.id} onClick={() => choose(w.id)} className={`mb-1.5 flex w-full items-center gap-3 rounded-2xl p-2 text-left ${w.id === controlled ? "bg-[#FDE6D4]" : "hover:bg-[#F6EDE2]"}`}>
              <img src={`/mascots/${w.mascot}.png`} alt="" className="h-11 w-11 rounded-xl border-2 border-[#8A6448] bg-white object-cover" />
              <div className="min-w-0 flex-1">
                <div className="font-black">{w.name} <span className="text-xs font-bold text-[#7B6A5C]">{MASCOT_LABEL[w.mascot as Mascot]}</span></div>
                <div className="truncate text-xs font-bold text-[#7B6A5C]">{byId.get(homes[w.id])?.name} · {Math.floor((accrued[w.id] ?? 0) / PARCEL_USD)} parcels</div>
              </div>
              {w.id === controlled && <span className="text-xs font-black text-[#E46F3E]">playing</span>}
            </button>
          ))}
          <p className="px-1 pt-1 text-[11px] font-semibold leading-snug text-[#7B6A5C]">Helpers you aren&apos;t steering deliver to their home cause on their own. You switch to auto after 45 s idle in this demo (1 hour in the real app).</p>
        </div>
      )}

      {drawer === "causes" && (
        <div className={`${cardCls} absolute bottom-24 left-20 top-24 flex w-80 flex-col p-3 sm:left-24`}>
          <div className="mb-2 px-1 text-sm font-black">{causes.length} causes in Hugshire</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search causes" className="mb-2 rounded-xl border-2 border-[#E2D3C2] bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-[#F58A3C]" />
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
                {support[c.id] ? <span className="shrink-0 rounded-full bg-[#FDE6D4] px-2 py-0.5 text-[10px] font-black text-[#C7601F]">{money(support[c.id], 0)}</span> : null}
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
            <dt className="text-[#7B6A5C]">Tile</dt><dd>{hud.player.tx}, {hud.player.ty}</dd>
          </dl>
          <p className="mt-2 text-[11px] font-semibold leading-snug text-[#7B6A5C]">Only tiles near the camera exist; far ones are freed. Zoomed out, each tile is one tiny picture and no characters run.</p>
        </div>
      )}

      {/* near-cause prompt */}
      {near && !panel && (
        <button onClick={() => setPanel(near)} className={`${btnCls} absolute bottom-24 left-1/2 -translate-x-1/2 px-5 py-3 text-sm sm:bottom-8`}>
          Visit <span className="text-[#E46F3E]">{near.name}</span> <kbd className="ml-1 rounded-md border border-[#C9B39C] bg-white px-1.5 text-xs">E</kbd>
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

      {/* cause panel */}
      {panel && (
        <div className={`${cardCls} absolute inset-x-3 bottom-3 max-h-[70vh] overflow-y-auto p-5 sm:inset-x-auto sm:right-4 sm:top-24 sm:bottom-auto sm:w-[360px]`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">{panel.subtitle}</div>
              <div className="text-2xl font-black leading-tight">{panel.name}</div>
              <div className="text-xs font-bold text-[#7B6A5C]">by {panel.org} (demo)</div>
            </div>
            <button onClick={() => setPanel(null)} aria-label="Close" className="rounded-full px-2 text-xl font-black text-[#7B6A5C] hover:bg-[#F6EDE2]">×</button>
          </div>
          <div className="mt-4 flex gap-1">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`h-2.5 flex-1 rounded-full ${i <= panel.stage ? "bg-[#F58A3C]" : "bg-[#E8DCCD]"}`} />
            ))}
          </div>
          <div className="mt-1 text-xs font-bold text-[#7B6A5C]">{["Abandoned", "Cleared", "Foundations", "Small Town", "Growing Town", "Thriving"][panel.stage]} · {panel.helpers} helpers</div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl bg-[#F6EDE2] p-2.5">
              <div className="text-[11px] font-bold text-[#7B6A5C]">Yield delivered</div>
              <div className="num text-lg font-black">{money(panel.deliveredUsd + (delivered[panel.id] ?? 0))}</div>
            </div>
            <div className="rounded-2xl bg-[#F6EDE2] p-2.5">
              <div className="text-[11px] font-bold text-[#7B6A5C]">Your support here</div>
              <div className="num text-lg font-black">{money(support[panel.id] ?? 0, 0)}</div>
            </div>
          </div>

          {near?.id === panel.id ? (
            <button disabled={carryParcels <= 0} onClick={() => deliver(controlled, panel, false)} className={`${btnCls} mt-4 w-full bg-[#F58A3C] py-3 text-white disabled:opacity-50`}>
              Deliver {carryParcels} parcel{carryParcels === 1 ? "" : "s"} ({money(carryParcels * PARCEL_USD)})
            </button>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => { game.current?.walkToCause(panel.id); setPanel(null); }} className={`${btnCls} py-2.5 text-sm`}>Walk here</button>
              <button onClick={() => { game.current?.fastTravel(panel.id); setPanel(null); }} className={`${btnCls} py-2.5 text-sm`}>Fast travel</button>
            </div>
          )}
          <button onClick={() => setMove({ to: panel })} disabled={!Object.keys(support).some((id) => id !== panel.id)} className={`${btnCls} mt-2 w-full py-2.5 text-sm disabled:opacity-50`}>
            Move my support here
          </button>
          <p className="mt-3 text-[11px] font-semibold leading-snug text-[#7B6A5C]">Parcels are yield your money already earned. Delivering picks where it goes; playing never changes how much is earned.</p>
        </div>
      )}

      {move && <MoveModal to={move.to} support={support} byId={byId} onCancel={() => setMove(null)} onConfirm={confirmMove} />}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-20 w-[min(92vw,520px)] -translate-x-1/2 rounded-2xl border-[2.5px] border-[#8A6448] bg-[#FFF9F0] px-4 py-2.5 text-center text-sm font-bold shadow-lg sm:top-6">{toast}</div>
      )}
    </div>
  );
}

function MoveModal(p: { to: WorldCause; support: Record<string, number>; byId: Map<string, WorldCause>; onCancel: () => void; onConfirm: (fromId: string, to: WorldCause, amount: number) => void }) {
  const sources = Object.entries(p.support).filter(([id, v]) => id !== p.to.id && v > 0);
  const [from, setFrom] = useState(sources[0]?.[0] ?? "");
  const max = p.support[from] ?? 0;
  const [amount, setAmount] = useState(Math.round(max));
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#3A2A22]/35 p-4" role="dialog" aria-modal="true">
      <div className={`${cardCls} w-full max-w-md p-6`}>
        <div className="text-xl font-black">Move support to {p.to.name}</div>
        <p className="mt-1 text-sm font-semibold text-[#7B6A5C]">Your money stays where it is, lent through RHEA. Only the cause its yield goes to changes, so moving is instant and free.</p>
        <label className="mt-4 block text-sm font-black">From</label>
        <select value={from} onChange={(e) => { setFrom(e.target.value); setAmount(Math.round(p.support[e.target.value] ?? 0)); }} className="mt-1 w-full rounded-xl border-2 border-[#E2D3C2] bg-white px-3 py-2 font-semibold">
          {sources.map(([id, v]) => (
            <option key={id} value={id}>{p.byId.get(id)?.name} · {money(v, 0)}</option>
          ))}
        </select>
        <label className="mt-4 block text-sm font-black">Amount: {money(amount, 0)}</label>
        <input type="range" min={1} max={Math.max(1, Math.round(max))} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-2 w-full accent-[#F58A3C]" />
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={p.onCancel} className={`${btnCls} px-4 py-2 text-sm`}>Cancel</button>
          <button disabled={!from || amount <= 0} onClick={() => p.onConfirm(from, p.to, Math.min(amount, max))} className={`${btnCls} bg-[#F58A3C] px-4 py-2 text-sm text-white`}>Send the truck</button>
        </div>
      </div>
    </div>
  );
}

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
const ParcelIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="13" rx="2.5" fill="#F6C76C" stroke="#8A6448" strokeWidth="1.5" /><rect x="10.8" y="7" width="2.4" height="13" fill="#E46F3E" /><path d="M12 6.5c-1.6-2.4-4.2-1.2-3 .5M12 6.5c1.6-2.4 4.2-1.2 3 .5" stroke="#E46F3E" strokeWidth="1.6" fill="none" /></svg>
);
const PawIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="#E46F3E"><ellipse cx="12" cy="16" rx="5" ry="4" /><circle cx="6" cy="10" r="2.2" /><circle cx="10" cy="6.5" r="2.2" /><circle cx="14" cy="6.5" r="2.2" /><circle cx="18" cy="10" r="2.2" /></svg>
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
