"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/money";
import { actionReward, comboBps, formatRes, RES_UNIT, RULES, type Judgement, type WoodRound } from "@/game/v4/rules";
import { blueprint, stageOf } from "@/game/v4/town";
import type { Mascot } from "@/game/world/mascots";
import type { WoodScene } from "@/game/v4/scenes";
import type { TownProject } from "@/game/v4/TownGame";
import { isMuted, setMuted, sfx } from "@/game/v4/sfx";

export type SessionView = {
  id: string;
  resource: "wood" | "stone";
  status: "open" | "ended";
  endReason: string | null;
  hearts: number;
  combo: number;
  bestCombo: number;
  round: number;
  earnedMicro: string;
  baseRewardMicro: string;
  capMicro: string;
  stats: { perfect: number; hit: number; miss: number; fakeouts: number; flags: string[] };
  chart: WoodRound | null;
};

const END_TITLE: Record<string, string> = {
  hearts: "Out of hearts!",
  cap: "Max Wood reached!",
  quit: "Nice chopping!",
  timeout: "Time's up!",
  building_done: "Building complete! 🎉",
  invalid: "Session not counted",
  ineligible: "No active deposit",
  daily_limit: "Free play done for today",
};
const END_SUB: Record<string, string> = {
  hearts: "Three misses and the axe needs a rest.",
  cap: "You hit the 50,000 Wood session cap.",
  building_done: "This building has all the Wood it needs!",
  invalid: "Anti-automation checks flagged this session, so nothing was committed.",
  daily_limit: "Today's 10 free Wood are used up. Come back tomorrow!",
};

const card = "rounded-[26px] border-[3px] border-[#8A6448] bg-[#FFF9F0] shadow-[0_5px_0_#8A6448,0_18px_40px_rgba(0,0,0,0.3)]";
const btnBase = "rounded-2xl border-[3px] border-[#8A6448] font-black text-[#3A2A22] shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448] disabled:opacity-50 disabled:hover:translate-y-0";
const btn = `${btnBase} bg-[#FFF9F0]`;
const btnP = `${btnBase} bg-[#F58A3C] text-white`;
const S = "/game/sprites";
const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
/** Buildings with their own stage art (retired ones borrow a same-size building's art). */
const STAGE_ART = new Set(["cottage", "house", "bookshop", "barn", "school", "townHall"]);

/**
 * The Wood timing-bar game. Each round the server reveals a few attempts; the scene plays them one
 * by one (instant local feedback using the same rules), then the raw stop times go to the server,
 * which re-judges them and is the only source of hearts, combo and Wood.
 */
