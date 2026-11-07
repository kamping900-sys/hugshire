"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CoverUpload({ causeId, current }: { causeId: string; current: string | null }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setMsg("Images must be under 2 MB.");
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch(`/api/causes/${causeId}/cover`, { method: "POST", body: fd });
    const j = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setMsg(j?.error?.message ?? "Upload failed");
    setMsg("Uploaded.");
    router.refresh();
  }
  return (
    <div>
      {current && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={current} alt="Cover" className="mb-3 aspect-[16/9] w-full rounded-2xl object-cover" />
      )}
      <label className="inline-flex">
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        <span className="inline-flex h-9 cursor-pointer items-center rounded-full border border-line bg-paper px-3.5 text-sm font-bold hover:border-orange/50">{busy ? "Uploading…" : current ? "Replace cover image" : "Upload cover image"}</span>
      </label>
      {msg && <p className="mt-2 text-xs font-semibold text-ink-soft">{msg}</p>}
      <p className="mt-1 text-xs text-ink-soft">PNG, JPEG or WebP, up to 2 MB.</p>
    </div>
  );
}
