import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { animalShapes, type AnimalKind } from "@/lib/animals";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const btn: Record<BtnVariant, string> = {
  primary: "bg-orange text-white hover:bg-orange-deep shadow-[0_6px_16px_-8px_rgba(230,118,36,0.8)]",
  secondary: "bg-paper text-ink border border-line hover:border-orange/50 hover:bg-orange-soft/40",
  ghost: "text-ink hover:bg-orange-soft/60",
  danger: "bg-berry text-white hover:brightness-95",
  soft: "bg-orange-soft text-orange-deep hover:bg-peach",
};
const size = { sm: "h-9 px-3.5 text-sm", md: "h-11 px-5 text-[15px]", lg: "h-13 px-7 text-base" };

export function Button({ variant = "primary", sz = "md", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; sz?: keyof typeof size }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-full font-bold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        btn[variant],
        size[sz],
        className,
      )}
    />
  );
}

export function ButtonLink({ variant = "primary", sz = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant; sz?: keyof typeof size }) {
  return (
    <Link
      {...p}
      className={cx("inline-flex items-center justify-center gap-2 rounded-full font-bold transition active:scale-[0.98]", btn[variant], size[sz], className)}
    />
  );
}

type Tone = "orange" | "leaf" | "berry" | "butter" | "ink" | "sky";
const tones: Record<Tone, string> = {
  orange: "bg-orange-soft text-orange-deep",
  leaf: "bg-leaf-soft text-[#3f7f5b]",
  berry: "bg-berry-soft text-[#b4483f]",
  butter: "bg-butter-soft text-[#946b12]",
  ink: "bg-line-soft text-ink-soft",
  sky: "bg-[#e5f2fa] text-[#3b7ea6]",
};
export function Badge({ tone = "orange", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold", tones[tone], className)}>{children}</span>;
}

export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return (
    <div {...p} className={cx("card", className)}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "orange" | "leaf" }) {
  return (
    <div className="card p-5">
      <div className="text-sm font-semibold text-ink-soft">{label}</div>
      <div className={cx("num mt-1 text-2xl font-extrabold tracking-tight", tone === "orange" && "text-orange-deep", tone === "leaf" && "text-[#3f7f5b]")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {children && <div className="mt-3 text-[15px] leading-relaxed text-ink-soft">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex gap-1">
        <AnimalAvatar kind="otter" size={44} />
        <AnimalAvatar kind="bunny" size={44} />
      </div>
      <div className="text-lg font-bold">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "butter", title, children }: { tone?: "butter" | "berry" | "sky" | "leaf"; title?: string; children: ReactNode }) {
  const t = {
    butter: "border-butter/60 bg-butter-soft/60",
    berry: "border-berry/40 bg-berry-soft",
    sky: "border-sky/50 bg-[#eef7fc]",
    leaf: "border-leaf/40 bg-leaf-soft",
  }[tone];
  return (
    <div className={cx("rounded-2xl border px-4 py-3 text-sm leading-relaxed", t)}>
      {title && <div className="mb-0.5 font-bold">{title}</div>}
      <div className="text-ink/80">{children}</div>
    </div>
  );
}

export function AnimalAvatar({ kind, size = 48, frame = 0, className }: { kind: AnimalKind; size?: number; frame?: number; className?: string }) {
  const shapes = animalShapes(kind, frame);
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label={kind}>
      {shapes.map((s, i) =>
        s.t === "ellipse" ? (
          <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.fill} />
        ) : (
          <polygon key={i} points={s.pts.join(",")} fill={s.fill} />
        ),
      )}
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden>
        <path d="M6 18.5 20 6l14 12.5V33a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill="#F58A3C" />
        <path d="M3.5 19.5 20 4.5l16.5 15" fill="none" stroke="#E67624" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 30.5s-6.2-3.7-6.2-8a3.4 3.4 0 0 1 6.2-1.9 3.4 3.4 0 0 1 6.2 1.9c0 4.3-6.2 8-6.2 8z" fill="#FFF8F0" />
      </svg>
      <span className="text-[21px] font-extrabold tracking-tight">Hugshire</span>
    </span>
  );
}

export function StageBar({ index, progressBps }: { index: number; progressBps: number }) {
  return (
    <div>
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={cx("h-2 flex-1 rounded-full", i <= index ? "bg-orange" : "bg-line")} />
        ))}
      </div>
      <div className="mt-1.5 text-xs text-ink-soft">
        {(progressBps / 100).toFixed(1)}% of the symbolic goal reached by real yield delivered
      </div>
    </div>
  );
}

export const statusTone = (s: string): Tone =>
  ["supplied", "paid", "confirmed", "completed", "approved"].includes(s)
    ? "leaf"
    : ["failed", "rejected", "suspended", "manual_review", "refunded", "cancelled"].includes(s)
      ? "berry"
      : ["pending", "pending_review", "queued", "submitted", "created", "requested"].includes(s)
        ? "butter"
        : "sky";

export const humanStatus = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
