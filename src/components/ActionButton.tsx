"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

/** Posts a JSON body to an API route, then refreshes the server-rendered page. */
export function ActionButton(p: {
  path: string;
  method?: "POST" | "PUT" | "PATCH";
  body?: unknown;
  label: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "soft";
  sz?: "sm" | "md" | "lg";
  askReason?: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (p.confirm && !window.confirm(p.confirm)) return;
    let body = p.body;
    if (p.askReason) {
      const reason = window.prompt("Reason (kept in the audit log):") ?? undefined;
      if (reason === undefined) return;
      body = { ...(p.body as object), reason };
    }
    setBusy(true);
    setErr(null);
    try {
      await api(p.path, p.method ?? "POST", body);
      if (p.redirectTo) window.location.href = p.redirectTo;
      else router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant={p.variant ?? "secondary"} sz={p.sz ?? "sm"} disabled={busy} onClick={go}>
        {busy ? "Working…" : p.label}
      </Button>
      {err && <span className="text-xs font-semibold text-berry">{err}</span>}
    </span>
  );
}
