"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useState } from "react";

const S = "/game/sprites";

/** A dashed, marching arrow between two illustrations. `curve` bends it up (negative) or down. */
function Arrow({ className = "", curve = -18, label }: { className?: string; curve?: number; label?: string }) {
  return (
    <div className={`relative flex min-w-[28px] shrink flex-col items-center ${className}`}>
      {label && <span className="mb-1 hidden whitespace-nowrap rounded-full sm:inline bg-white/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#8A6448] shadow-sm sm:text-[11px]">{label}</span>}
      <svg viewBox="0 0 80 40" className="h-6 w-10 max-w-full overflow-visible sm:h-10 sm:w-16" aria-hidden>
        {/* dashes stop short of the head so the tip is always clean */}
        <path d={`M4 24 Q34 ${24 + curve} 58 24`} fill="none" stroke="#8A6448" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="7 7" className="hs-march" />
        <path d="M60 15 L75 24 L60 33 Z" fill="#8A6448" stroke="#8A6448" strokeWidth="3" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** One illustration with a caption tag underneath. */
function Pic({ src, alt, h, tag, d = 0, emoji, className = "" }: { src?: string; alt: string; h: string; tag?: string; d?: number; emoji?: string; className?: string }) {
  return (
    <div className={`hs-bounce-in flex min-w-0 shrink flex-col items-center ${className}`} style={{ "--d": `${d}ms` } as React.CSSProperties}>
      {src ? <img src={src} alt={alt} className={`${h} w-auto max-w-full object-contain drop-shadow-[0_4px_0_rgba(138,100,72,0.18)]`} /> : <div className={`${h} flex items-center justify-center text-5xl sm:text-6xl`} role="img" aria-label={alt}>{emoji}</div>}
      {tag && <span className="mt-1 max-w-[110px] text-center text-[11px] font-black leading-tight text-[#5C4A3D] sm:text-xs">{tag}</span>}
    </div>
  );
}

type Chapter = { key: string; icon: string; tab: string; title: string; mascot: string; says: string; scene: React.ReactNode; points: string[] };

const ALL_CHAPTERS: Chapter[] = [
  {
    key: "plant",
    icon: "🌱",
    tab: "Plant",
    title: "Plant your money",
    mascot: "rabbit",
    says: "Your dollars become a Heart Tree. It's still your money, so you can take it back any time!",
    scene: (
      <>
        <Pic src={`${S}/howto/money.png`} alt="Your dollars" h="h-20 sm:h-28" tag="You add $25" d={100} />
        <Arrow label="card / Apple Pay" />
        <Pic src={`${S}/town/heart_tree.png`} alt="Heart Tree" h="h-28 sm:h-36" tag="Your Heart Tree" d={350} />
      </>
    ),
    points: ["Your money is lent out safely through RHEA", "Withdraw your principal whenever you like"],
  },
  {
    key: "grow",
    icon: "🍎",
    tab: "Grow",
    title: "It grows fruit",
    mascot: "otter",
    says: "Borrowers pay a little interest. That interest grows on your tree as fruit, to the exact cent.",
    scene: (
      <>
        <Pic src={`${S}/howto/bank.png`} alt="RHEA lending" h="h-20 sm:h-28" tag="Borrowers pay interest" d={100} />
        <Arrow label="interest" />
        <div className="hs-bounce-in relative shrink-0" style={{ "--d": "350ms" } as React.CSSProperties}>
          <img src={`${S}/town/heart_tree.png`} alt="Heart Tree with fruit" className="h-28 w-auto object-contain sm:h-36" />
          {[
            ["left-[22%] top-[20%]", 700, "fruit_red_1"],
            ["left-[55%] top-[12%]", 850, "fruit_red_2"],
            ["left-[64%] top-[38%]", 1000, "fruit_red_3"],
            ["left-[30%] top-[45%]", 1150, "fruit_gold_1"],
          ].map(([pos, dl, f]) => (
            <img key={f as string} src={`${S}/town/${f}.png`} alt="" className={`hs-pop absolute h-6 w-auto sm:h-8 ${pos}`} style={{ "--d": `${dl}ms` } as React.CSSProperties} />
          ))}
          <span className="mt-1 block text-center text-[11px] font-black text-[#5C4A3D] sm:text-xs">Fruit = real interest</span>
        </div>
      </>
    ),
    points: ["Only the interest becomes fruit, never your principal", "Watch your fruit grow in real time"],
  },
  {
    key: "deliver",
    icon: "🚐",
    tab: "Deliver",
    title: "Deliver it to a cause",
    mascot: "fox",
    says: "Harvest your fruit and I'll drive it to any town you choose. Each town is a real cause.",
    scene: (
      <>
        <Pic src={`${S}/town/fruit_red_2.png`} alt="Harvested fruit" h="h-10 sm:h-16" tag="Harvest" d={100} />
        <Arrow curve={-10} />
        <Pic src={`${S}/road/van.png`} alt="Delivery van" h="h-11 sm:h-20" tag="Your helper drives" d={350} className="hs-van" />
        <Arrow curve={-10} />
        <Pic src={`${S}/stages/townHall_4.png`} alt="The cause's town hall" h="h-16 sm:h-28" tag="The cause gets paid" d={600} />
      </>
    ),
    points: ["Paid to the charity's verified account", "Or turn on auto-delivery and relax"],
  },
  {
    key: "build",
    icon: "🏡",
    tab: "Build",
    title: "Watch the town grow",
    mascot: "panda",
    says: "Every delivery helps a building rise, from bare plot to finished home. Everyone builds together.",
    scene: (
      <>
        {[1, 2, 3, 4].map((n, i) => (
          <div key={n} className="flex items-center">
            <Pic src={`${S}/stages/house_${n}.png`} alt={`Building stage ${n}`} h="h-16 sm:h-24" tag={["Plot", "Frame", "Walls", "Home!"][i]} d={100 + i * 220} />
            {n < 4 && <Arrow className="-mx-2 sm:-mx-1" curve={-8} />}
          </div>
        ))}
      </>
    ),
    points: ["Shared towns: other helpers build with you", "Buildings show what the cause achieved"],
  },
  {
    key: "play",
    icon: "🪓",
    tab: "Play",
    title: "Play every day",
    mascot: "dog",
    says: "Tap in rhythm to chop wood! Wood helps finish buildings faster. Anyone can play, even for free.",
    scene: (
      <>
        <Pic src={`${S}/wood/axe.png`} alt="Axe" h="h-16 sm:h-24" tag="Tap on the beat" d={100} className="hs-chop" />
        <Arrow />
        <Pic src={`${S}/wood/log.png`} alt="Log" h="h-16 sm:h-24" tag="Chop wood" d={350} />
        <Arrow />
        <Pic src={`${S}/stages/house_3.png`} alt="Building" h="h-16 sm:h-24" tag="Help build" d={600} />
      </>
    ),
    points: ["Free players earn a little Wood each day", "Fair play: the game never changes anyone's earnings"],
  },
  {
    key: "ads",
    icon: "📺",
    tab: "Ads help",
    title: "Watch an ad, help a cause",
    mascot: "cat",
    says: "After a game you can watch a short ad. The ad money goes to the Community Pool for causes, so even free players help!",
    scene: (
      <>
        <Pic src={`${S}/howto/ad.png`} alt="A short ad" h="h-12 sm:h-24" tag="Watch a short ad" d={100} />
        <Arrow label="ad money" curve={-10} />
        <div className="hs-bounce-in flex min-w-0 shrink flex-col items-center" style={{ "--d": "350ms" } as React.CSSProperties}>
          <img src={`${S}/howto/heart_pool.png`} alt="Basket of golden fruit" className="h-14 w-auto max-w-full object-contain drop-shadow-[0_4px_0_rgba(138,100,72,0.18)] sm:h-24" />
          <span className="mt-1 max-w-[110px] text-center text-[11px] font-black leading-tight text-[#5C4A3D] sm:text-xs">Community Heart Pool</span>
        </div>
        <Arrow label="you choose" curve={-10} />
        <Pic src={`${S}/stages/townHall_4.png`} alt="The cause's town hall" h="h-14 sm:h-28" tag="A cause you pick" d={600} />
      </>
    ),
    points: ["Always optional: skipping costs nothing", "Every helper gets an equal share of golden fruit to send"],
  },
  {
    key: "honest",
    icon: "💛",
    tab: "Good to know",
    title: "The honest bit",
    mascot: "raccoon",
    says: "We keep it simple and honest. Here's what you should know before planting.",
    scene: (
      <div className="hs-bounce-in grid w-full max-w-md gap-2 text-left text-[13px] font-bold text-[#5C4A3D] sm:text-sm" style={{ "--d": "100ms" } as React.CSSProperties}>
        <div className="rounded-2xl bg-white/90 px-3 py-2">✅ Hugshire takes no fee from your money or its yield</div>
        <div className="rounded-2xl bg-white/90 px-3 py-2">✅ Only real interest reaches causes. The game never creates money</div>
        <div className="rounded-2xl bg-[#FFF1E6] px-3 py-2">⚠️ Not a bank and not insured. Yield can be zero, and lending carries risk of loss</div>
      </div>
    ),
    points: [],
  },
];

// Hidden for the hackathon demo; kept here so it can come back for a live launch.
const HIDDEN = new Set(["honest"]);
const CHAPTERS = ALL_CHAPTERS.filter((c) => !HIDDEN.has(c.key));

/** Playful, illustrated "How it works": six short chapters you can click through. */
export function HowItWorksModal({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const [i, setI] = useState(0);
  const c = CHAPTERS[i];
  const last = i === CHAPTERS.length - 1;
  // keep the current chapter's tab visible when the row scrolls on small screens
  useEffect(() => {
    document.querySelector(`[data-hiw-tab="${i}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, CHAPTERS.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="hs-fade absolute inset-0 z-10 overflow-y-auto bg-[rgba(34,24,19,0.4)]" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="hiw-title">
      <div className="flex min-h-full items-center justify-center p-3 sm:p-4">
        <div className="hs-card-in relative w-full max-w-2xl rounded-3xl border-[3px] border-[#8A6448] bg-[#FFF9F0] p-4 text-left shadow-[0_6px_0_#8A6448,0_20px_50px_rgba(0,0,0,0.35)] sm:p-6" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#E4D3BE] bg-white text-lg font-black leading-none text-[#8A6448] transition hover:border-[#8A6448]">
            ×
          </button>

          {/* chapter tabs */}
          <div className="flex gap-1 overflow-x-auto pr-9 [scrollbar-width:none] sm:gap-1.5" role="tablist">
            {CHAPTERS.map((ch, k) => (
              <button
                key={ch.key}
                role="tab"
                aria-selected={k === i}
                title={ch.tab}
                data-hiw-tab={k}
                onClick={() => setI(k)}
                className={`flex shrink-0 items-center gap-1 rounded-full border-2 px-2 py-1 sm:px-2.5 text-xs font-black transition sm:text-[13px] ${k === i ? "border-[#8A6448] bg-[#F58A3C] text-white shadow-[0_2px_0_#8A6448]" : k < i ? "border-[#E4D3BE] bg-[#FDE6D4] text-[#8A6448]" : "border-[#E4D3BE] bg-white text-[#9A887A] hover:border-[#C9B39C]"}`}
              >
                <span aria-hidden>{ch.icon}</span>
                <span className={k === i ? "" : "sr-only"}>{ch.tab}</span>
              </button>
            ))}
          </div>

          <div key={c.key}>
            <div className="mt-4 text-xs font-black uppercase tracking-wider text-[#E46F3E]">
              Chapter {i + 1} of {CHAPTERS.length}
            </div>
            <h2 id="hiw-title" className="text-2xl font-black text-[#3A2A22] sm:text-3xl">
              {c.title}
            </h2>

            {/* illustrated scene */}
            <div className="relative mt-3 flex min-h-[176px] items-end justify-center gap-0.5 overflow-hidden rounded-2xl border-2 border-[#E4D3BE] px-3 pb-3 pt-6 sm:min-h-[210px] sm:gap-2" style={{ background: `#CBE6B3 url(${S}/howto/background.png) center 62% / cover no-repeat` }}>
              {c.scene}
            </div>

            {/* mascot explains */}
            <div className="mt-4 flex items-start gap-3">
              <img src={`/mascots/${c.mascot}.png`} alt="" className="hs-pop h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16" style={{ "--d": "200ms" } as React.CSSProperties} />
              <div className="hs-rise relative flex-1 rounded-2xl border-2 border-[#E4D3BE] bg-white px-4 py-3 text-[15px] font-bold leading-snug text-[#3A2A22] sm:text-base" style={{ "--d": "300ms" } as React.CSSProperties}>
                <span aria-hidden className="absolute -left-[9px] top-5 h-4 w-4 rotate-45 border-b-2 border-l-2 border-[#E4D3BE] bg-white" />
                {c.says}
              </div>
            </div>
            {!!c.points.length && (
              <ul className="hs-rise mt-3 flex flex-wrap gap-2" style={{ "--d": "450ms" } as React.CSSProperties}>
                {c.points.map((p) => (
                  <li key={p} className="rounded-full bg-[#F6EDE2] px-3 py-1 text-xs font-bold text-[#5C4A3D] sm:text-[13px]">
                    ✓ {p}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* nav */}
          <div className="mt-5 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setI(i - 1)} disabled={i === 0} className="rounded-2xl border-[3px] border-[#8A6448] bg-[#FFF9F0] px-4 py-2.5 font-black text-[#3A2A22] shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448] disabled:invisible">
              ← Back
            </button>
            <Link href="/how-it-works" className="hidden text-xs font-bold text-[#8A6448] underline underline-offset-4 sm:inline">
              Full money details
            </Link>
            {last ? (
              <button type="button" onClick={onStart} className="rounded-2xl border-[3px] border-[#8A6448] bg-[#F58A3C] px-5 py-2.5 font-black text-white shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448]">
                Start helping →
              </button>
            ) : (
              <button type="button" onClick={() => setI(i + 1)} className="rounded-2xl border-[3px] border-[#8A6448] bg-[#F58A3C] px-5 py-2.5 font-black text-white shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448]">
                Next →
              </button>
            )}
          </div>
          <Link href="/how-it-works" className="mt-3 block text-center text-xs font-bold text-[#8A6448] underline underline-offset-4 sm:hidden">
            Full money details
          </Link>
        </div>
      </div>
    </div>
  );
}
