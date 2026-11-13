import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { deposits } from "@/server/db/schema";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { defaultCtx } from "@/server/services/context";
import { AnimalAvatar } from "@/components/ui";
import { LandingBackdrop } from "@/components/landing/LandingScene";
import { ActionButton } from "@/components/ActionButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test checkout" };

/** Test-mode stand-in for Coinbase checkout. Does not exist in live mode. */
export default async function SandboxCheckout({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ next?: string }> }) {
  if (env().HUGSHIRE_MODE !== "sandbox") notFound();
  const { id } = await params;
  // where to go after paying (the journey sends players straight into their town). Same-site paths only.
  const nx = (await searchParams).next;
  const after = nx && nx.startsWith("/") && !nx.startsWith("//") ? nx : null;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/sandbox/checkout/${id}`);
  const ctx = await defaultCtx();
  const [d] = await ctx.db.select().from(deposits).where(eq(deposits.id, id));
  if (!d || d.userId !== user.id) notFound();
  if (d.status !== "onramp_pending") redirect(`/portfolio?deposit=${d.id}`);
  // same live world-map background as the landing page, with the checkout as a cozy card on top
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      <LandingBackdrop>
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-[rgba(34,24,19,0.3)] p-4">
          <div className="hs-card-in w-full max-w-md rounded-3xl border-[3px] border-[#8A6448] bg-[#FFF9F0] p-6 text-left shadow-[0_6px_0_#8A6448,0_20px_50px_rgba(0,0,0,0.35)] sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Test checkout</div>
              <span className="rounded-full bg-[#FFF4D6] px-2.5 py-0.5 text-[11px] font-black text-[#8A6A1E]">No money moves</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <AnimalAvatar kind={d.animal} size={56} />
              <div className="text-4xl font-black text-[#3A2A22]">{formatUsd(d.requestedMicro)}</div>
            </div>
            <p className="mt-4 rounded-2xl bg-[#F6EDE2] p-3 text-sm font-semibold leading-relaxed text-[#5C4A3D]">
              This stands in for a card checkout while Hugshire runs in test mode. Completing it pretends you paid, so you can try the whole journey. No card is charged.
            </p>
            <div className="mt-6 flex justify-end">
              <ActionButton path={`/api/deposits/${d.id}/sandbox-complete`} label="Complete test payment →" variant="primary" sz="md" redirectTo={after ?? `/portfolio?deposit=${d.id}`} />
            </div>
          </div>
        </div>
      </LandingBackdrop>
    </div>
  );
}
