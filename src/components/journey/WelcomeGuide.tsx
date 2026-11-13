"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A small "what to do next" hint for your first day in town. It shows ONE step at a time, appears a few
 * seconds after you arrive, and moves on to the next step once the current one is done.
 */
export function WelcomeGuide({ town, helper, done, ripe, onClose }: { town: string; helper: string; done: { tree: boolean; work: boolean; deliver: boolean }; ripe: boolean; onClose: () => void }) {
  const steps = [
    { k: "tree", icon: "🌳", t: "Visit your Heart Tree", d: "Walk to the big tree and press E. Its fruit is the real interest your money earns." },
    { k: "work", icon: "🪓", t: "Help build", d: "Walk to a building plot and press E, then chop Wood to help finish it." },
    { k: "deliver", icon: "🚚", t: "Send fruit to a cause", d: ripe ? "Your tree has ripe fruit! Pick it and send it to a town." : "When fruit ripens, pick it at your Heart Tree and send it to a town." },
  ] as const;
  const idx = steps.findIndex((s) => !done[s.k]);
  const [visible, setVisible] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const prev = useRef(idx);

  // appear a few seconds after arriving, not straight away
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 4000);
    return () => window.clearTimeout(t);
  }, []);
  // a step just got done: a quick "nice!" before the next one slides in
  useEffect(() => {
    if (idx !== prev.current) {
      prev.current = idx;
      setCelebrate(true);
      const t = window.setTimeout(() => setCelebrate(false), 1600);
      return () => window.clearTimeout(t);
    }
  }, [idx]);

  // everything done: show "all set" for a moment, then get out of the way
  useEffect(() => {
    if (idx !== -1 || !visible) return;
    const t = window.setTimeout(onClose, 7000);
    return () => window.clearTimeout(t);
  }, [idx, visible, onClose]);

  if (!visible) return null;
  const all = idx === -1;
  const s = all ? null : steps[idx];

  return (
    <div className="hs-rise pointer-events-auto absolute bottom-28 right-3 z-30 w-[min(280px,calc(100vw-24px))] sm:bottom-6 sm:right-4">
      <div className="rounded-2xl border-2 border-[#8A6448]/40 bg-[#FFF9F0]/90 px-3 py-2.5 shadow-[0_6px_18px_rgba(0,0,0,0.15)] backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-wider text-[#C7601F]/80">
            {all ? `${helper}'s first day` : `Next step · ${idx + 1} of ${steps.length}`}
          </div>
          <div className="flex items-center gap-1.5">
            {steps.map((x, i) => (
              <span key={x.k} className={`h-1.5 w-1.5 rounded-full ${done[x.k] ? "bg-[#3F9B5B]" : i === idx ? "bg-[#F58A3C]" : "bg-[#D9CBBB]"}`} />
            ))}
            <button onClick={onClose} aria-label="Hide guide" className="ml-1 rounded-full px-1 text-sm font-black leading-none text-[#9A887A] hover:text-[#3A2A22]">
              ×
            </button>
          </div>
        </div>
        {celebrate ? (
          <div key="nice" className="hs-pop mt-1 flex items-center gap-2 text-sm font-black text-[#3F9B5B]">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5BBF7A] text-xs text-white">✓</span> Nice! {all ? "You're all set 🎉" : "On to the next one…"}
          </div>
        ) : all ? (
          <div className="mt-1 text-sm font-black text-[#3A2A22]">You&apos;re all set in {town} 🎉</div>
        ) : (
          <div key={s!.k} className="hs-rise mt-1 flex gap-2.5">
            <span className="text-2xl leading-none">{s!.icon}</span>
            <span>
              <span className="block text-sm font-black text-[#3A2A22]">{s!.t}</span>
              <span className="block text-[11px] font-semibold leading-snug text-[#7B6A5C]">{s!.d}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
