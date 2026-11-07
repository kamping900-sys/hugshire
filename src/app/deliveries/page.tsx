import Link from "next/link";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { charityPayouts } from "@/server/db/schema";
import { currentUser } from "@/server/http";
import { defaultCtx } from "@/server/services/context";
import { getPreferences, listDeliveries } from "@/server/services/deliveries";
import { deliverableCauses } from "@/server/services/me";
import { yieldSummary } from "@/server/services/yield";
import { Badge, Empty, humanStatus, PageHeader, Stat, statusTone } from "@/components/ui";
import { PreferencesForm } from "./PreferencesForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My deliveries" };

const STATUS_TEXT: Record<string, string> = {
  pending: "Assigned · waiting for payout",
  queued: "In a payout batch",
  paid: "Paid to the cause",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default async function Deliveries() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/deliveries");
  const ctx = await defaultCtx();
  const list = await listDeliveries(ctx, user.id);
  const y = await yieldSummary(ctx, user.id);
  const prefs = await getPreferences(ctx, user.id);
  const causes = await deliverableCauses(ctx);
  const payoutIds = [...new Set(list.map((l) => l.d.payoutId).filter(Boolean))] as string[];
  const payouts = new Map<string, { txHash: string | null; status: string }>();
  for (const id of payoutIds) {
    const [p] = await ctx.db.select({ txHash: charityPayouts.txHash, status: charityPayouts.status }).from(charityPayouts).where(eq(charityPayouts.id, id));
    if (p) payouts.set(id, p);
  }
  const open = list.filter((l) => l.d.status === "pending" || l.d.status === "queued");
  const done = list.filter((l) => !(l.d.status === "pending" || l.d.status === "queued"));
  const explorer = (tx: string) => (tx.startsWith("sandbox-") ? null : `https://nearblocks.io/txns/${tx}`);

  const Row = ({ l }: { l: (typeof list)[number] }) => {
    const p = l.d.payoutId ? payouts.get(l.d.payoutId) : undefined;
    const link = p?.txHash ? explorer(p.txHash) : null;
    return (
      <li className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="num font-bold">{formatUsd(l.d.amountMicro, { precise: true })}</span>
            <Badge tone={statusTone(l.d.status)}>{STATUS_TEXT[l.d.status] ?? humanStatus(l.d.status)}</Badge>
            <Badge tone="ink">{l.d.mode === "auto" ? "Auto" : "By hand"}</Badge>
          </div>
          <Link href={`/city/${l.causeSlug}`} className="text-sm text-ink-soft hover:underline">
            {l.causeTitle}
          </Link>
        </div>
        <div className="text-xs text-ink-soft sm:text-right">
          {l.d.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          {p?.txHash && (
            <div>
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer" className="font-semibold text-orange-deep hover:underline">
                  View transaction
                </a>
              ) : (
                <span>Test-mode payout (no transaction)</span>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader eyebrow="My deliveries" title="Where your yield has gone">
        A delivery assigns yield your money already earned to a cause. It is paid out on chain in batches; each payout links to its transaction.
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Ready to deliver" tone="leaf" value={formatUsd(y.eligibleMicro, { precise: true })} />
        <Stat label="Still settling" value={formatUsd(y.settlingMicro, { precise: true })} hint="Becomes deliverable after the settlement window" />
        <Stat label="Earned in total" tone="orange" value={formatUsd(y.earnedMicro, { precise: true })} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="text-lg font-extrabold">Pending</h2>
            {open.length ? (
              <ul className="divide-y divide-line-soft">
                {open.map((l) => (
                  <Row key={l.d.id} l={l} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">Nothing waiting for payout.</p>
            )}
          </section>
          <section className="card p-6">
            <h2 className="text-lg font-extrabold">History</h2>
            {done.length ? (
              <ul className="divide-y divide-line-soft">
                {done.map((l) => (
                  <Row key={l.d.id} l={l} />
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <Empty title="No deliveries yet">Visit one of your towns and carry parcels to the Cause Hall, or set an auto rule.</Empty>
              </div>
            )}
          </section>
        </div>
        <section className="card p-6">
          <h2 className="text-lg font-extrabold">Auto-delivery rules</h2>
          <div className="mt-4">
            <PreferencesForm
              causes={causes}
              initial={{
                deliveryRule: prefs.deliveryRule,
                defaultCauseId: prefs.defaultCauseId,
                favoriteCauseId: prefs.favoriteCauseId,
                split: prefs.split,
                autoEnabled: prefs.autoEnabled,
                autoThresholdUsd: (Number(prefs.autoThresholdMicro / 10_000n) / 100).toFixed(2),
                inactivityTimeoutMinutes: Math.round(prefs.inactivityTimeoutSeconds / 60),
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
