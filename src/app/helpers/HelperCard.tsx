"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ANIMAL_LIST, ANIMALS, type AnimalKind } from "@/lib/animals";
import { api, ApiError } from "@/lib/api";
import { AnimalAvatar, Badge, Button, cx } from "@/components/ui";

export function HelperCard(p: {
  id: string;
  animal: AnimalKind;
  nickname: string;
  cityName: string;
  citySlug: string;
  preference: "manual" | "auto";
  mode: "manual" | "auto";
  reason: string;
  idleMinutes: number | null;
  timeoutMinutes: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nick, setNick] = useState(p.nickname);
  const [animal, setAnimal] = useState(p.animal);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(body: object) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/helpers/${p.id}`, "PATCH", body);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-cream p-2">
          <AnimalAvatar kind={animal} size={72} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-extrabold">{p.nickname}</div>
          <div className="text-sm text-ink-soft">
            {ANIMALS[p.animal].label} in{" "}
            <Link href={`/city/${p.citySlug}`} className="font-semibold text-orange-deep hover:underline">
              {p.cityName}
            </Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={p.mode === "manual" ? "orange" : "sky"}>{p.mode === "manual" ? "Manual" : "Auto"}</Badge>
            {p.reason === "inactive" && <Badge tone="ink">Away {p.idleMinutes ?? "—"} min (switches after {p.timeoutMinutes})</Badge>}
            {p.reason === "preference" && <Badge tone="ink">Always auto</Badge>}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-cream/70 p-1.5 text-sm font-bold">
        {(["manual", "auto"] as const).map((m) => (
          <button
            key={m}
            disabled={busy}
            onClick={() => save({ controlPreference: m })}
            className={cx("rounded-xl px-3 py-2 transition", p.preference === m ? "bg-paper shadow-sm" : "text-ink-soft hover:text-ink")}
          >
            {m === "manual" ? "I deliver myself" : "Always auto-deliver"}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        In manual, you switch to auto after {p.timeoutMinutes} minutes without playing, and back when you return.
      </p>

      {editing ? (
        <div className="mt-4 space-y-3">
          <input className="field" maxLength={24} value={nick} onChange={(e) => setNick(e.target.value)} aria-label="Helper name" />
          <div className="grid grid-cols-8 gap-1">
            {ANIMAL_LIST.map((a) => (
              <button key={a} onClick={() => setAnimal(a)} aria-label={ANIMALS[a].label} className={cx("rounded-xl border-2 p-0.5", animal === a ? "border-orange" : "border-transparent")}>
                <AnimalAvatar kind={a} size={34} />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button sz="sm" disabled={busy} onClick={() => save({ nickname: nick, animal })}>
              Save
            </Button>
            <Button sz="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-4 text-sm font-bold text-orange-deep hover:underline">
          Change name or look
        </button>
      )}
      {err && <p className="mt-2 text-sm text-berry">{err}</p>}
    </div>
  );
}
