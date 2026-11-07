import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { Logo } from "@/components/ui";
import { NavMenu } from "@/components/NavMenu";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Hugshire — where kindness takes shape", template: "%s · Hugshire" },
  description: "Support real causes with the yield your money earns, while a cozy animal helper builds their town.",
};
export const viewport: Viewport = { themeColor: "#F58A3C", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const sandbox = env().HUGSHIRE_MODE === "sandbox";
  const links = [
    { href: "/explore", label: "Explore" },
    { href: "/how-it-works", label: "How it works" },
    ...(user
      ? [
          { href: "/portfolio", label: "Portfolio" },
          { href: "/helpers", label: "Helpers" },
          { href: "/deliveries", label: "Deliveries" },
        ]
      : []),
  ];
  const extra = user ? [{ href: "/org", label: "Organizer portal" }, ...(user.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []), { href: "/settings", label: "Settings" }] : [];
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-dvh">
        {sandbox && (
          <div className="bg-ink px-4 py-1.5 text-center text-xs font-semibold text-cream">
            Test mode — no real money moves. Yield is simulated from RHEA&apos;s live USDC rate.
          </div>
        )}
        <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
            <Link href="/" aria-label="Hugshire home">
              <Logo />
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="rounded-full px-3 py-2 text-sm font-semibold text-ink/80 hover:bg-orange-soft/60 hover:text-ink">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <NavMenu signedIn={!!user} email={user?.email ?? null} links={[...links, ...extra]} />
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="mt-24 border-t border-line bg-paper/60">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-ink-soft md:grid-cols-[1.2fr_1fr_1fr]">
            <div>
              <Logo />
              <p className="mt-3 max-w-sm leading-relaxed">Where kindness takes shape. Your money stays yours; the yield it earns supports causes you choose.</p>
            </div>
            <div className="space-y-2">
              <div className="font-bold text-ink">Hugshire</div>
              <Link className="block hover:text-ink" href="/explore">Explore the world</Link>
              <Link className="block hover:text-ink" href="/how-it-works">How money works</Link>
              <Link className="block hover:text-ink" href="/org">For organisations</Link>
            </div>
            <div className="space-y-2 leading-relaxed">
              <div className="font-bold text-ink">Please know</div>
              <p>Hugshire is not a bank and deposits are not insured. Yield is variable and can be zero. Principal is not guaranteed and depends on the lending protocol. Withdrawals take time and depend on real conditions.</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
