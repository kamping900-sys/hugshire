"use client";
import { useRef, useState } from "react";
import { ANIMAL_LIST, ANIMALS, suggestNickname, type AnimalKind } from "@/lib/animals";
import { api, ApiError, idemKey } from "@/lib/api";
import { AnimalAvatar, Button, cx } from "@/components/ui";

export function SupportForm(p: { causeId: string; cityName: string; minUsd: string; maxUsd: string; riskAcknowledged: boolean; favoriteAnimal: AnimalKind; live: boolean }) {
  const [animal, setAnimal] = useState<AnimalKind>(p.favoriteAnimal);
  const [nickname, setNickname] = useState(suggestNickname(p.favoriteAnimal, 3));
  const [nickTouched, setNickTouched] = useState(false);
  const [amount, setAmount] = useState("25");
  const [ack, setAck] = useState(p.riskAcknowledged);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(idemKey("dep"));

  function pick(a: AnimalKind) {
    setAnimal(a);
    if (!nickTouched) setNickname(suggestNickname(a, 3));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (!p.riskAcknowledged) await api("/api/me", "PUT", { acknowledgeRisk: true });
      const r = await api<{ checkoutUrl: string | null }>("/api/deposits", "POST", { causeId: p.causeId, amountUsd: amount, animal, nickname, idempotencyKey: key.current });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong. No money was taken.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-7 p-6 sm:p-8">
      <div>
        <div className="label">1. Choose your helper</div>
        <div className="grid grid-cols-4 gap-2">
          {ANIMAL_LIST.map((a) => (
            <button
              type="button"
              key={a}
              onClick={() => pick(a)}
              aria-pressed={animal === a}
              className={cx("flex flex-col items-center rounded-2xl border-2 p-2 transition", animal === a ? "border-orange bg-orange-soft/50" : "border-transparent bg-cream/70 hover:border-line")}
            >
              <AnimalAvatar kind={a} size={56} />
              <span className="text-xs font-bold">{ANIMALS[a].label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-ink-soft">{ANIMALS[animal].blurb}</p>
        <div className="mt-3">
          <label className="label" htmlFor="nick">
            Helper name
          </label>
          <input
            id="nick"
            className="field"
            maxLength={24}
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              setNickTouched(true);
            }}
          />
          <p className="mt-1 text-xs text-ink-soft">Other visitors see your helper&apos;s name and animal, never your email.</p>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="amount">
          2. How much would you like to put to work?
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-ink-soft">$</span>
          <input id="amount" inputMode="decimal" className="field num pl-7 text-lg font-bold" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
        <div className="mt-2 flex gap-2">
          {["10", "25", "50", "100"].map((v) => (
            <button type="button" key={v} onClick={() => setAmount(v)} className={cx("rounded-full border px-3 py-1 text-sm font-semibold", amount === v ? "border-orange bg-orange-soft text-orange-deep" : "border-line")}>
              ${v}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Between {p.minUsd} and {p.maxUsd} per deposit. This stays your principal; it is not donated.
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-2xl bg-cream/70 p-4 text-sm">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#F58A3C]" />
        <span>
          I understand Hugshire is not a bank, yield is variable and may be zero, my principal is not guaranteed, and withdrawals depend on real conditions and can take time.
        </span>
      </label>

      {err && <p className="text-sm font-semibold text-berry">{err}</p>}
      <Button sz="lg" className="w-full" disabled={busy || !ack || !amount || !nickname.trim()}>
        {busy ? "Opening checkout…" : p.live ? `Continue to Coinbase` : `Continue to test checkout`}
      </Button>
    </form>
  );
}