export function MiniGameOverlay({
  session: initial,
  mascot,
  buildingName,
  project,
  onClose,
  onPlayAgain,
}: {
  session: SessionView;
  mascot: Mascot;
  buildingName: string;
  project?: TownProject;
  onClose: (s: SessionView) => void;
  onPlayAgain?: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const scene = useRef<WoodScene | null>(null);
  const [s, setS] = useState(initial);
  const [hearts, setHearts] = useState(initial.hearts);
  const [combo, setCombo] = useState(initial.combo);
  const [pending, setPending] = useState(0n); // Wood earned this round, shown before the server confirms
  const [phase, setPhase] = useState<"intro" | "play" | "done">("intro");
  const [err, setErr] = useState<string | null>(null);
  const [muted, setMute] = useState(isMuted());
  const [hurt, setHurt] = useState(0); // bumps when a heart is lost (shake)
  const live = useRef(true);
  const local = useRef({ hearts: initial.hearts, combo: initial.combo });

  useEffect(() => {
    live.current = true;
    let sc: WoodScene | null = null;
    let dead = false;
    (async () => {
      const mod = await import("@/game/v4/scenes");
      // React runs effects twice in development: without this check two scenes were created and the
      // idle one ended up on top, hiding the timing bar of the one actually being played
      if (dead || !el.current) return;
      sc = new mod.WoodScene(mascot, () => {});
      scene.current = sc;
      if (process.env.NODE_ENV === "development") (window as unknown as { __hsScene?: unknown }).__hsScene = sc; // dev-only debugging handle
      if (el.current) await sc.mount(el.current);
    })();
    return () => {
      dead = true;
      live.current = false;
      sc?.destroy();
      scene.current = null;
    };
  }, [mascot]);

  async function run(first: SessionView) {
    setPhase("play");
    let cur = first;
    const base = BigInt(first.baseRewardMicro);
    while (live.current && cur.status === "open" && cur.chart) {
      const sc = scene.current;
      if (!sc) break;
      local.current = { hearts: cur.hearts, combo: cur.combo };
      setHearts(cur.hearts);
      setCombo(cur.combo);
      setPending(0n);
      sc.setCombo(cur.combo);
      const stops: (number | null)[] = [];
      const attempts = cur.chart.attempts;
      for (const a of attempts) {
        if (!live.current || local.current.hearts <= 0) break;
        const group = attempts.filter((x) => (x.group ?? x.n) === (a.group ?? a.n));
        let judged: Judgement | null = null;
        const stop = await new Promise<number | null>((resolve) => {
          // the scene reports its judgement instantly; we predict hearts/combo/Wood for the HUD
          sc.onJudged = (j) => {
            judged = j;
            if (j.result === "miss") {
              local.current.hearts -= 1;
              local.current.combo = 0;
              setHurt((h) => h + 1);
            } else {
              local.current.combo += 1;
              const w = actionReward(base, j.result, local.current.combo);
              setPending((p) => p + w);
              sc.showReward(`+${formatRes(w)} Wood`);
            }
            setHearts(local.current.hearts);
            setCombo(local.current.combo);
          };
          void sc.playAttempt(a, group).then(resolve);
        });
        void judged;
        stops.push(stop);
      }
      if (!live.current) return;
      try {
        const r = await api<{ session: SessionView }>(`/api/minigame/${cur.id}`, "POST", { action: "round", round: cur.round, stops });
        cur = r.session;
        setS(cur);
        setPending(0n);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Connection problem. Your progress so far is saved.");
        try {
          cur = (await api<{ session: SessionView }>(`/api/minigame/${cur.id}`, "POST", { action: "quit" })).session;
          setS(cur);
        } catch {
          /* the server ends idle sessions on its own */
        }
        break;
      }
    }
    if (cur.status === "ended") {
      if (cur.endReason === "hearts" || cur.endReason === "invalid") sfx.over();
      else sfx.win();
    }
    setPhase("done");
  }

  async function quit() {
    live.current = false;
    try {
      const r = await api<{ session: SessionView }>(`/api/minigame/${s.id}`, "POST", { action: "quit" });
      setS(r.session);
    } catch {
      /* ignore */
    }
    setPhase("done");
  }

  // "damaged": the whole game view jolts when a heart is lost
  useEffect(() => {
    if (!hurt || !el.current) return;
    el.current.animate(
      [
        { transform: "translate(0,0)" },
        { transform: "translate(-14px, 6px) rotate(-0.6deg)" },
        { transform: "translate(12px, -5px) rotate(0.5deg)" },
        { transform: "translate(-8px, 3px)" },
        { transform: "translate(5px, -2px)" },
        { transform: "translate(0,0)" },
      ],
      { duration: 420, easing: "ease-out" },
    );
  }, [hurt]);

  const shownHearts = phase === "done" ? s.hearts : Math.max(0, Math.min(s.hearts, hearts));
  const shownCombo = phase === "done" ? s.combo : combo;
  const earned = BigInt(s.earnedMicro) + (phase === "done" ? 0n : pending);
  const mult = Number(comboBps(shownCombo)) / 10000;

  return (
    <div className="fixed inset-0 z-50 select-none bg-[#3A2A22]/60" role="dialog" aria-modal="true" aria-label="Wood chopping mini-game">
      <div ref={el} className="absolute inset-0" />

      {/* got hit: a red flash around the screen */}
      {hurt > 0 && phase === "play" && <div key={`hurt${hurt}`} aria-hidden className="hs-hurt pointer-events-none absolute inset-0 z-10" />}

      {/* HUD: big hearts (left), big Wood score (centre), sound + quit (right); combo on the right side */}
      {phase !== "done" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 sm:p-4">
          <div className="flex items-center gap-0.5 sm:gap-1" aria-label={`${shownHearts} hearts left`}>
            {[0, 1, 2].map((k) => (
              <GameHeart key={k} full={k < shownHearts} breaking={k === shownHearts && hurt > 0} hurtKey={hurt} />
            ))}
          </div>

          <div className={`${card} flex items-center gap-2 px-4 py-1 sm:px-6 sm:py-1.5`}>
            <img src={`${S}/wood/log.png`} alt="" className="h-8 w-auto sm:h-11" />
            <div className="leading-none">
              <div key={earned.toString()} className="hs-pop num text-3xl font-black text-[#3A2A22] sm:text-5xl">
                {formatRes(earned, 1)}
              </div>
              <div className="mt-0.5 text-[10px] font-black uppercase tracking-wider text-[#8A6448] sm:text-xs">Wood collected</div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <button onClick={() => { setMuted(!muted); setMute(!muted); }} className={`${btn} pointer-events-auto h-11 w-11`} aria-label={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
            <button onClick={quit} className={`${btn} pointer-events-auto px-3 py-2 text-sm`}>Quit</button>
          </div>
        </div>
      )}

      {/* combo + Wood multiplier, on the right side */}
      {phase === "play" && shownCombo >= 2 && (
        <div className="pointer-events-none absolute right-3 top-1/2 z-20 -translate-y-1/2 sm:right-6">
          <div key={shownCombo} className="hs-pop flex flex-col items-center">
            <div className={`num text-5xl font-black leading-none sm:text-7xl ${shownCombo >= 10 ? "text-[#FF5A1A]" : shownCombo >= 5 ? "text-[#FF7A2F]" : "text-[#F2A23A]"}`} style={{ textShadow: "0 4px 0 #8A2A1F, 0 0 18px rgba(255,138,60,0.6)", WebkitTextStroke: "2px #FFF9F0" }}>
              ×{shownCombo}
            </div>
            <div className="mt-1 text-sm font-black tracking-widest text-[#FFF9F0] sm:text-base" style={{ textShadow: "0 2px 0 #8A2A1F" }}>
              {shownCombo >= 5 ? "🔥 COMBO" : "COMBO"}
            </div>
            <div className={`mt-1.5 rounded-full border-[3px] border-[#8A2A1F] px-3 py-0.5 text-sm font-black text-white shadow-[0_3px_0_#8A2A1F] sm:text-base ${mult > 1 ? "bg-gradient-to-r from-[#FF7A2F] to-[#DB2777]" : "bg-[#C9B39C]"}`}>
              {mult > 1 ? `${mult.toFixed(2)}× Wood` : `${5 - (shownCombo % 5)} more for a bonus`}
            </div>
          </div>
        </div>
      )}

      {phase === "intro" && <Guide base={s.baseRewardMicro} building={buildingName} onStart={() => { sfx.tick(true); void run(s); }} />}
      {phase === "done" && <Results s={s} err={err} buildingName={buildingName} project={project} onClose={() => onClose(s)} onPlayAgain={onPlayAgain} />}
    </div>
  );
}

/** A tiny drawing of the timing bar for the guide. */
function MiniBar({ green = 0.55, marker = 0.55, double = false, faded = false }: { green?: number; marker?: number; double?: boolean; faded?: boolean }) {
  const zones = double ? [0.28, 0.72] : [green];
  return (
    <svg viewBox="0 0 120 34" className="h-9 w-full" aria-hidden>
      <rect x="2" y="9" width="116" height="18" rx="9" fill="#FFF9F0" stroke="#8A6448" strokeWidth="3" />
      {zones.map((z) => (
        <g key={z}>
          <rect x={4 + z * 112 - 16} y="11" width="32" height="14" rx="5" fill="#F6D35C" />
          <rect x={4 + z * 112 - 6} y="11" width="12" height="14" rx="4" fill="#5CC17A" />
        </g>
      ))}
      <g opacity={faded ? 0.25 : 1}>
        <rect x={4 + marker * 112 - 2.5} y="3" width="5" height="30" rx="2.5" fill="#3A2A22" />
        <path d={`M${4 + marker * 112 - 5} 1 L${4 + marker * 112 + 5} 1 L${4 + marker * 112} 7 Z`} fill="#3A2A22" />
      </g>
    </svg>
  );
}

/** A glossy game heart; lost ones crack and fall away. */
function GameHeart({ full, breaking, hurtKey, small = false }: { full: boolean; breaking: boolean; hurtKey: number; small?: boolean }) {
  return (
    <span key={breaking ? `b${hurtKey}` : "h"} className={`relative inline-block ${small ? "h-8 w-9" : "h-11 w-12 sm:h-14 sm:w-16"} ${breaking ? "hs-heart-break" : full ? "hs-heart-beat" : ""}`}>
      <svg viewBox="0 0 64 58" className="h-full w-full drop-shadow-[0_4px_0_rgba(80,20,15,0.55)]" aria-hidden>
        <path d="M32 54 C 10 38, 2 26, 2 16 C 2 7, 9 2, 17 2 C 24 2, 29 6, 32 11 C 35 6, 40 2, 47 2 C 55 2, 62 7, 62 16 C 62 26, 54 38, 32 54 Z" fill={full ? "#F0473B" : "#5C4A3D"} fillOpacity={full ? 1 : 0.45} stroke="#5A1A12" strokeWidth="4" strokeLinejoin="round" />
        {full && <path d="M14 12 C 16 8, 21 7, 24 9" fill="none" stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="5" strokeLinecap="round" />}
        {full && <ellipse cx="44" cy="30" rx="10" ry="7" fill="#C42A20" opacity="0.35" />}
        {!full && <path d="M32 12 L28 24 L35 31 L29 44" fill="none" stroke="#2B1C15" strokeOpacity="0.6" strokeWidth="3" strokeLinejoin="round" />}
      </svg>
    </span>
  );
}

function Guide({ base, building, onStart }: { base: string; building: string; onStart: () => void }) {
  const steps = [
    { art: <MiniBar />, title: "Stop in the green", text: "Green = PERFECT, double Wood! Yellow = Hit." },
    {
      art: (
        <div className="flex items-center justify-center gap-1.5">
          <kbd className="rounded-lg border-2 border-b-4 border-[#8A6448] bg-white px-2 py-0.5 text-xs font-black">SPACE</kbd>
          <span className="text-xs font-black text-[#9A887A]">or</span>
          <span className="text-2xl">👆</span>
        </div>
      ),
      title: "Chop!",
      text: "Press Space, click or tap at the right moment.",
    },
    {
      art: (
        <div className="flex gap-0.5">
          {[0, 1, 2].map((k) => (
            <span key={k} className="inline-block">
              <GameHeart full small breaking={false} hurtKey={0} />
            </span>
          ))}
        </div>
      ),
      title: "3 hearts",
      text: "Each miss breaks a heart. Lose all 3 and you're done.",
    },
    { art: <div className="hs-jiggle num text-3xl font-black text-[#FF6A1A]" style={{ textShadow: "0 2px 0 #8A2A1F" }}>🔥×10</div>, title: "Build a combo", text: "Hit after hit = bonus Wood!" },
  ];
  const colors = ["#5BBF7A", "#F58A3C", "#E2523F", "#9B6BD6"];
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(20,12,8,0.72)] p-3 sm:p-4">
      <div className={`${card} hs-card-in w-full max-w-lg p-5 sm:p-6`}>
        <div className="flex items-center justify-center gap-3">
          <span className="inline-block -scale-x-100"><span className="hs-chop inline-block"><img src={`${S}/wood/axe.png`} alt="" className="h-14 w-auto" /></span></span>
          <div className="text-center">
            <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">For {building}</div>
            <div className="text-3xl font-black text-[#3A2A22]">Wood Chopping</div>
          </div>
          <img src={`${S}/wood/log.png`} alt="" className="h-12 w-auto" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {steps.map((st, i) => (
            <div key={st.title} className="hs-bounce-in relative rounded-2xl border-[3px] bg-white px-3 pb-3 pt-5 text-center shadow-[0_4px_0_rgba(138,100,72,0.35)]" style={{ ...d(120 + i * 140), borderColor: colors[i] }}>
              <span className="absolute -top-4 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-white text-base font-black text-white shadow-[0_3px_0_rgba(0,0,0,0.2)]" style={{ background: colors[i] }}>
                {i + 1}
              </span>
              <div className="flex h-10 items-center justify-center">{st.art}</div>
              <div className="mt-1.5 text-base font-black text-[#3A2A22]">{st.title}</div>
              <div className="mt-0.5 text-[11px] font-semibold leading-snug text-[#7B6A5C]">{st.text}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-xs font-black text-[#8A6448]">
          🪵 {formatRes(base, 2)} Wood per Hit{BigInt(base) === RULES.freeBaseMicro ? ` · free play: up to ${formatRes(RULES.freeDailyCapMicro, 0)} a day` : ""}
        </p>
        <button onClick={onStart} className={`${btnP} hs-glow mt-3 w-full py-3.5 text-xl`}>
          Start chopping! 🪓
        </button>
      </div>
    </div>
  );
}

/** Counts a number up from 0 for the results screen. */
function useCountUp(target: number, ms = 1200, delay = 0) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let k = 0;
    const steps = 30;
    const start = window.setTimeout(() => {
      const iv = window.setInterval(() => {
        k += 1;
        setV(target * Math.min(1, k / steps));
        if (k >= steps) window.clearInterval(iv);
      }, ms / steps);
    }, delay);
    return () => window.clearTimeout(start);
  }, [target, ms, delay]);
  return v;
}

