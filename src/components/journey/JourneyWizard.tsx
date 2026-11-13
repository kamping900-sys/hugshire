"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, idemKey } from "@/lib/api";
import { ANIMAL_KEYS, Dots, MASCOT, Mascot, btn, btnP, card } from "./shared";
import { LandingBackdrop, d, subtleLink, subtleShadow } from "@/components/landing/LandingScene";
import { MoneyFlow } from "./MoneyFlow";

type Town = { id: string; slug: string; title: string; summary: string; cityName: string; org: string; helpers: number; completed: number; underConstruction: number; category: string };
type Journey = { signedIn: boolean; onboarded?: boolean; helper?: { animal: string; nickname: string }; helpers?: { town: { id: string } | null }[]; home?: { id: string; slug: string; cityName: string } | null; riskAcknowledged?: boolean };
/** "journey" = first time · "more" = plant more for one town (your helper there) · "add" = a new helper for another town */
export type WizardMode = "journey" | "more" | "add";

const AMOUNTS = ["10", "25", "50", "100"];
const CAT_EMOJI: Record<string, string> = { animals: "🐾", education: "📚", nature: "🌿", health: "🩺", food: "🥕", community: "🤝" };

/**
 * First-time journey: 1 meet your helper → 2 choose your home town → 3 plant your Heart Tree (or play
 * free) → arrival in town with a short guided tutorial.
 */
