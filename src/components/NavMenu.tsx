"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

export function NavMenu({ signedIn, email, links }: { signedIn: boolean; email: string | null; links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {!signedIn && (
          <Link href={`/login?next=${encodeURIComponent(path)}`} className="hidden h-10 items-center rounded-full px-4 text-sm font-bold text-ink hover:bg-orange-soft/60 sm:inline-flex">
            Sign in
          </Link>
        )}
        {!signedIn && (
          <Link href="/explore" className="hidden h-10 items-center rounded-full bg-orange px-4 text-sm font-bold text-white hover:bg-orange-deep sm:inline-flex">
            Pick a cause
          </Link>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Menu"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-paper px-3 text-sm font-semibold hover:border-orange/50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          {signedIn && <span className="hidden max-w-[140px] truncate sm:inline">{email}</span>}
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-line bg-paper p-2 shadow-[var(--shadow-lift)]" onClick={() => setOpen(false)}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="block rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-orange-soft/60">
              {l.label}
            </Link>
          ))}
          <div className="my-1 border-t border-line" />
          {signedIn ? (
            <form action="/api/auth/logout" method="post">
              <button className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-berry hover:bg-berry-soft">Sign out</button>
            </form>
          ) : (
            <Link href="/login" className="block rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-orange-soft/60">
              Sign in
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
