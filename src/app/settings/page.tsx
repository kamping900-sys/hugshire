import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { defaultCtx } from "@/server/services/context";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function Settings() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings");
  const ctx = await defaultCtx();
  const wallets = await ctx.p.wallet.getUserWallets({ userId: user.id, authSubject: user.authSubject }).catch(() => ({ baseAddress: null, nearAccountId: null }));
  const live = env().HUGSHIRE_MODE === "live";
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader eyebrow="Settings" title="Your profile" />
      <div className="space-y-6">
        <Card className="p-6">
          <ProfileForm displayName={user.profile?.displayName ?? ""} favoriteAnimal={(user.profile?.favoriteAnimal as never) ?? "cat"} />
        </Card>
        <Card className="p-6">
          <div className="font-bold">Account</div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-ink-soft">Email</dt>
            <dd className="font-semibold">{user.email}</dd>
            <dt className="text-ink-soft">Sign-in</dt>
            <dd>{user.authProvider === "privy" ? "Email / Google via Privy" : "Development email code"}</dd>
            <dt className="text-ink-soft">Risk notice</dt>
            <dd>{user.profile?.riskAcknowledgedAt ? `Accepted ${user.profile.riskAcknowledgedAt.toLocaleDateString("en-US")}` : "Not yet accepted"}</dd>
          </dl>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-2 font-bold">
            Your Hugshire wallets {!live && <Badge tone="ink">Test mode</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-soft">You own these wallets. Hugshire cannot move money out of them; only you can approve transfers.</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-ink-soft">Base (receives USDC)</dt>
            <dd className="num break-all font-mono text-xs">{wallets.baseAddress ?? "Created on first live sign-in"}</dd>
            <dt className="text-ink-soft">NEAR (owns your principal)</dt>
            <dd className="num break-all font-mono text-xs">{wallets.nearAccountId ?? "Created on first live sign-in"}</dd>
          </dl>
          {!live && (
            <div className="mt-3">
              <Notice tone="butter">In test mode these are placeholder labels, not real addresses. Never send funds to them.</Notice>
            </div>
          )}
        </Card>
        <form action="/api/auth/logout" method="post">
          <button className="text-sm font-bold text-berry hover:underline">Sign out</button>
        </form>
      </div>
    </div>
  );
}
