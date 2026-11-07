import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { formatUsd, wadToPercentString } from "@/lib/money";
import { getSettings } from "@/server/core";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { defaultCtx } from "@/server/services/context";
import { getCauseBySlug } from "@/server/services/orgs";
import { Notice, PageHeader } from "@/components/ui";
import { SupportForm } from "./SupportForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Support a town" };

export default async function Support({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/support/${slug}`);
  const ctx = await defaultCtx();
  const data = await getCauseBySlug(ctx, slug);
  if (!data || data.cause.status !== "approved" || data.org.status !== "approved") notFound();
  const settings = await getSettings(ctx.db);
  let apr: string | null = null;
  try {
    apr = wadToPercentString(await ctx.p.lending.supplyApr());
  } catch {
    apr = null;
  }
  const live = env().HUGSHIRE_MODE === "live";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link href={`/city/${slug}`} className="text-sm font-semibold text-ink-soft hover:text-ink">
        ← Back to {data.city.name}
      </Link>
      <div className="mt-4">
        <PageHeader eyebrow={data.cause.title} title={`Support ${data.city.name}`}>
          Add money, choose your helper, and let the yield go to work. You can request your principal back later.
        </PageHeader>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <SupportForm
          causeId={data.cause.id}
          cityName={data.city.name}
          minUsd={formatUsd(BigInt(settings.minDepositMicro))}
          maxUsd={formatUsd(BigInt(settings.maxDepositMicro))}
          riskAcknowledged={!!user.profile?.riskAcknowledgedAt}
          favoriteAnimal={(user.profile?.favoriteAnimal as never) ?? "cat"}
          live={live}
        />
        <aside className="space-y-4">
          <div className="card p-6 text-sm">
            <div className="font-bold">What happens next</div>
            <ol className="mt-3 space-y-2.5 text-ink-soft">
              <li>1. {live ? "Coinbase checkout opens. You pay by card or Apple Pay and receive USDC on Base in your own Hugshire wallet." : "A test checkout opens. No card is charged."}</li>
              <li>2. Your USDC moves to NEAR through NEAR Intents{live ? " (you confirm the transfer)" : ""}.</li>
              <li>3. It is deposited into the Hugshire Vault, which lends it on RHEA.</li>
              <li>4. Your helper moves into {data.city.name}. Yield starts counting from the moment the money is supplied.</li>
            </ol>
          </div>
          <div className="card p-6 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold">RHEA USDC supply rate today</span>
              <span className="num text-lg font-extrabold text-orange-deep">{apr ?? "unavailable"}</span>
            </div>
            <p className="mt-2 text-ink-soft">Read live from RHEA on NEAR mainnet. It changes all the time and can fall to zero. Hugshire does not promise any return.</p>
          </div>
          <Notice tone="butter" title="Please read before adding money">
            Hugshire is not a bank. Your deposit is not insured and its value is not guaranteed. It depends on the RHEA lending protocol and on a smart contract that, at this stage, has not been independently audited. Fees from Coinbase and the bridge reduce what is deposited. Withdrawals take time.
          </Notice>
        </aside>
      </div>
    </div>
  );
}
