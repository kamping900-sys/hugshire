"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { CAUSE_PROFILES } from "@/game/v4/causeInfo";

const BOARD = "/game/sprites/ui/town_board.png";

/** Does the painted board art exist? (falls back to a board drawn in CSS) */
function useBoardArt() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const i = new Image();
    i.onload = () => setOk(true);
    i.onerror = () => setOk(false);
    i.src = BOARD;
  }, []);
  return ok;
}

/**
 * A hanging wooden sign at the top centre: the place name, a small subtitle and an optional ⓘ.
 * Used for the town title and for each stop on the world map.
 */
export function TitleBoard({ title, subtitle, onInfo, className = "" }: { title: string; subtitle?: string; onInfo?: () => void; className?: string }) {
  const art = useBoardArt();
  if (art) {
    // the painted board (ropes and flowers included): keep its proportions, write on the plank
    return (
      <div className={`pointer-events-none flex justify-center ${className}`}>
        <div data-title-board className="hs-board-swing pointer-events-auto relative aspect-[1000/324] w-[min(90vw,470px)] origin-top bg-contain bg-center bg-no-repeat drop-shadow-[0_8px_12px_rgba(0,0,0,0.25)]" style={{ backgroundImage: `url(${BOARD})` }}>
          <div className="absolute inset-x-[11%] bottom-[16%] top-[33%] flex flex-col items-center justify-center text-center">
            <div className="max-w-full truncate text-2xl font-black leading-none tracking-tight text-[#FFF9F0] sm:text-[32px]" style={{ textShadow: "0 3px 0 #6B4A33, 0 0 6px rgba(107,74,51,0.5)" }}>
              {title}
            </div>
            {subtitle && <div className="mt-1 max-w-full truncate text-[11px] font-black text-[#FFF4E2] sm:text-[13px]" style={{ textShadow: "0 1px 0 #6B4A33, 0 0 4px rgba(107,74,51,0.6)" }}>{subtitle}</div>}
          </div>
          {onInfo && (
            <button
              onClick={onInfo}
              aria-label="About this cause"
              className="absolute right-[1%] top-[52%] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-[#6B4A33] bg-[#FFF9F0] text-lg font-black italic text-[#C7601F] shadow-[0_3px_0_#6B4A33] transition hover:scale-110"
            >
              i
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`pointer-events-none flex justify-center ${className}`}>
      <div data-title-board className="hs-board-swing pointer-events-auto relative origin-top">
        {/* ropes */}
        <span aria-hidden className="absolute -top-4 left-[18%] h-6 w-1 rounded bg-[#8A6448]" />
        <span aria-hidden className="absolute -top-4 right-[18%] h-6 w-1 rounded bg-[#8A6448]" />
        <div
          className={`relative min-w-[230px] max-w-[min(86vw,460px)] px-9 pb-3 pt-2.5 text-center ${art ? "" : "rounded-[18px] border-[3px] border-[#6B4A33] shadow-[0_5px_0_#6B4A33,0_12px_24px_rgba(0,0,0,0.3)]"}`}
          style={
            art
              ? { backgroundImage: `url(${BOARD})`, backgroundSize: "100% 100%", minHeight: 86 }
              : { background: "repeating-linear-gradient(180deg, #D89A5C 0 13px, #CE8E50 13px 15px)", }
          }
        >
          {!art && (
            <>
              <span aria-hidden className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-[#8A6448] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]" />
              <span aria-hidden className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[#8A6448] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]" />
              <span aria-hidden className="absolute -left-3 -top-2 text-xl">🌿</span>
              <span aria-hidden className="absolute -right-2 -top-2 text-lg">🌼</span>
            </>
          )}
          <div className="truncate text-2xl font-black tracking-tight text-[#FFF9F0] sm:text-3xl" style={{ textShadow: "0 3px 0 #6B4A33" }}>
            {title}
          </div>
          {subtitle && <div className="mt-0.5 truncate text-[11px] font-black text-[#FFE7C2] sm:text-xs" style={{ textShadow: "0 1px 0 #6B4A33" }}>{subtitle}</div>}
          {onInfo && (
            <button
              onClick={onInfo}
              aria-label="About this cause"
              className="absolute -right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-[#6B4A33] bg-[#FFF9F0] text-lg font-black italic text-[#C7601F] shadow-[0_3px_0_#6B4A33] transition hover:scale-110"
            >
              i
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type TownInfo = { slug: string; title: string; summary: string; cityName: string; org: string; category: string };

/** "About this cause": who they are, what the money buys, what they've done and their latest news. */
export function CauseInfoModal({ town, onClose }: { town: TownInfo; onClose: () => void }) {
  const p = CAUSE_PROFILES[town.slug];
  const pct = p ? Math.min(100, Math.round((p.raisedUsd / p.goalUsd) * 100)) : 0;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-[#3A2A22]/40 p-3 sm:items-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hs-card-in max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-[26px] border-[3px] border-[#8A6448] bg-[#FFF9F0] shadow-[0_5px_0_#8A6448,0_18px_40px_rgba(0,0,0,0.3)]">
        {/* header */}
        <div className="relative rounded-t-[23px] bg-gradient-to-br from-[#F7B27A] to-[#F58A3C] px-5 pb-4 pt-5 text-white">
          <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/25 text-lg font-black hover:bg-white/40">×</button>
          <div className="text-xs font-black uppercase tracking-wider opacity-90">{town.cityName}</div>
          <div className="pr-8 text-2xl font-black leading-tight">{town.title}</div>
          <div className="mt-1 text-sm font-bold opacity-95">by {town.org}</div>
          {p && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-black">
              <span className="rounded-full bg-white/25 px-2 py-0.5">📅 Since {p.founded}</span>
              <span className="rounded-full bg-white/25 px-2 py-0.5">📍 {p.basedIn}</span>
              <span className="rounded-full bg-white/25 px-2 py-0.5">🤝 {p.team}</span>
            </div>
          )}
        </div>

        <div className="space-y-4 p-5">
          <p className="text-[15px] font-semibold leading-relaxed text-[#3A2A22]">{p?.mission ?? town.summary}</p>

          {p && (
            <>
              {/* goal */}
              <div className="rounded-2xl border-2 border-[#E4D3BE] bg-white p-3">
                <div className="flex items-baseline justify-between text-sm font-black">
                  <span>This project&apos;s goal</span>
                  <span className="num text-[#C7601F]">
                    ${p.raisedUsd.toLocaleString()} <span className="text-[#9A887A]">of ${p.goalUsd.toLocaleString()}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-3.5 overflow-hidden rounded-full border-2 border-[#8A6448] bg-[#EADCC8]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#F2A23A] to-[#F58A3C]" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[11px] font-bold text-[#7B6A5C]">{pct}% funded by helpers&apos; fruit deliveries</div>
              </div>

              {/* impact */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {p.impact.map((x) => (
                  <div key={x.label} className="rounded-2xl bg-[#F6EDE2] px-2 py-2.5">
                    <div className="text-xl">{x.icon}</div>
                    <div className="num text-lg font-black text-[#3A2A22]">{x.value}</div>
                    <div className="text-[10px] font-bold leading-tight text-[#7B6A5C]">{x.label}</div>
                  </div>
                ))}
              </div>

              {/* what your fruit buys */}
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">What your fruit buys</div>
                <div className="mt-1.5 space-y-1">
                  {p.budget.map((b) => (
                    <div key={b.item} className="flex items-center justify-between rounded-xl bg-white px-3 py-1.5 text-sm font-bold text-[#3A2A22]">
                      <span>{b.item}</span>
                      <span className="num text-[#7B6A5C]">${b.usd}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* news */}
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Latest from {town.org}</div>
                <div className="mt-1.5 space-y-2">
                  {p.updates.map((u) => (
                    <div key={u.title} className="rounded-2xl border-l-4 border-[#F58A3C] bg-white px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-black text-[#3A2A22]">{u.title}</span>
                        <span className="shrink-0 text-[10px] font-black text-[#9A887A]">{u.date}</span>
                      </div>
                      <div className="text-xs font-semibold leading-snug text-[#5C4A3D]">{u.body}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-center text-xs font-bold text-[#7B6A5C]">🕒 {p.contact}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