function Results({ s, err, buildingName, project, onClose, onPlayAgain }: { s: SessionView; err: string | null; buildingName: string; project?: TownProject; onClose: () => void; onPlayAgain?: () => void }) {
  const earned = BigInt(s.earnedMicro);
  const earnedN = Number(earned) / Number(RES_UNIT);
  const total = s.stats.perfect + s.stats.hit + s.stats.miss;
  const stars = earned <= 0n ? 0 : 1 + (s.bestCombo >= 5 ? 1 : 0) + (total > 0 && s.stats.perfect / total >= 0.5 ? 1 : 0);
  // building progress before → after this session
  const req = project ? BigInt(project.woodRequired) : 0n;
  const before = project ? BigInt(project.woodContributed) : 0n;
  const after = project ? (before + earned > req ? req : before + earned) : 0n;
  const pct = (x: bigint) => (req > 0n ? Number((x * 10000n) / req) / 100 : 0);
  const [bar, setBar] = useState(pct(before));
  const [arrived, setArrived] = useState(false);
  const bp = project ? blueprint(project.blueprintKey) : undefined;
  const stageBefore = stageOf(pct(before) / 100, project?.status ?? "active");
  const stageAfter = stageOf(pct(after) / 100, after >= req && req > 0n ? "completed" : project?.status ?? "active");
  const stage = arrived ? stageAfter : stageBefore;
  const logs = Math.max(3, Math.min(8, s.stats.perfect + s.stats.hit));
  const woodShown = useCountUp(earnedN, 1100, 300);
  const canAgain = !!onPlayAgain && !["building_done", "daily_limit", "ineligible", "invalid"].includes(s.endReason ?? "") && after < req;

  useEffect(() => {
    // logs fly for ~1.3 s, then the building's bar fills
    const t1 = window.setTimeout(() => {
      setArrived(true);
      setBar(pct(after));
    }, 1500);
    return () => window.clearTimeout(t1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-[rgba(28,18,12,0.35)] p-3 sm:p-4">
      <div className={`${card} hs-card-in w-full max-w-lg p-5 sm:p-6`}>
        {/* title + stars */}
        <div className="text-center">
          <div className="flex justify-center gap-1">
            {[0, 1, 2].map((k) => (
              <span key={k} className={`hs-pop text-4xl ${k < stars ? "" : "opacity-25 grayscale"}`} style={d(150 + k * 180)}>
                ⭐
              </span>
            ))}
          </div>
          <div className="mt-1 text-3xl font-black text-[#3A2A22]">{END_TITLE[s.endReason ?? ""] ?? "Session over"}</div>
          {END_SUB[s.endReason ?? ""] && <div className="text-sm font-bold text-[#7B6A5C]">{END_SUB[s.endReason ?? ""]}</div>}
        </div>

        {/* wood flies from your pile into the building */}
        {project && bp && (
          <div className="relative mt-4 flex h-36 items-end justify-between overflow-hidden rounded-2xl border-2 border-[#E4D3BE] px-4 pb-3 [container-type:inline-size]" style={{ background: `#CBE6B3 url(${S}/howto/background.png) center 70% / cover no-repeat` }}>
            <div className="relative z-10 flex flex-col items-center">
              <div className="relative h-16 w-20">
                {[0, 1, 2].map((k) => (
                  <img key={k} src={`${S}/wood/log.png`} alt="" className="absolute h-12 w-auto" style={{ left: k * 18, bottom: k === 1 ? 14 : 0, zIndex: k === 1 ? 2 : 1 }} />
                ))}
              </div>
              <span className="mt-1 rounded-full bg-white/90 px-2 text-[11px] font-black text-[#8A6448]">+{formatRes(earned, 2)} Wood</span>
            </div>
            {Array.from({ length: earned > 0n ? logs : 0 }, (_, k) => (
              <img key={k} src={`${S}/wood/log.png`} alt="" className="hs-fly absolute bottom-10 left-12 h-9 w-auto" style={{ "--dx": "calc(100cqw - 9rem)", "--d": `${200 + k * 140}ms` } as React.CSSProperties} />
            ))}
            <div className="relative z-10 flex flex-col items-center">
              <img key={stage} src={`${S}/stages/${STAGE_ART.has(bp.key) ? bp.key : ({ S: "cottage", M: "bookshop", L: "school" } as Record<string, string>)[bp.size] ?? "cottage"}_${Math.max(1, stage)}.png`} alt={bp.name} className={`h-24 w-auto object-contain ${arrived && stageAfter > stageBefore ? "hs-pop" : ""}`} />
              <span className="mt-1 rounded-full bg-white/90 px-2 text-[11px] font-black text-[#8A6448]">{buildingName}</span>
            </div>
            {arrived && stageAfter > stageBefore && <div className="hs-pop absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-[#3F9B5B] px-3 py-0.5 text-xs font-black text-white">Stage up! ⬆️</div>}
          </div>
        )}

        {/* building progress */}
        {project && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-xs font-black text-[#5C4A3D]">
              <span>{buildingName} progress</span>
              <span className="num">{bar.toFixed(1)}%</span>
            </div>
            <div className="relative mt-1 h-5 overflow-hidden rounded-full border-2 border-[#8A6448] bg-[#EADCC8]">
              <div className="absolute inset-y-0 left-0 bg-[#C9A77C]" style={{ width: `${pct(before)}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-[#F2A23A] to-[#F58A3C] transition-[width] duration-[1200ms] ease-out" style={{ width: `${bar}%` }} />
            </div>
            {arrived && earned > 0n && (
              <div className="hs-pop mt-1.5 text-center text-sm font-black text-[#C7601F]">
                +{Math.max(0.01, pct(after) - pct(before)).toFixed(2)}% from you! 💪
              </div>
            )}
          </div>
        )}

        {/* stats */}
        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-bold">
          <div className="rounded-xl bg-[#FFF1E6] p-2">
            <div className="num text-lg font-black text-[#C7601F]">{woodShown.toFixed(2)}</div>wood
          </div>
          <div className="rounded-xl bg-[#DCEFF9] p-2">
            <div className="num text-lg font-black text-[#2F6E92]">×{s.bestCombo}</div>best combo
          </div>
          <div className="rounded-xl bg-[#E4F4E6] p-2">
            <div className="num text-lg font-black text-[#3F9B5B]">{s.stats.perfect}</div>perfect
          </div>
          <div className="rounded-xl bg-[#FBE1DD] p-2">
            <div className="num text-lg font-black text-[#C8463A]">{s.stats.miss}</div>miss
          </div>
        </div>
        {err && <p className="mt-2 text-center text-xs font-bold text-[#C8463A]">{err}</p>}

        <AdAndButtons canAgain={canAgain} onPlayAgain={onPlayAgain} onClose={onClose} />
      </div>
    </div>
  );
}

/** Watch an ad (highlighted, optional, gives nothing extra), play again, or back to town. */
function AdAndButtons({ canAgain, onPlayAgain, onClose }: { canAgain: boolean; onPlayAgain?: () => void; onClose: () => void }) {
  const [ad, setAd] = useState<"idle" | "loading" | "showing" | "thanks" | "done" | "none">("idle");
  const [left, setLeft] = useState(3);
  const [view, setView] = useState<{ viewId: string; simulated: boolean; creative: { title: string; body: string } } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [golden, setGolden] = useState<bigint>(0n);
  useEffect(() => {
    if (ad !== "showing") return;
    const t = window.setInterval(() => setLeft((x) => x - 1), 1000);
    return () => window.clearInterval(t);
  }, [ad]);
  useEffect(() => {
    if (ad === "showing" && left <= 0 && view) {
      api<{ goldenMicro?: string }>("/api/ads", "POST", { action: "complete", viewId: view.viewId })
        .then((r) => setGolden(r.goldenMicro ? BigInt(r.goldenMicro) : 0n))
        .catch(() => setGolden(0n))
        .finally(() => setAd("thanks"));
    }
  }, [ad, left, view]);
  async function watch() {
    setAd("loading");
    try {
      const r = await api<{ ad: typeof view }>("/api/ads", "POST", { action: "request", placement: "after_minigame" });
      if (!r.ad) {
        setMsg("No ad available right now. Thank you anyway!");
        setAd("none");
        return;
      }
      setView(r.ad);
      setLeft(3);
      setAd("showing");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "No ad right now. Thank you anyway!");
      setAd("none");
    }
  }

  return (
    <div className="mt-4">
      {/* the ad plays full screen */}
      {ad === "showing" && view && createPortal(<FullScreenAd left={left} simulated={view.simulated} />, document.body)}
      {/* then: where the money went, in its own pop-up */}
      {ad === "thanks" && createPortal(
        <div className="hs-fade fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(20,12,8,0.7)] p-4">
          <div className="w-full max-w-md">
            <PoolDemo simulated={!!view?.simulated} goldenMicro={golden} />
            <button onClick={() => setAd("done")} className={`${btnP} mt-3 w-full py-3 text-base`}>
              Back to results
            </button>
          </div>
        </div>,
        document.body,
      )}
      {ad === "showing" || ad === "thanks" || ad === "done" ? (
        <div className="rounded-2xl bg-[#FFF7DC] p-3 text-center text-sm font-black text-[#8A6A1E]">💛 Thanks for watching! Your view filled the Community Pool.</div>
      ) : ad === "none" ? (
        <div className="rounded-2xl bg-[#F6EDE2] p-3 text-center text-sm font-bold text-[#7B6A5C]">{msg}</div>
      ) : (
        <button onClick={watch} disabled={ad === "loading"} className={`${btnBase} hs-glow relative w-full overflow-hidden bg-gradient-to-r from-[#FF7A2F] to-[#F2A23A] py-3.5 text-lg text-white`}>
          <span className="mr-1">📺</span> {ad === "loading" ? "Loading…" : "Watch an ad · help a cause"} <span className="ml-1">❤️</span>
          <span className="block text-[11px] font-bold opacity-90">Optional. The ad money goes to the Community Pool.</span>
        </button>
      )}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button onClick={onPlayAgain} disabled={!canAgain} className={`${btn} py-3`}>
          🔁 Play again
        </button>
        <button onClick={onClose} className={`${btn} py-3`}>
          🏡 Back to town
        </button>
      </div>
    </div>
  );
}

/** A cheerful stand-in ad, full screen, with a short countdown. */
function FullScreenAd({ left, simulated }: { left: number; simulated: boolean }) {
  const total = 3;
  return (
    <div className="hs-fade fixed inset-0 z-[80] flex flex-col items-center justify-center bg-[rgba(8,5,3,0.94)] p-4 text-center">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black text-white">Ad · {Math.max(0, left)}</span>
      </div>
      <div className="mb-5 text-2xl font-black tracking-wide text-white sm:text-3xl">Simulating ads…</div>
      <div className="hs-card-in w-full max-w-sm overflow-hidden rounded-[28px] border-4 border-white/90 bg-gradient-to-br from-[#FFE27A] via-[#FFB86B] to-[#FF8A7A] shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        <div className="px-6 pb-5 pt-7">
          <div className="hs-jiggle text-7xl">🍯</div>
          <div className="mt-2 text-3xl font-black text-[#5A2A10]" style={{ textShadow: "0 2px 0 rgba(255,255,255,0.6)" }}>Honeybee Jam</div>
          <div className="mt-1 text-base font-extrabold text-[#7A3A18]">Spread a little sunshine on every slice!</div>
          <div className="mt-4 inline-block rounded-full border-[3px] border-[#5A2A10] bg-white px-5 py-1.5 text-sm font-black text-[#5A2A10] shadow-[0_3px_0_#5A2A10]">Try it today 🐝</div>
        </div>
        <div className="h-2.5 bg-black/15">
          <div className="h-full bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${((total - Math.max(0, left)) / total) * 100}%` }} />
        </div>
      </div>
      <div className="mt-2 text-xs font-bold text-white/60">Thanks for helping the Community Pool 💛</div>
    </div>
  );
}

/**
 * After an ad: show where the ad money goes. Coins fly from the ad into the Community Heart Pool, then
 * the pool becomes golden fruit that every helper sends to a town. (Simulated ads create no revenue.)
 */
function PoolDemo({ simulated, goldenMicro }: { simulated: boolean; goldenMicro: bigint }) {
  const [charity, setCharity] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    fetch("/api/pool")
      .then((r) => r.json())
      .then((j) => setCharity(typeof j.charityBps === "number" ? j.charityBps / 100 : null))
      .catch(() => {});
    const t1 = window.setTimeout(() => setStep(1), 1300);
    const t2 = window.setTimeout(() => setStep(2), 2600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  return (
    <div className="hs-card-in overflow-hidden rounded-2xl border-[3px] border-[#F6C445] bg-gradient-to-b from-[#FFF7DC] to-[#FFE9B0] p-3 text-center">
      <div className="text-sm font-black text-[#3A2A22]">💛 Thank you! Here&apos;s where the ad money goes</div>
      {/* ad → coins → pool */}
      <div className="relative mt-2 flex h-24 items-end justify-between px-4 [container-type:inline-size]">
        <img src="/game/sprites/howto/ad.png" alt="" className="h-16 w-auto" />
        {[0, 1, 2, 3, 4].map((k) => (
          <span key={k} aria-hidden className="hs-fly absolute bottom-10 left-12 text-xl" style={{ "--dx": "calc(100cqw - 8.5rem)", "--d": `${150 + k * 180}ms` } as React.CSSProperties}>
            🪙
          </span>
        ))}
        <img src="/game/sprites/howto/heart_pool.png" alt="" className={`h-20 w-auto ${step >= 1 ? "hs-pop" : ""}`} />
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1.5 text-[11px] font-black text-[#5C4A3D]">
        <div className={`rounded-xl bg-white/80 px-1.5 py-1.5 transition ${step >= 0 ? "opacity-100" : "opacity-30"}`}>📺 Ad money comes in</div>
        <div className={`rounded-xl bg-white/80 px-1.5 py-1.5 transition ${step >= 1 ? "opacity-100" : "opacity-30"}`}>🧺 It all fills the Community Pool</div>
        <div className={`rounded-xl bg-white/80 px-1.5 py-1.5 transition ${step >= 2 ? "opacity-100" : "opacity-30"}`}>✨ Shared as golden fruit → you pick a town</div>
      </div>
      {step >= 2 && goldenMicro > 0n && (
        <div className="hs-pop mt-2.5 flex items-center justify-center gap-2 rounded-2xl border-2 border-[#F6C445] bg-white px-3 py-2">
          <img src="/game/sprites/town/fruit_gold_1.png" alt="" className="hs-jiggle h-9 w-auto" />
          <span className="text-left leading-tight">
            <span className="block text-sm font-black text-[#3A2A22]">+{formatUsd(goldenMicro)} golden fruit on your Heart Tree!</span>
            <span className="block text-[11px] font-bold text-[#7B6A5C]">It goes to your home town, or open ✨ Golden to pick another.</span>
          </span>
        </div>
      )}
      {step >= 2 && goldenMicro === 0n && <div className="hs-pop mt-2 text-xs font-black text-[#C7601F]">Every helper gets an equal share each month, so even free players help a cause! 🏡</div>}
      {simulated && <div className="mt-1.5 text-[10px] font-bold text-[#9A887A]">Test mode: the ad and its money are simulated. In the live game, ad money is shared out equally each month.</div>}
    </div>
  );
}
