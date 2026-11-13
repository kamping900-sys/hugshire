"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RoadTown, RoadWorld } from "@/game/v4/RoadWorld";
import { JourneyWizard } from "@/components/journey/JourneyWizard";
import { HowItWorksModal } from "./HowItWorksModal";
import { SignInModal } from "./SignInModal";
import { BackgroundMusic } from "@/components/BackgroundMusic";

type ApiTown = { id: string; slug: string; title: string; cityName: string; category: string; completed: number; underConstruction: number; constructionBps: number };

/**
 * Game-style title screen: the real world map runs behind, with the delivery van cruising slowly
 * past every town, and the title and call to action float on top.
 */
export function LandingScene({ signedIn, sandbox, autoStart }: { signedIn: boolean; sandbox: boolean; autoStart?: boolean }) {
  const [orgOpen, setOrgOpen] = useState(false);
  const [authed, setAuthed] = useState(signedIn); // becomes true after signing in from the pop-up
  const [startOpen, setStartOpen] = useState(!!autoStart && signedIn);
  const [howOpen, setHowOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const modalOpen = startOpen || howOpen || signInOpen;
  // signed in → the wizard; guests sign in first (in a pop-up on this same screen), then go straight into it
  const begin = () => (authed ? setStartOpen(true) : setSignInOpen(true));
  const start = authed ? "/start" : `/login?next=${encodeURIComponent("/?start=1")}`;
  useEffect(() => {
    if (autoStart) window.history.replaceState(null, "", "/"); // drop ?start=1 so a refresh shows the title screen
  }, [autoStart]);
  return (
    <LandingBackdrop>
      <div className={`absolute inset-0 flex items-center justify-center px-4 text-center transition-all duration-500 ${modalOpen ? "pointer-events-none scale-95 opacity-0" : ""}`} aria-hidden={modalOpen || undefined}>
        <div className="flex flex-col items-center">
        <div className="hs-pop" style={d(150)}>
          <img src="/brand/logo.png" alt="" className="floaty hs-wiggle-hover h-20 w-20 rounded-[24px] border-[3px] border-[#FFF9F0] shadow-[0_6px_24px_rgba(0,0,0,0.35)] sm:h-24 sm:w-24" />
        </div>
        <h1 className="mt-4 text-5xl font-black tracking-tight text-[#FFF9F0] sm:text-7xl" style={{ textShadow: "0 4px 0 #8A6448, 0 10px 30px rgba(0,0,0,0.35)" }}>
          <span className="sr-only">Hugshire</span>
          <span aria-hidden>
            {"Hugshire".split("").map((ch, i) => (
              <span key={i} className="hs-drop" style={d(450 + i * 60)}>
                {ch}
              </span>
            ))}
          </span>
        </h1>
        <p style={{ ...d(1000), textShadow: "0 1px 2px rgba(40,28,22,0.9), 0 2px 12px rgba(0,0,0,0.55)" }} className="hs-rise mt-3 max-w-xl text-lg font-extrabold leading-relaxed text-[#FFF4E2] sm:text-[22px]">
          <span className="font-black text-[#FFC48A]">Where kindness takes shape.</span> Plant money that stays yours, grow fruit for real causes, and build cozy towns together.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <span className="hs-bounce-in flex" style={d(1300)}>
          <Link href={start} onClick={(e) => { e.preventDefault(); begin(); }} className="inline-flex items-center justify-center rounded-2xl border-[3px] border-[#8A6448] bg-[#F58A3C] px-9 py-4 text-xl font-black text-white shadow-[0_5px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[3px] active:shadow-[0_2px_0_#8A6448]">
            Start helping
          </Link>
          </span>
          <span className="hs-bounce-in flex" style={d(1420)}>
          <Link href="/how-it-works" onClick={(e) => { e.preventDefault(); setHowOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-2xl border-[3px] border-[#8A6448] bg-[#FFF9F0] px-9 py-4 text-xl font-black text-[#3A2A22] shadow-[0_5px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[3px] active:shadow-[0_2px_0_#8A6448]">
            How it works <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#8A6448] text-sm leading-none">?</span>
          </Link>
          </span>
        </div>
        <button type="button" onClick={() => setOrgOpen(true)} className={`hs-fade mt-6 ${subtleLink}`} style={{ ...subtleShadow, ...d(1750) }}>
          For organisations →
        </button>
        </div>
      </div>
      <BackgroundMusic />
      {orgOpen && <OrgModal onClose={() => setOrgOpen(false)} />}
      {howOpen && (
        <HowItWorksModal
          onClose={() => setHowOpen(false)}
          onStart={() => {
            setHowOpen(false);
            begin();
          }}
        />
      )}
      {signInOpen && (
        <SignInModal
          onClose={() => setSignInOpen(false)}
          onSignedIn={() => {
            setSignInOpen(false);
            setAuthed(true);
            setStartOpen(true);
          }}
        />
      )}
      {startOpen && <JourneyWizard sandbox={sandbox} onClose={() => setStartOpen(false)} />}
    </LandingBackdrop>
  );
}

/** Stagger helper for the entrance animations in globals.css. */
export const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

/** Subtle underlined text link used on top of the scene (org link, wizard back / skip). */
export const subtleLink = "text-sm font-bold text-[#FFF4E2]/80 underline decoration-[#FFF4E2]/40 underline-offset-4 transition hover:text-white hover:decoration-white";
export const subtleShadow = { textShadow: "0 1px 6px rgba(0,0,0,0.45)" };

/** The live world map (van cruising in attract mode), softly blurred with a warm overlay; children float on top. */
export function LandingBackdrop({ children }: { children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let g: RoadWorld | null = null;
    let dead = false;
    (async () => {
      const towns: ApiTown[] = await fetch("/api/world")
        .then((r) => r.json())
        .then((j) => j.towns ?? [])
        .catch(() => []);
      const list: RoadTown[] = [
        { id: "square", slug: null, name: "Hugshire Square", subtitle: "", category: "square", completed: 0, underConstruction: 0, constructionBps: 0, real: false },
        ...towns.map((t) => ({ id: t.id, slug: t.slug, name: t.cityName, subtitle: t.title, category: t.category, completed: t.completed, underConstruction: t.underConstruction, constructionBps: t.constructionBps, real: true })),
      ];
      const { RoadWorld } = await import("@/game/v4/RoadWorld");
      if (dead || !el.current) return;
      g = new RoadWorld(list, { onNear: () => {}, onHud: () => {}, onEnter: () => {} }, { attract: true });
      if (process.env.NODE_ENV === "development") (window as unknown as { __hsRoad?: unknown }).__hsRoad = g; // dev-only debugging handle
      await g.mount(el.current);
      if (!dead) setReady(true);
    })();
    return () => {
      dead = true;
      g?.destroy();
    };
  }, []);

  return (
    <div className="absolute inset-0 select-none overflow-hidden font-sans" style={{ background: "radial-gradient(ellipse at 50% 40%, #FFF1DF 0%, #FFDDB5 55%, #FBC48E 100%)" }}>
      <div ref={el} className={`hs-settle absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`} style={{ filter: "blur(1.5px) saturate(1.05)" }} aria-hidden />
      {/* a warm dark overlay so the title reads clearly while the scene keeps moving behind it */}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-50"}`} style={{ background: "radial-gradient(ellipse 46% 40% at 50% 50%, rgba(40,28,22,0.5) 0%, rgba(40,28,22,0.28) 60%, rgba(40,28,22,0) 100%), radial-gradient(ellipse at 50% 50%, rgba(48,34,27,0.12) 0%, rgba(34,24,19,0.38) 100%)" }} />

      {children}
    </div>
  );
}

const field = "w-full rounded-xl border-2 border-[#E4D3BE] bg-white px-3 py-2.5 text-[15px] font-semibold text-[#3A2A22] outline-none transition placeholder:font-medium placeholder:text-[#B5A08A] focus:border-[#F58A3C]";
const label = "mb-1 block text-xs font-black uppercase tracking-wide text-[#8A6448]";

/** Short interest form for charities / organisations. Saves to the server for the team to follow up. */
function OrgModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<"form" | "sending" | "done">("form");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("sending");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const r = await fetch("/api/org-interest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).catch(() => null);
    if (r?.ok) return setState("done");
    const j = await r?.json().catch(() => null);
    setError(r?.status === 429 ? "Too many requests. Please try again in a minute." : j?.error?.message && r?.status !== 400 ? j.error.message : "Please check the details and try again.");
    setState("form");
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(34,24,19,0.45)] p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="org-title">
      <div className="relative max-h-full w-full max-w-md overflow-y-auto rounded-3xl border-[3px] border-[#8A6448] bg-[#FFF9F0] p-6 text-left shadow-[0_6px_0_#8A6448,0_20px_50px_rgba(0,0,0,0.35)] sm:p-7" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#E4D3BE] text-lg font-black leading-none text-[#8A6448] transition hover:border-[#8A6448]">
          ×
        </button>
        {state === "done" ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-[#8A6448] bg-[#FFC48A] text-3xl">💌</div>
            <h2 className="mt-4 text-2xl font-black text-[#3A2A22]">Request received!</h2>
            <p className="mt-2 font-semibold leading-relaxed text-[#6B5444]">Thanks for reaching out. We&apos;ve received your request and our team will contact you soon.</p>
            <button type="button" onClick={onClose} className="mt-6 rounded-2xl border-[3px] border-[#8A6448] bg-[#F58A3C] px-8 py-3 text-lg font-black text-white shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448]">
              Back to Hugshire
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="org-title" className="pr-8 text-2xl font-black text-[#3A2A22]">Bring your cause to Hugshire</h2>
            <p className="mt-1 text-sm font-semibold text-[#6B5444]">Tell us a little about your organisation and we&apos;ll be in touch.</p>
            <div className="mt-5 space-y-3">
              <div>
                <label className={label} htmlFor="orgName">Organisation name</label>
                <input id="orgName" name="orgName" required minLength={2} maxLength={120} className={field} placeholder="Paws & Whiskers Rescue" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="contactName">Your name</label>
                  <input id="contactName" name="contactName" required minLength={2} maxLength={80} className={field} />
                </div>
                <div>
                  <label className={label} htmlFor="email">Email</label>
                  <input id="email" name="email" type="email" required maxLength={160} className={field} />
                </div>
              </div>
              <div>
                <label className={label} htmlFor="website">Website <span className="normal-case text-[#B5A08A]">(optional)</span></label>
                <input id="website" name="website" maxLength={200} className={field} placeholder="https://" />
              </div>
              <div>
                <label className={label} htmlFor="cause">What does your organisation do?</label>
                <textarea id="cause" name="cause" required minLength={10} maxLength={1500} rows={3} className={`${field} resize-none`} placeholder="Our mission, who we help, and how you'd like to use Hugshire" />
              </div>
            </div>
            {error && <p className="mt-3 text-sm font-bold text-[#C0492B]">{error}</p>}
            <button type="submit" disabled={state === "sending"} className="mt-5 w-full rounded-2xl border-[3px] border-[#8A6448] bg-[#F58A3C] py-3 text-lg font-black text-white shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448] disabled:opacity-60">
              {state === "sending" ? "Sending…" : "Send request"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
