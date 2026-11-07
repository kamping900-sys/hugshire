"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

export function SettingInput({ name, label, value }: { name: string; label: string; value: boolean | number | string }) {
  const router = useRouter();
  const [v, setV] = useState(String(value));
  const [err, setErr] = useState<string | null>(null);
  async function save(next: boolean | number | string) {
    setErr(null);
    try {
      await api("/api/admin", "POST", { action: "setting", key: name, value: next });
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    }
  }
  if (typeof value === "boolean") {
    return (
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className={value ? "font-bold text-berry" : ""}>{label}</span>
        <input type="checkbox" className="h-5 w-5 accent-[#D96B62]" checked={value} onChange={(e) => window.confirm(`${e.target.checked ? "Enable" : "Disable"}: ${label}?`) && save(e.target.checked)} />
      </label>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input className="field num h-9 w-36 py-1" value={v} onChange={(e) => setV(e.target.value)} aria-label={label} />
        <Button type="button" sz="sm" variant="secondary" onClick={() => save(typeof value === "number" ? Number(v) : v)}>
          Set
        </Button>
      </span>
      {err && <span className="text-xs text-berry">{err}</span>}
    </div>
  );
}
