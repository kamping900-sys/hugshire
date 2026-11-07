"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ANIMAL_LIST, ANIMALS, type AnimalKind } from "@/lib/animals";
import { api, ApiError } from "@/lib/api";
import { AnimalAvatar, Button, cx } from "@/components/ui";

export function ProfileForm({ displayName, favoriteAnimal }: { displayName: string; favoriteAnimal: AnimalKind }) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [animal, setAnimal] = useState<AnimalKind>(favoriteAnimal);
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/me", "PUT", { displayName: name, favoriteAnimal: animal });
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not save");
    }
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label className="label" htmlFor="dn">
          Display name
        </label>
        <input id="dn" className="field" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <div className="label">Favourite animal (used for new helpers)</div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {ANIMAL_LIST.map((a) => (
            <button type="button" key={a} onClick={() => setAnimal(a)} aria-pressed={animal === a} className={cx("flex flex-col items-center rounded-2xl border-2 p-1.5", animal === a ? "border-orange bg-orange-soft/40" : "border-transparent bg-cream/70")}>
              <AnimalAvatar kind={a} size={40} />
              <span className="text-[11px] font-bold">{ANIMALS[a].label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button>Save</Button>
        {msg && <span className="text-sm font-semibold text-ink-soft">{msg}</span>}
      </div>
    </form>
  );
}
