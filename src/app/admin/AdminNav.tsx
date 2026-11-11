"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const TABS = [
  ["/admin", "Dashboard"],
  ["/admin/organizations", "Organizations"],
  ["/admin/causes", "Causes"],
  ["/admin/transactions", "Transactions"],
  ["/admin/payouts", "Payouts"],
  ["/admin/pool", "Community Pool"],
  ["/admin/health", "System health"],
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-paper p-1 shadow-[var(--shadow-soft)]">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} className={cx("whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold", path === href ? "bg-ink text-cream" : "text-ink-soft hover:bg-orange-soft/50 hover:text-ink")}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
