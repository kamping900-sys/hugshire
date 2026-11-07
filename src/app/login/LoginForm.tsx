"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ devCode?: string }>("/api/auth/dev/request", "POST", { email });
      setSent(true);
      setHint(r.devCode ?? null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/auth/dev/verify", "POST", { email, code });
      window.location.href = next;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That code did not work.");
      setBusy(false);
    }
  }

  return sent ? (
    <form onSubmit={verify} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="code">
          Enter the 6-digit code for {email}
        </label>
        <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="field num tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
        {hint && <p className="mt-2 text-xs text-ink-soft">Development code: <span className="num font-bold text-ink">{hint}</span></p>}
      </div>
      {err && <p className="text-sm font-semibold text-berry">{err}</p>}
      <Button className="w-full" disabled={busy || code.length !== 6}>
        {busy ? "Checking…" : "Sign in"}
      </Button>
      <button type="button" onClick={() => setSent(false)} className="w-full text-sm font-semibold text-ink-soft hover:text-ink">
        Use a different email
      </button>
    </form>
  ) : (
    <form onSubmit={request} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" type="email" autoComplete="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      {err && <p className="text-sm font-semibold text-berry">{err}</p>}
      <Button className="w-full" disabled={busy || !email}>
        {busy ? "Sending…" : "Email me a code"}
      </Button>
    </form>
  );
}
