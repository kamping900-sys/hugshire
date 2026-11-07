import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { AnimalAvatar, Card, Notice } from "@/components/ui";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/portfolio";
  if (await currentUser()) redirect(safeNext);
  const e = env();
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <div className="mb-6 flex justify-center gap-1">
        <AnimalAvatar kind="cat" size={56} />
        <AnimalAvatar kind="dog" size={56} />
        <AnimalAvatar kind="capybara" size={56} />
      </div>
      <Card className="p-7">
        <h1 className="text-2xl font-extrabold tracking-tight">Welcome to Hugshire</h1>
        <p className="mt-1 text-sm text-ink-soft">Sign in with your email. No password, no wallet setup.</p>
        {e.AUTH_PROVIDER === "dev" ? (
          <LoginForm next={safeNext} />
        ) : (
          <div className="mt-6">
            <Notice tone="butter" title="Email and Google sign-in">
              Live sign-in uses Privy (email or Google) and creates your own Hugshire wallets. The Privy client step is not installed in this build yet — see SETUP_GUIDE.md §3.
            </Notice>
          </div>
        )}
      </Card>
      {e.AUTH_PROVIDER === "dev" && <p className="mt-4 text-center text-xs text-ink-soft">Development sign-in: the 6-digit code is printed in the server log{e.NODE_ENV !== "production" ? " and shown here" : ""}.</p>}
    </div>
  );
}
