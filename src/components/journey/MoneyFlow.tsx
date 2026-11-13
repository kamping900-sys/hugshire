"use client";
import { useEffect, useState } from "react";

/**
 * How the money actually travels (the live route, see docs/ARCHITECTURE.md §2).
 *  in:  Card → Coinbase Onramp (USDC on Base) → NEAR Intents 1Click (Base → NEAR) → Hugshire Vault → RHEA Lending → (interest) causes
 *  out: RHEA Lending → Hugshire Vault → NEAR Intents 1Click (NEAR → Base) → Coinbase Offramp → your bank
 */
type Step = { icon: string; logo?: string; name: string; what: string };
/** A step's badge: the partner's logo when it has one, else the emoji. */
function Badge({ s }: { s: Step }) {
  return s.logo ? <img src={s.logo} alt={s.name} className="h-full w-full rounded-full object-cover" /> : <>{s.icon}</>;
}

const IN: Step[] = [
  { icon: "💳", name: "Your card", what: "Card or Apple Pay" },
  { icon: "🔵", logo: "/brand/coinbase.svg", name: "Coinbase Onramp", what: "Buys USDC on Base, into your own wallet" },
  { icon: "🌉", logo: "/brand/near.svg", name: "NEAR Intents", what: "Moves your USDC from Base to NEAR" },
  { icon: "🔐", name: "Hugshire Vault", what: "Records it as yours, on chain" },
  { icon: "🌱", logo: "/brand/rhea.svg", name: "RHEA Lending", what: "Lends it out and earns interest" },
  { icon: "🏡", name: "Causes", what: "The interest goes to the causes you choose. Your deposit stays yours" },
];
const OUT: Step[] = [
  { icon: "🌱", logo: "/brand/rhea.svg", name: "RHEA Lending", what: "Your USDC is withdrawn" },
  { icon: "🔐", name: "Hugshire Vault", what: "Can only pay principal back to you" },
  { icon: "🌉", logo: "/brand/near.svg", name: "NEAR Intents", what: "Moves it from NEAR back to Base" },
  { icon: "🔵", logo: "/brand/coinbase.svg", name: "Coinbase Offramp", what: "Sells the USDC for dollars" },
  { icon: "🏦", name: "Your bank", what: "Cash in your account" },
];

/**
 * A step-by-step strip with a coin travelling along it. \`active\` highlights how far the money has got
 * (omit to just loop the animation as an explainer). \`compact\` = one row of icons for small spaces.
 */
export function MoneyFlow({ direction, active, compact = false, note }: { direction: "in" | "out"; active?: number; compact?: boolean; note?: string }) {
  const steps = direction === "in" ? IN : OUT;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (active !== undefined) return;
    const t = window.setInterval(() => setTick((x) => (x + 1) % steps.length), 900);
    return () => window.clearInterval(t);
  }, [active, steps.length]);
  const at = active ?? tick;

  if (compact) {
    return (
      <div className="rounded-2xl border-2 border-[#E4D3BE] bg-white px-2 py-2.5">
        <div className="flex items-start justify-between gap-0.5">
          {steps.map((s, i) => (
            <div key={s.name} className="flex flex-1 items-start">
              <div className="flex flex-1 flex-col items-center text-center">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full border-2 overflow-hidden text-lg transition ${i <= at ? "border-[#F58A3C] bg-[#FFF1E6] scale-110" : "border-[#E4D3BE] bg-[#F6EDE2] opacity-60"}`}><Badge s={s} /></span>
                <span className={`mt-1 text-[9px] font-black leading-tight sm:text-[10px] ${i <= at ? "text-[#3A2A22]" : "text-[#9A887A]"}`}>{s.name}</span>
              </div>
              {i < steps.length - 1 && (
                <span className="relative mt-4 h-0.5 w-3 shrink-0 rounded bg-[#E4D3BE] sm:w-5">
                  {i === at && <span className="hs-coin-hop absolute -top-2 left-0 text-xs">🪙</span>}
                </span>
              )}
            </div>
          ))}
        </div>
        {note && <div className="mt-1.5 text-center text-[10px] font-bold text-[#9A887A]">{note}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-[#E4D3BE] bg-white p-3">
      <ol className="relative space-y-1.5">
        <span aria-hidden className="absolute bottom-4 left-[17px] top-4 w-0.5 bg-[#E4D3BE]" />
        {steps.map((s, i) => (
          <li key={s.name} className="relative flex items-center gap-3">
            <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-lg transition ${i < at ? "border-[#3F9B5B] bg-[#E4F4E6]" : i === at ? "border-[#F58A3C] bg-[#FFF1E6] scale-110 shadow-[0_0_0_4px_rgba(245,138,60,0.2)]" : "border-[#E4D3BE] bg-[#F6EDE2]"}`}>
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full"><Badge s={s} /></span>
              {i === at && <span aria-hidden className="hs-coin-hop absolute -right-2 -top-2 text-sm">🪙</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-black ${i <= at ? "text-[#3A2A22]" : "text-[#9A887A]"}`}>{s.name}</span>
              <span className="block text-[11px] font-semibold leading-snug text-[#7B6A5C]">{s.what}</span>
            </span>
            {active !== undefined && i < at && <span className="text-xs font-black text-[#3F9B5B]">✓</span>}
          </li>
        ))}
      </ol>
      {note && <div className="mt-2 rounded-xl bg-[#F6EDE2] px-2.5 py-1.5 text-center text-[10px] font-bold text-[#7B6A5C]">{note}</div>}
    </div>
  );
}
