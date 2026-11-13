"use client";
/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";

/** Shared cozy UI pieces for the game shell (journey, menu, panels). */
export const card = "rounded-[24px] border-[2.5px] border-[#8A6448] bg-[#FFF9F0]/96 shadow-[0_4px_0_#8A644833,0_14px_40px_-14px_#3A2A2277]";
export const btnBase =
  "rounded-2xl border-[2.5px] border-[#8A6448] font-extrabold text-[#3A2A22] shadow-[0_3px_0_#8A6448] active:translate-y-[2px] active:shadow-[0_1px_0_#8A6448] transition disabled:opacity-50 disabled:active:translate-y-0";
export const btn = `${btnBase} bg-[#FFF9F0] hover:bg-white`;
export const btnP = `${btnBase} bg-[#F58A3C] text-white hover:bg-[#F27D2A]`;

/** DB animal → mascot art (public/mascots/<mascot>.png) and its display name. */
export const MASCOT: Record<string, { img: string; label: string; blurb: string }> = {
  cat: { img: "cat", label: "Cat", blurb: "Curious and tidy, first to every build site." },
  bunny: { img: "rabbit", label: "Bunny", blurb: "Quick hops, quicker deliveries." },
  otter: { img: "otter", label: "Otter", blurb: "Loves rivers, roads and holding paws." },
  fox: { img: "fox", label: "Fox", blurb: "Clever with a hammer, gentle with friends." },
  bear: { img: "panda", label: "Panda", blurb: "Strong arms for big logs." },
  dog: { img: "dog", label: "Dog", blurb: "Loyal, cheerful, never misses a delivery." },
  raccoon: { img: "raccoon", label: "Raccoon", blurb: "Finds a use for every spare plank." },
  capybara: { img: "bird", label: "Bird", blurb: "Sings while the town wakes up." },
};
export const ANIMAL_KEYS = Object.keys(MASCOT);

/** The painted road scenery as a page backdrop (same art as the world map). */
export function SceneBackdrop({ children, dim = false }: { children?: ReactNode; dim?: boolean }) {
  const layer = (src: string, h: string, bottom: string, extra = "") => (
    <div className={`pointer-events-none absolute inset-x-0 ${extra}`} style={{ bottom, height: h, backgroundImage: `url(${src})`, backgroundRepeat: "repeat-x", backgroundSize: "auto 100%", backgroundPosition: "bottom left" }} />
  );
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#BFE3F2]" style={{ backgroundImage: "url(/game/sprites/road/sky.png)", backgroundSize: "cover", backgroundPosition: "center bottom" }}>
      {layer("/game/sprites/road/clouds.png", "26vh", "62vh", "animate-[hsclouds_120s_linear_infinite]")}
      {layer("/game/sprites/road/mountains.png", "42vh", "22vh")}
      {layer("/game/sprites/road/hills.png", "30vh", "12vh")}
      {layer("/game/sprites/road/treeline.png", "28vh", "4vh")}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[8vh]" style={{ backgroundImage: "url(/game/sprites/road/road.png)", backgroundRepeat: "repeat-x", backgroundSize: "auto 300%", backgroundPosition: "center 55%" }} />
      {dim && <div className="absolute inset-0 bg-[#3A2A22]/25" />}
      <style>{`@keyframes hsclouds { from { background-position: 0 bottom } to { background-position: -1600px bottom } }`}</style>
      {children}
    </div>
  );
}

export function Mascot({ animal, size = 64, className = "" }: { animal: string; size?: number; className?: string }) {
  const m = MASCOT[animal] ?? MASCOT.cat;
  return <img src={`/mascots/${m.img}.png`} alt={m.label} width={size} height={size} className={`rounded-2xl border-2 border-[#8A6448] bg-white object-cover ${className}`} style={{ width: size, height: size }} />;
}

export function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-label={`Step ${step + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-2.5 rounded-full transition-all ${i === step ? "w-8 bg-[#F58A3C]" : i < step ? "w-2.5 bg-[#F6C76C]" : "w-2.5 bg-[#E2D3C2]"}`} />
      ))}
    </div>
  );
}
