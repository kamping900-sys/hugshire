"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "number" | "email" | "url";
  options?: { value: string; label: string }[];
  defaultValue?: string;
  hint?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
};

/** Small declarative form that sends JSON to a Hugshire API route. */
export function ApiForm(p: {
  path: string;
  method?: "POST" | "PUT" | "PATCH";
  fields: Field[];
  submitLabel: string;
  extra?: Record<string, unknown>;
  redirectTo?: string;
  redirectToResult?: { key: string; prefix: string };
  successText?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(p.fields.map((f) => [f.name, f.defaultValue ?? ""])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body: Record<string, unknown> = { ...p.extra };
    for (const f of p.fields) body[f.name] = f.type === "number" ? Number(values[f.name]) : values[f.name];
    try {
      const r = await api<Record<string, Record<string, string>>>(p.path, p.method ?? "POST", body);
      if (p.redirectToResult) {
        const [obj, key] = p.redirectToResult.key.split(".");
        window.location.href = `${p.redirectToResult.prefix}${r[obj][key]}`;
        return;
      }
      if (p.redirectTo) {
        window.location.href = p.redirectTo;
        return;
      }
      setMsg({ ok: true, t: p.successText ?? "Saved." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof ApiError ? e.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {p.fields.map((f) => {
        const common = {
          id: f.name,
          name: f.name,
          required: f.required,
          maxLength: f.maxLength,
          placeholder: f.placeholder,
          value: values[f.name],
          className: "field",
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [f.name]: e.target.value })),
        };
        return (
          <div key={f.name}>
            <label className="label" htmlFor={f.name}>
              {f.label}
            </label>
            {f.type === "textarea" ? (
              <textarea {...common} rows={5} />
            ) : f.type === "select" ? (
              <select {...common}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input {...common} type={f.type === "number" ? "number" : f.type ?? "text"} />
            )}
            {f.hint && <p className="mt-1 text-xs text-ink-soft">{f.hint}</p>}
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <Button disabled={busy}>{busy ? "Saving…" : p.submitLabel}</Button>
        {msg && <span className={msg.ok ? "text-sm font-semibold text-[#3f7f5b]" : "text-sm font-semibold text-berry"}>{msg.t}</span>}
      </div>
    </form>
  );
}
