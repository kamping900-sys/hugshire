"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { FocusKind, TownGame } from "@/game/v4/TownGame";

type Phase = "drop" | "walk" | "tree" | "plot" | "board" | "ready";
const WALK_GOAL = 260; // world pixels: a few steps in any direction

const card = "rounded-3xl border-[3px] border-[#8A6448] bg-[#FFF9F0] shadow-[0_5px_0_#8A6448,0_18px_40px_rgba(0,0,0,0.3)]";
const btnP = "rounded-2xl border-[3px] border-[#8A6448] bg-[#F58A3C] px-5 py-2.5 font-black text-white shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448]";

function Key({ k, on }: { k: string; on: boolean }) {
  return <kbd className={`flex h-9 min-w-9 items-center justify-center rounded-lg border-2 border-b-4 px-1.5 text-sm font-black transition ${on ? "translate-y-0.5 border-[#C7601F] border-b-2 bg-[#F58A3C] text-white" : "border-[#C9B39C] bg-white text-[#3A2A22]"}`}>{k}</kbd>;
}

/**
 * First arrival in town after the journey: the helper drops in from the sky, the player learns to
 * walk, then the camera tours the Heart Tree, a building plot and the Notice Board. Skippable.
 */
export function ArrivalTutorial({ game, town, org, helper, mascot, planted, onDone }: { game: TownGame; town: string; org: string; helper: string; mascot: string; planted: boolean; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("drop");
  const [walked, setWalked] = useState(0);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [spot, setSpot] = useState<{ x: number; y: number; r: number } | null>(null);
  const [vh, setVh] = useState(800);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    game.focus(null);
    game.setPaused(false);
    onDone();
  };

  // 1. drop in from the sky
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(async () => {
      await game.dropIn();
      if (live) window.setTimeout(() => live && setPhase("walk"), 500);
    }, 900);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [game]);

  // 2. walking: unpause, track distance and which keys are held
  useEffect(() => {
    if (phase !== "walk") return;
    game.focus(null);
    game.setPaused(false);
    const start = game.walkedDistance();
    let advanced = false;
    // a timer, not animation frames: keeps working even when the browser throttles rendering
    const iv = window.setInterval(() => {
      const w = game.walkedDistance() - start;
      setWalked(w);
      if (w >= WALK_GOAL && !advanced) {
        advanced = true;
        window.setTimeout(() => setPhase("tree"), 600);
      }
    }, 100);
    const down = (e: KeyboardEvent) => setKeys((s) => new Set(s).add(e.key.toLowerCase()));
    const up = (e: KeyboardEvent) =>
      setKeys((s) => {
        const n = new Set(s);
        n.delete(e.key.toLowerCase());
        return n;
      });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, game]);

  // 3. spotlight tour: camera glides to each feature; the ring follows it on screen
  useEffect(() => {
    if (phase !== "tree" && phase !== "plot" && phase !== "board") {
      setSpot(null);
      return;
    }
    game.setPaused(true);
    game.focus(phase as FocusKind);
    let raf = 0;
    const loop = () => {
      setSpot(game.spotlight(phase as FocusKind));
      setVh(window.innerHeight);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const iv = window.setInterval(() => setSpot(game.spotlight(phase as FocusKind)), 150); // backup if frames are throttled
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(iv);
    };
  }, [phase, game]);

  useEffect(() => {
    if (phase === "ready") {
      game.focus(null);
      game.setPaused(true);
    }
  }, [phase, game]);

  const has = (...k: string[]) => k.some((x) => keys.has(x));
  const tour: Record<"tree" | "plot" | "board", { icon: string; title: string; text: string; next: Phase; n: number }> = {
    tree: {
      icon: "🌳",
      title: "This is your Heart Tree",
      text: planted
        ? "The money you planted is still yours. The interest it earns grows here as fruit, to the exact cent. When fruit is ripe, harvest it and send it to a cause."
        : "When you plant money, the interest it earns grows here as fruit. Harvest it and send it to a cause.",
      next: "plot",
      n: 1,
    },
    plot: {
      icon: "🏗️",
      title: "Help build the town",
      text: `Each plot becomes a building for ${town}. Start one or join one being built, then chop Wood in a quick rhythm game to help finish it.`,
      next: "board",
      n: 2,
    },
    board: {
      icon: "📌",
      title: "The Notice Board",
      text: `${org} posts real news here: what your help paid for, thank-yous and updates from the cause.`,
      next: "ready",
      n: 3,
    },
  };
  const t = phase === "tree" || phase === "plot" || phase === "board" ? tour[phase] : null;
  const cardTop = !!spot && spot.y > vh * 0.55; // keep the card away from the thing it explains

  return (
    <div className="absolute inset-0 z-40 select-none">
      {/* drop: a little welcome banner while the helper falls in */}
      {phase === "drop" && (
        <div className="pointer-events-none absolute inset-x-0 top-[14%] flex justify-center px-4">
          <div className="hs-bounce-in text-center">
            <div className="text-4xl font-black text-[#FFF9F0] sm:text-6xl" style={{ textShadow: "0 4px 0 #8A6448, 0 10px 30px rgba(0,0,0,0.35)" }}>
              Welcome to {town}!
            </div>
            <div className="hs-rise mt-2 text-lg font-extrabold text-[#FFF4E2] sm:text-xl" style={{ "--d": "300ms", textShadow: "0 2px 8px rgba(0,0,0,0.5)" } as React.CSSProperties}>
              {helper} is arriving…
            </div>
          </div>
        </div>
      )}

      {/* spotlight dim with a hole around the feature */}
      {spot && (
        <>
          <div className="hs-fade pointer-events-auto absolute inset-0" style={{ background: `radial-gradient(circle at ${spot.x}px ${spot.y}px, transparent ${spot.r}px, rgba(28,18,12,0.62) ${spot.r + 3}px)` }} />
          <div className="hs-ring pointer-events-none absolute rounded-full border-4 border-dashed border-[#FFD9A8]" style={{ left: spot.x - spot.r, top: spot.y - spot.r, width: spot.r * 2, height: spot.r * 2 }} />
        </>
      )}

      {/* skip, any time after landing */}
      {phase !== "drop" && phase !== "ready" && (
        <button type="button" onClick={finish} className="pointer-events-auto absolute right-3 top-3 rounded-full bg-[#3A2A22]/75 px-4 py-2 text-sm font-black text-[#FFF9F0] transition hover:bg-[#3A2A22] sm:right-4 sm:top-4">
          Skip tutorial ⏭
        </button>
      )}

      {/* walk */}
      {phase === "walk" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3 sm:bottom-8">
          <div className={`${card} hs-card-in pointer-events-auto w-full max-w-md p-4 sm:p-5`}>
            <div className="flex items-center gap-3">
              <img src={`/mascots/${mascot}.png`} alt="" className="h-12 w-12 shrink-0 object-contain" />
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Let&apos;s go for a walk</div>
                <div className="text-lg font-black leading-tight text-[#3A2A22]">Move {helper} around {town}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-5">
              <div className="grid grid-cols-3 gap-1">
                <span />
                <Key k="W" on={has("w")} />
                <span />
                <Key k="A" on={has("a")} />
                <Key k="S" on={has("s")} />
                <Key k="D" on={has("d")} />
              </div>
              <span className="text-sm font-black text-[#9A887A]">or</span>
              <div className="grid grid-cols-3 gap-1">
                <span />
                <Key k="↑" on={has("arrowup")} />
                <span />
                <Key k="←" on={has("arrowleft")} />
                <Key k="↓" on={has("arrowdown")} />
                <Key k="→" on={has("arrowright")} />
              </div>
            </div>
            <p className="mt-2 text-center text-xs font-bold text-[#7B6A5C]">On a phone or with a mouse, tap the ground to walk there.</p>
            <div className="mt-3 h-3 overflow-hidden rounded-full border-2 border-[#E4D3BE] bg-white">
              <div className="h-full rounded-full bg-[#F58A3C] transition-[width] duration-200" style={{ width: `${Math.min(100, (walked / WALK_GOAL) * 100)}%` }} />
            </div>
            <div className="mt-1 text-center text-[11px] font-black text-[#8A6448]">{walked >= WALK_GOAL ? "Nice walking! 🎉" : "Keep walking…"}</div>
          </div>
        </div>
      )}

      {/* tour cards */}
      {t && (
        <div className={`pointer-events-none absolute inset-x-0 flex justify-center px-3 ${cardTop ? "top-16 sm:top-20" : "bottom-4 sm:bottom-8"}`}>
          <div key={phase} className={`${card} hs-card-in pointer-events-auto w-full max-w-md p-4 sm:p-5`}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Town tour · {t.n} of 3</div>
              <div className="flex gap-1">
                {[1, 2, 3].map((k) => (
                  <span key={k} className={`h-2 w-2 rounded-full ${k <= t.n ? "bg-[#F58A3C]" : "bg-[#E4D3BE]"}`} />
                ))}
              </div>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xl font-black text-[#3A2A22]">
              <span aria-hidden>{t.icon}</span> {t.title}
            </div>
            <p className="mt-1.5 text-[15px] font-semibold leading-snug text-[#5C4A3D]">{t.text}</p>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => setPhase(t.next)} className={btnP}>
                {t.n === 3 ? "Got it!" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ready */}
      {phase === "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[rgba(28,18,12,0.35)] p-4">
          <div className={`${card} hs-card-in w-full max-w-sm p-6 text-center`}>
            <img src={`/mascots/${mascot}.png`} alt="" className="hs-pop mx-auto h-20 w-20 object-contain" />
            <div className="mt-2 text-2xl font-black text-[#3A2A22]">You&apos;re all set!</div>
            <p className="mt-1 text-sm font-semibold text-[#5C4A3D]">Explore {town} with {helper}. Walk up to anything and press E (or tap it) to interact.</p>
            <button type="button" onClick={finish} className={`${btnP} mt-5 w-full text-lg`}>
              Start exploring →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
