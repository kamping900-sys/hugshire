"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button, cx } from "@/components/ui";

type Cause = { id: string; title: string; cityName: string };
type Prefs = {
  deliveryRule: "last_selected" | "default_cause" | "split" | "favorite";
  defaultCauseId: string | null;
  favoriteCauseId: string | null;
  split: { causeId: string; bps: number }[];
  autoEnabled: boolean;
  autoThresholdUsd: string;
  autoSchedule: "inactivity" | "schedule";
  autoIntervalDays: number;
};

const RULES: { v: Prefs["deliveryRule"]; t: string; d: string }[] = [
  { v: "last_selected", t: "Where I delivered last", d: "Keeps going to the last cause you chose by hand." },
  { v: "default_cause", t: "A default cause", d: "Always the cause you pick below." },
  { v: "favorite", t: "My favourite first", d: "Your favourite cause, falling back to your default." },
  { v: "split", t: "Split between causes", d: "Share each delivery by percentage." },
];

export function PreferencesForm({ initial, causes }: { initial: Prefs; causes: Cause[] }) {
  const router = useRouter();
  const [p, setP] = useState<Prefs>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP((x) => ({ ...x, [k]: v }));
  const splitTotal = p.split.reduce((a, s) => a + s.bps, 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/preferences", "PUT", p);
      setMsg({ ok: true, t: "Saved." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof ApiError ? e.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  const CauseSelect = ({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id: string }) => (
    <select id={id} className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— none —</option>
      {causes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title} · {c.cityName}
        </option>
      ))}
    </select>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <label className="flex items-center justify-between gap-4 rounded-2xl bg-cream/70 p-4">
        <span>
          <span className="block font-bold">I authorise automatic delivery</span>
          <span className="text-sm text-ink-soft">
            Off by default. When on, Hugshire may send your eligible yield (never your principal) to the causes chosen by the rule below, on the schedule
            you pick. Being inactive never authorises anything by itself. You can turn this off at any time.
          </span>
        </span>
        <input type="checkbox" className="h-6 w-6 accent-[#F58A3C]" checked={p.autoEnabled} onChange={(e) => set("autoEnabled", e.target.checked)} />
      </label>

      <fieldset>
        <legend className="label">Where should auto deliveries go?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {RULES.map((r) => (
            <label key={r.v} className={cx("cursor-pointer rounded-2xl border-2 p-3.5", p.deliveryRule === r.v ? "border-orange bg-orange-soft/40" : "border-line")}>
              <input type="radio" name="rule" className="sr-only" checked={p.deliveryRule === r.v} onChange={() => set("deliveryRule", r.v)} />
              <span className="block text-sm font-bold">{r.t}</span>
              <span className="text-xs text-ink-soft">{r.d}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="def">
            Default cause
          </label>
          <CauseSelect id="def" value={p.defaultCauseId} onChange={(v) => set("defaultCauseId", v)} />
        </div>
        <div>
          <label className="label" htmlFor="fav">
            Favourite cause
          </label>
          <CauseSelect id="fav" value={p.favoriteCauseId} onChange={(v) => set("favoriteCauseId", v)} />
        </div>
      </div>

      {p.deliveryRule === "split" && (
        <div className="rounded-2xl border border-line p-4">
          <div className="mb-2 flex items-center justify-between text-sm font-bold">
            <span>Split</span>
            <span className={splitTotal === 10000 ? "text-[#3f7f5b]" : "text-berry"}>{splitTotal / 100}% of 100%</span>
          </div>
          {p.split.map((s, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <select
                className="field"
                value={s.causeId}
                onChange={(e) => set("split", p.split.map((x, j) => (j === i ? { ...x, causeId: e.target.value } : x)))}
                aria-label="Cause"
              >
                {causes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <input
                className="field num w-24"
                inputMode="numeric"
                aria-label="Percent"
                value={s.bps / 100}
                onChange={(e) => set("split", p.split.map((x, j) => (j === i ? { ...x, bps: Math.round(Number(e.target.value.replace(/[^\d.]/g, "")) * 100) || 0 } : x)))}
              />
              <Button type="button" variant="ghost" sz="sm" onClick={() => set("split", p.split.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
          {p.split.length < 5 && causes.length > 0 && (
            <Button type="button" variant="soft" sz="sm" onClick={() => set("split", [...p.split, { causeId: causes[0].id, bps: 0 }])}>
              Add a cause
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="thr">
            Deliver automatically once at least
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-ink-soft">$</span>
            <input id="thr" className="field num pl-7" inputMode="decimal" value={p.autoThresholdUsd} onChange={(e) => set("autoThresholdUsd", e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="sch">
            When
          </label>
          <select id="sch" className="field" value={p.autoSchedule} onChange={(e) => set("autoSchedule", e.target.value as Prefs["autoSchedule"])}>
            <option value="inactivity">Only after 7 days without playing</option>
            <option value="schedule">On a schedule</option>
          </select>
          {p.autoSchedule === "schedule" && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              Every
              <input aria-label="Days between deliveries" className="field num w-20" inputMode="numeric" value={p.autoIntervalDays} onChange={(e) => set("autoIntervalDays", Number(e.target.value.replace(/\D/g, "")) || 1)} />
              days
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button disabled={busy}>{busy ? "Saving…" : "Save rules"}</Button>
        {msg && <span className={msg.ok ? "text-sm font-semibold text-[#3f7f5b]" : "text-sm font-semibold text-berry"}>{msg.t}</span>}
      </div>
    </form>
  );
}