export function JourneyWizard({ startStep = 0, sandbox, onClose, mode = "journey", causeId, onDone }: { startStep?: number; sandbox: boolean; onClose?: () => void; mode?: WizardMode; causeId?: string; onDone?: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(startStep);
  const [towns, setTowns] = useState<Town[]>([]);
  const [j, setJ] = useState<Journey | null>(null);
  const [animal, setAnimal] = useState("cat");
  const [nickname, setNickname] = useState("");
  const [home, setHome] = useState<string>("");
  const [amount, setAmount] = useState("25");
  const [custom, setCustom] = useState("");
  const [risk, setRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // test mode: the pretend checkout opens as a card over the same scene instead of a separate page
  const [checkout, setCheckout] = useState<{ id: string; next: string } | null>(null);
  const [paying, setPaying] = useState(false);
  // after paying: success → money turns into the helper → helper drops away into town
  const [celebrate, setCelebrate] = useState<null | "paid" | "glow" | "evolve" | "flash" | "reveal" | "fall">(null);
  const key = useRef(idemKey("journey-dep"));

  useEffect(() => {
    fetch("/api/world").then((r) => r.json()).then((x) => setTowns(x.towns ?? [])).catch(() => {});
    api<Journey>("/api/journey").then((x) => {
      setJ(x);
      if (x.helper && x.onboarded && mode !== "add") {
        setAnimal(x.helper.animal);
        setNickname(x.helper.nickname === "Helper" ? "" : x.helper.nickname);
      }
      if (mode === "more" && causeId) setHome(causeId);
      else if (x.home && mode !== "add") setHome(x.home.id);
      if (x.riskAcknowledged) setRisk(true);
    }).catch(() => {});
  }, []);
  // adding a helper: only towns you don't have a helper in yet
  const taken = useMemo(() => new Set((j?.helpers ?? []).map((h) => h.town?.id).filter(Boolean) as string[]), [j]);
  const choices = useMemo(() => (mode === "add" ? towns.filter((t) => !taken.has(t.id)) : towns), [mode, towns, taken]);
  useEffect(() => {
    if (!home && choices[0]) setHome(choices[0].id);
  }, [choices, home]);

  const town = useMemo(() => towns.find((t) => t.id === home), [towns, home]);
  const name = nickname.trim() || MASCOT[animal].label;
  const usd = custom.trim() || amount;

  // free players get a helper now; planting creates the helper with the deposit (no duplicate)
  async function saveHelperAndHome(createHelper = true) {
    await api("/api/journey", "POST", { action: "onboard", animal, nickname: name, homeCauseId: home, createHelper });
  }
  async function playFree() {
    setBusy(true);
    setErr(null);
    try {
      await saveHelperAndHome();
      router.push(`/worldmap/town/${town!.slug}?welcome=1`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }
  async function completeTestPayment() {
    if (!checkout) return;
    setPaying(true);
    setErr(null);
    try {
      await api(`/api/deposits/${checkout.id}/sandbox-complete`, "POST", {});
      const next = checkout.next;
      if (mode === "more") {
        setCelebrate("paid");
        window.setTimeout(() => onDone?.(), 1700);
        return;
      }
      router.prefetch(next);
      // paid ✓ → money glows → evolves (flickering silhouettes) → white flash → ta-da! → drops to town
      setCelebrate("paid");
      const at = (ms: number, f: () => void) => window.setTimeout(f, ms);
      at(1300, () => setCelebrate("glow"));
      at(2500, () => setCelebrate("evolve"));
      at(4600, () => setCelebrate("flash"));
      at(4950, () => setCelebrate("reveal"));
      at(7200, () => setCelebrate("fall")); // zoom into the helper, fade to the town's green
      at(8300, () => router.push(next));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong.");
      setPaying(false);
    }
  }

  async function plant() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "journey") await saveHelperAndHome(false);
      if (!j?.riskAcknowledged) await api("/api/me", "PUT", { acknowledgeRisk: true });
      const r = await api<{ checkoutUrl: string | null }>("/api/deposits", "POST", { causeId: home, amountUsd: usd, animal, nickname: name, idempotencyKey: key.current });
      const next = mode === "journey" ? `/worldmap/town/${town!.slug}?welcome=1` : mode === "add" ? `/worldmap/town/${town!.slug}` : window.location.pathname;
      const sandboxId = r.checkoutUrl?.match(/\/sandbox\/checkout\/([^/?#]+)/)?.[1];
      if (sandboxId) {
        setCheckout({ id: sandboxId, next });
        setBusy(false);
      } else if (r.checkoutUrl) window.location.href = `${r.checkoutUrl}${r.checkoutUrl.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
      else router.push(next);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  // bottom "Back": previous step, or leave the wizard from the first step
  function back() {
    if (checkout) return setCheckout(null);
    if (mode === "more" && onClose) return onClose(); // depositing more starts on the amount step
    if (step > 0) return setStep(step - 1);
    if (onClose) return onClose();
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  // as a modal (opened from the landing page) the live scene behind keeps running; Esc closes it
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (celebrate && town) {
    const sparks = Array.from({ length: 16 }, (_, k) => {
      const a = (k / 16) * Math.PI * 2;
      const r = k % 2 ? 170 : 125;
      return { dx: `${Math.round(Math.cos(a) * r)}px`, dy: `${Math.round(Math.sin(a) * r * 0.85)}px`, d: (k % 4) * 50, e: ["✨", "💛", "⭐", "✨"][k % 4] };
    });
    const mascotSrc = `/game/sprites/mascots/${MASCOT[animal].img}_front.png`;
    const c = celebrate;
    const caption =
      c === "glow" ? "Your money is glowing…" : c === "evolve" ? "✨ What's happening?! ✨" : c === "reveal" ? "Ta-da! ✨" : c === "fall" ? `Off to ${town.cityName}!` : "";
    const scene = (
      <div className={`absolute inset-0 z-10 flex items-center justify-center overflow-hidden p-4 ${onClose ? "bg-[rgba(34,24,19,0.4)]" : ""}`}>
        {/* the bright flash at the moment of evolution */}
        {(c === "flash" || c === "reveal") && <div aria-hidden className={`pointer-events-none absolute inset-0 z-20 ${c === "flash" ? "hs-flash-in" : "hs-flash-out"}`} style={{ background: "radial-gradient(circle, #FFFFFF 0%, #FFFBEA 45%, #FFF1CC 100%)" }} />}
        {/* zooming into the helper: the screen fades to the town's meadow green, where the town picks up */}
        {c === "fall" && <div aria-hidden className="hs-to-town pointer-events-none absolute inset-0 z-20 bg-[#BFE0A6]" />}
        {celebrate === "paid" ? (
          <div className={`hs-card-in ${card} w-full max-w-sm p-7 text-center`}>
            <div className="hs-pop mx-auto flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-[#2F7A47] bg-[#5BBF7A] text-4xl font-black text-white shadow-[0_4px_0_#2F7A47]">✓</div>
            <div className="mt-4 text-2xl font-black text-[#3A2A22]">Payment successful!</div>
            <div className="mt-1 font-bold text-[#7B6A5C]">${Number(usd).toFixed(2)} planted for {town.cityName}</div>
          </div>
        ) : (
          <div className="relative flex flex-col items-center text-center">
            <div className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64">
              {/* light: spinning rays + soft glow behind, brighter as it evolves */}
              {c !== "fall" && (
                <>
                  <div aria-hidden className={`hs-rays pointer-events-none absolute -inset-24 rounded-full transition-opacity duration-500 ${c === "glow" ? "opacity-50" : "opacity-90"}`} style={{ background: "repeating-conic-gradient(from 0deg, rgba(255,240,200,0.55) 0deg 10deg, rgba(255,240,200,0) 10deg 24deg)", WebkitMaskImage: "radial-gradient(circle, #000 25%, transparent 68%)", maskImage: "radial-gradient(circle, #000 25%, transparent 68%)" }} />
                  <div aria-hidden className={`pointer-events-none absolute -inset-10 rounded-full transition-all duration-700 ${c === "evolve" ? "scale-110 opacity-100" : "opacity-70"}`} style={{ background: "radial-gradient(circle, rgba(255,255,240,0.95) 0%, rgba(255,214,140,0.55) 35%, rgba(255,200,120,0) 70%)" }} />
                </>
              )}
              {/* the money, then flickering money/helper silhouettes */}
              {(c === "glow" || c === "evolve") && (
                <img src="/game/sprites/howto/money.png" alt="" className={`absolute h-[78%] w-[78%] object-contain ${c === "glow" ? "hs-pop hs-shine" : "hs-evo-a hs-silhouette"}`} />
              )}
              {c === "evolve" && <img src={mascotSrc} alt="" className="hs-evo-b hs-silhouette absolute h-[88%] w-[88%] object-contain" />}
              {/* the reveal */}
              {(c === "reveal" || c === "fall") && (
                <>
                  {c === "reveal" && <div aria-hidden className="hs-shock pointer-events-none absolute inset-6 rounded-full border-[6px] border-[#FFF4D6]" />}
                  {c === "reveal" &&
                    sparks.map((p, k) => (
                      <span key={k} aria-hidden className="hs-burst absolute text-2xl sm:text-3xl" style={{ "--dx": p.dx, "--dy": p.dy, "--d": `${p.d}ms` } as React.CSSProperties}>
                        {p.e}
                      </span>
                    ))}
                  <div className={c === "fall" ? "hs-zoomin" : "hs-tada"}>
                    <img src={mascotSrc} alt={name} className="h-52 w-auto object-contain drop-shadow-[0_8px_0_rgba(138,100,72,0.25)] sm:h-60" />
                  </div>
                </>
              )}
            </div>
            <div key={c} className={`mt-2 font-black text-[#FFF9F0] ${c === "reveal" ? "hs-pop text-3xl sm:text-5xl" : "hs-rise text-2xl sm:text-3xl"}`} style={{ textShadow: "0 3px 0 #8A6448, 0 8px 24px rgba(0,0,0,0.45)" }}>
              {caption}
            </div>
            {c === "reveal" && (
              <>
                <div className="hs-rise mt-1 max-w-[90vw] break-words text-2xl font-black text-[#FFC48A] sm:text-3xl" style={{ "--d": "250ms", textShadow: "0 3px 0 #8A6448, 0 6px 18px rgba(0,0,0,0.45)" } as React.CSSProperties}>
                  {name} is here!
                </div>
                <div className="hs-rise mt-1 text-base font-extrabold text-[#FFE7C2] sm:text-lg" style={{ "--d": "450ms", textShadow: "0 2px 10px rgba(0,0,0,0.5)" } as React.CSSProperties}>
                  Your helper for {town.cityName}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
    return onClose ? scene : <LandingBackdrop>{scene}</LandingBackdrop>;
  }

  const body = (
      <div className={`absolute inset-0 overflow-y-auto ${onClose ? "hs-fade z-10 bg-[rgba(34,24,19,0.4)]" : ""}`} role={onClose ? "dialog" : undefined} aria-modal={onClose ? true : undefined}>
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-8">

          {!checkout && step === 0 && (
            <section key={step} className={`hs-card-in ${card} p-6 sm:p-8`} style={d(150)}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">{mode === "add" ? "New helper · Step 1" : "Step 1 · Meet your helper"}</div>
                <Dots step={step} total={3} />
              </div>
              <h1 className="mt-1 text-3xl font-black text-[#3A2A22]">{mode === "add" ? "Who will join your team?" : "Who will help you build?"}</h1>
              <p className="mt-1 text-sm font-semibold text-[#7B6A5C]">Your animal helper lives in your home town, plays the mini-games with you and carries your Heart Parcels.</p>
              <div className="mt-5 grid grid-cols-4 gap-2 sm:gap-3">
                {ANIMAL_KEYS.map((a) => (
                  <button key={a} onClick={() => setAnimal(a)} className={`rounded-2xl border-[2.5px] p-2 text-center transition ${animal === a ? "-translate-y-1 border-[#F58A3C] bg-[#FDE6D4] shadow-[0_4px_0_#E46F3E]" : "border-[#E2D3C2] bg-white hover:-translate-y-0.5"}`}>
                    <img src={`/mascots/${MASCOT[a].img}.png`} alt="" className="mx-auto h-16 w-16 object-contain sm:h-20 sm:w-20" />
                    <div className="mt-1 text-sm font-black text-[#3A2A22]">{MASCOT[a].label}</div>
                  </button>
                ))}
              </div>
              <label className="mt-4 block text-sm font-black text-[#3A2A22]" htmlFor="nick">
                Name your helper
              </label>
              <input id="nick" value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} placeholder={MASCOT[animal].label} className="mt-1 w-full rounded-2xl border-[2.5px] border-[#E2D3C2] bg-white px-4 py-3 text-lg font-bold outline-none focus:border-[#F58A3C]" />
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={back} className={`${btn} px-5 py-3`}>← Back</button>
                <button onClick={() => setStep(1)} className={`${btnP} px-6 py-3`}>Next: choose a home town →</button>
              </div>
            </section>
          )}

          {!checkout && step === 1 && (
            <section key={step} className={`hs-card-in ${card} p-6 sm:p-8`} style={d(150)}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Step 2 · Choose your home town</div>
                <Dots step={step} total={3} />
              </div>
              <h1 className="mt-1 text-3xl font-black text-[#3A2A22]">Which cause will {name} help?</h1>
              <p className="mt-1 text-sm font-semibold text-[#7B6A5C]">Each town belongs to one organisation. Your yield goes here by default. You can send fruit to any town and change your home later.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {choices.map((t) => (
                  <button key={t.id} onClick={() => setHome(t.id)} className={`rounded-2xl border-[2.5px] p-4 text-left transition ${home === t.id ? "border-[#F58A3C] bg-[#FDE6D4] shadow-[0_4px_0_#E46F3E]" : "border-[#E2D3C2] bg-white hover:-translate-y-0.5"}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{CAT_EMOJI[t.category] ?? "🏡"}</span>
                      <div className="min-w-0">
                        <div className="truncate text-lg font-black text-[#3A2A22]">{t.cityName}</div>
                        <div className="text-xs font-bold leading-snug text-[#E46F3E]">{t.title}</div>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm font-semibold text-[#5C4A3D]">{t.summary}</p>
                    <div className="mt-2 text-[11px] font-bold text-[#9A887A]">by {t.org}</div>
                  </button>
                ))}
                {!towns.length && <div className="text-sm font-bold text-[#7B6A5C]">Loading towns…</div>}
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={back} className={`${btn} px-5 py-3`}>← Back</button>
                <button disabled={!home} onClick={() => setStep(2)} className={`${btnP} px-6 py-3`}>Next: plant your Heart Tree →</button>
              </div>
            </section>
          )}

          {checkout && town && (
            <section key="checkout" className={`hs-card-in ${card} mx-auto w-full max-w-md p-6 sm:p-8`} style={d(100)}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Test checkout</div>
                <span className="rounded-full bg-[#FFF4D6] px-2.5 py-0.5 text-[11px] font-black text-[#8A6A1E]">No money moves</span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Mascot animal={animal} size={56} />
                <div>
                  <div className="text-4xl font-black text-[#3A2A22]">${Number(usd).toFixed(2)}</div>
                  <div className="text-sm font-bold text-[#7B6A5C]">for {town.cityName}&apos;s Heart Tree</div>
                </div>
              </div>
              <div className="mt-4 text-xs font-black uppercase tracking-wider text-[#8A6448]">Where your money goes</div>
              <div className="mt-1.5">
                <MoneyFlow direction="in" />
              </div>
              {err && <p className="mt-3 text-sm font-bold text-[#C8463A]">{err}</p>}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" disabled={paying} onClick={() => { setCheckout(null); setErr(null); }} className={`${btn} whitespace-nowrap px-5 py-3`}>← Back</button>
                <button type="button" disabled={paying} onClick={completeTestPayment} className={`${btnP} whitespace-nowrap px-6 py-3 text-lg`}>{paying ? "Paying…" : `Pay $${Number(usd).toFixed(2)} →`}</button>
              </div>
            </section>
          )}

          {!checkout && step === 2 && town && (
            <section key={step} className={`hs-card-in ${card} p-6 sm:p-8`} style={d(150)}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">{mode === "more" ? "Plant more" : "Step 3 · Plant your Heart Tree"}</div>
                {mode !== "more" && <Dots step={step} total={3} />}
              </div>
              <div className="mt-1 flex items-center gap-3">
                <Mascot animal={animal} size={56} />
                <h1 className="text-3xl font-black text-[#3A2A22]">Grow kindness for {town.cityName}</h1>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  ["💛", "Your money stays yours", "It's lent out safely through RHEA. Withdraw your principal any time."],
                  ["🍎", "Its interest grows fruit", "Real interest appears on your Heart Tree as fruit, to the exact cent."],
                  ["🏡", "Fruit helps the cause", "Harvest and deliver it to your town, or any town you like."],
                ].map(([e, t, d]) => (
                  <div key={t} className="rounded-2xl bg-[#F6EDE2] p-3">
                    <div className="text-xl">{e}</div>
                    <div className="text-sm font-black text-[#3A2A22]">{t}</div>
                    <div className="text-xs font-semibold text-[#7B6A5C]">{d}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 text-sm font-black text-[#3A2A22]">How much would you like to plant?</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {AMOUNTS.map((a) => (
                  <button key={a} onClick={() => { setAmount(a); setCustom(""); }} className={`${!custom && amount === a ? btnP : btn} px-5 py-2.5 text-lg`}>
                    ${a}
                  </button>
                ))}
                <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Other" inputMode="decimal" aria-label="Other amount in dollars" className="w-28 rounded-2xl border-[2.5px] border-[#E2D3C2] bg-white px-3 text-lg font-bold outline-none focus:border-[#F58A3C]" />
              </div>
              {!j?.riskAcknowledged && (
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-[#E2D3C2] bg-white p-3 text-xs font-semibold text-[#5C4A3D]">
                  <input type="checkbox" checked={risk} onChange={(e) => setRisk(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#F58A3C]" />
                  <span>
                    I understand Hugshire is not a bank. Lending through RHEA carries risk, including smart-contract risk and possible loss. Only the interest goes to charity; I can withdraw my principal (minus any losses). <Link href="/how-it-works" className="font-bold underline">How money works</Link>
                  </span>
                </label>
              )}
              {sandbox && <p className="mt-3 rounded-xl bg-[#FFF4D6] px-3 py-2 text-xs font-bold text-[#8A6A1E]">Test mode: the next screen is a pretend checkout. No card is charged and no money moves.</p>}
              {err && <p className="mt-3 text-sm font-bold text-[#C8463A]">{err}</p>}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={back} className={`${btn} px-5 py-3`}>← Back</button>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  {mode === "journey" && <button disabled={busy} onClick={playFree} className={`${btn} px-5 py-3`}>Play free for now</button>}
                  <button disabled={busy || !risk || !Number(usd)} onClick={plant} className={`${btnP} px-6 py-3 text-lg`}>{busy ? "Planting…" : mode === "more" ? `Plant $${usd} →` : `Plant $${usd} & go to ${town.cityName} →`}</button>
                </div>
              </div>
              {mode === "journey" && <p className="mt-3 text-[11px] font-semibold text-[#9A887A]">Free play: build a little each day (up to 500 Wood). Planting a tree earns much more and sends real yield to the cause.</p>}
            </section>
          )}

          <div className="hs-fade mt-5 text-center" style={d(700)}>
            {mode === "journey" && <Link href="/worldmap" className={subtleLink} style={subtleShadow}>Skip, just look around →</Link>}
          </div>
        </div>
      </div>
  );
  return onClose ? body : <LandingBackdrop>{body}</LandingBackdrop>;
}
