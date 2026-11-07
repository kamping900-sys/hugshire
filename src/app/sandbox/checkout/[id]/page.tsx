import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { deposits } from "@/server/db/schema";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { defaultCtx } from "@/server/services/context";
import { AnimalAvatar, Card, Notice } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test checkout" };

/** Test-mode stand-in for Coinbase checkout. Does not exist in live mode. */
export default async function SandboxCheckout({ params }: { params: Promise<{ id: string }> }) {
  if (env().HUGSHIRE_MODE !== "sandbox") notFound();
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/sandbox/checkout/${id}`);
  const ctx = await defaultCtx();
  const [d] = await ctx.db.select().from(deposits).where(eq(deposits.id, id));
  if (!d || d.userId !== user.id) notFound();
  if (d.status !== "onramp_pending") redirect(`/portfolio?deposit=${d.id}`);
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="p-7">
        <div className="flex items-center gap-3">
          <AnimalAvatar kind={d.animal} size={56} />
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-ink-soft">Test checkout</div>
            <div className="text-2xl font-extrabold">{formatUsd(d.requestedMicro)}</div>
          </div>
        </div>
        <div className="mt-5">
          <Notice tone="butter" title="No money moves here">
            This page stands in for Coinbase while Hugshire runs in test mode. Completing it simulates a successful card purchase of USDC, with zero fees, so you can try the whole flow. No card is charged.
          </Notice>
        </div>
        <div className="mt-6 flex gap-2">
          <ActionButton path={`/api/deposits/${d.id}/sandbox-complete`} label="Complete test payment" variant="primary" sz="md" redirectTo={`/portfolio?deposit=${d.id}`} />
        </div>
      </Card>
    </div>
  );
}
