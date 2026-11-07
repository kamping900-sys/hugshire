"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, idemKey } from "@/lib/api";
import { Button } from "@/components/ui";

export function WithdrawForm({ maxUsd, live }: { maxUsd: string; live: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const key = useRef(idemKey("wd"));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(`Request a withdrawal of $${amount}? This principal stops earning yield right away.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/withdrawals", "POST", { amountUsd: amount, idempotencyKey: key.current });
      key.current = idemKey("wd");
      setAmount("");
      setMsg({ ok: true, text: live ? "Requested. Next, confirm the Vault withdrawal in your wallet." : "Requested. Test mode moves it through each stage in a few seconds." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Could not request the withdrawal." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-ink-soft">$</span>
          <input aria-label="Amount to withdraw" inputMode="decimal" className="field num pl-7" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
        <Button type="button" variant="secondary" onClick={() => setAmount(maxUsd.replace(/[$,]/g, ""))}>
          Max
        </Button>
      </div>
      <Button className="w-full" variant="secondary" disabled={busy || !amount}>
        {busy ? "Requesting…" : "Request withdrawal"}
      </Button>
      {msg && <p className={msg.ok ? "text-sm font-semibold text-[#3f7f5b]" : "text-sm font-semibold text-berry"}>{msg.text}</p>}
    </form>
  );
}
