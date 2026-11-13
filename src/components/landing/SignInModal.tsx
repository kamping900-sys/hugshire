"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

const card = "rounded-[26px] border-[3px] border-[#8A6448] bg-[#FFF9F0] shadow-[0_6px_0_#8A6448,0_20px_50px_rgba(0,0,0,0.35)]";
const btnP = "rounded-2xl border-[3px] border-[#8A6448] bg-[#F58A3C] font-black text-white shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448] disabled:opacity-60";

/**
 * Email sign-in as a pop-up over the home screen (test journey). In test mode the server hands the
 * 6-digit code back, so it is filled in for you; live sign-in uses Privy instead.
 */
export function SignInModal({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => input.current?.focus(), [step]);

  async function request(e?: React.FormEvent, override?: string) {
    e?.preventDefault();
    const to = (override ?? email).trim();
    if (!to) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ devCode?: string }>("/api/auth/dev/request", "POST", { email: to });
      setEmail(to);
      setStep("code");
      if (r.devCode) {
        // test journey: type the code in for the player, digit by digit
        setFilled(false);
        setCode("");
        r.devCode.split("").forEach((ch, i) => window.setTimeout(() => setCode((c) => c + ch), 120 + i * 90));
        window.setTimeout(() => setFilled(true), 120 + 6 * 90);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }
  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/auth/dev/verify", "POST", { email, code });
      onSignedIn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That code did not work.");
      setBusy(false);
    }
  }

  return (
    <div className="hs-fade absolute inset-0 z-20 flex items-center justify-center bg-[rgba(34,24,19,0.45)] p-4" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-labelledby="signin-title">
      <div className={`${card} hs-card-in relative w-full max-w-md p-6 text-left sm:p-7`}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#E4D3BE] text-lg font-black leading-none text-[#8A6448] transition hover:border-[#8A6448]">
          ×
        </button>

        {/* this is the test journey */}
        <div className="mb-4 mr-8 flex items-start gap-2.5 rounded-2xl border-2 border-dashed border-[#E0A92E] bg-[#FFF4D6] px-3 py-2.5">
          <span className="text-2xl leading-none">🧪</span>
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-[#8A6A1E]">Test journey · hackathon demo</div>
            <div className="text-[12px] font-bold leading-snug text-[#6B551A]">Use any email. We fill in the sign-in code for you, and no real money moves anywhere.</div>
          </div>
        </div>

        {step === "email" ? (
          <form onSubmit={request}>
            <h2 id="signin-title" className="text-2xl font-black text-[#3A2A22]">Welcome to Hugshire!</h2>
            <p className="mt-1 text-sm font-semibold text-[#7B6A5C]">Sign in with your email. No password, no wallet setup.</p>
            <label htmlFor="signin-email" className="mb-1 mt-4 block text-xs font-black uppercase tracking-wide text-[#8A6448]">
              Email
            </label>
            <input ref={input} id="signin-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-2xl border-[2.5px] border-[#E4D3BE] bg-white px-4 py-3 text-lg font-bold text-[#3A2A22] outline-none placeholder:font-semibold placeholder:text-[#B5A08A] focus:border-[#F58A3C]" />
            {err && <p className="mt-2 text-sm font-bold text-[#C0492B]">{err}</p>}
            <button type="submit" disabled={busy || !email} className={`${btnP} mt-4 w-full py-3 text-lg`}>
              {busy ? "Sending…" : "Get my code →"}
            </button>
            <button type="button" disabled={busy} onClick={() => void request(undefined, `player-${Math.random().toString(36).slice(2, 7)}@hugshire.test`)} className="mt-2 w-full rounded-2xl py-2 text-sm font-black text-[#C7601F] transition hover:bg-[#FFF1E6]">
              ✨ Use a random test email
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <h2 id="signin-title" className="text-2xl font-black text-[#3A2A22]">Here&apos;s your code</h2>
            <p className="mt-1 text-sm font-semibold text-[#7B6A5C]">
              For <b className="text-[#3A2A22]">{email}</b>
            </p>
            {/* six digit boxes; the hidden input keeps it typeable */}
            <label className="relative mt-4 block cursor-text">
              <input ref={input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="6-digit code" className="absolute inset-0 opacity-0" />
              <span className="flex justify-between gap-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className={`num flex h-14 flex-1 items-center justify-center rounded-2xl border-[3px] text-2xl font-black transition ${code[i] ? "hs-pop border-[#F58A3C] bg-[#FFF1E6] text-[#3A2A22]" : "border-[#E4D3BE] bg-white text-[#C9B39C]"}`}>
                    {code[i] ?? "·"}
                  </span>
                ))}
              </span>
            </label>
            {filled && <div className="hs-pop mt-2 rounded-xl bg-[#FFF4D6] px-3 py-1.5 text-center text-xs font-black text-[#8A6A1E]">🧪 Test mode: we filled in the code for you</div>}
            {err && <p className="mt-2 text-sm font-bold text-[#C0492B]">{err}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className={`${btnP} ${filled ? "hs-glow" : ""} mt-4 w-full py-3 text-lg`}>
              {busy ? "Signing in…" : "Let's go! 🌱"}
            </button>
            <button type="button" onClick={() => { setStep("email"); setCode(""); setErr(null); }} className="mt-2 w-full rounded-2xl py-2 text-sm font-bold text-[#7B6A5C] transition hover:text-[#3A2A22]">
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
