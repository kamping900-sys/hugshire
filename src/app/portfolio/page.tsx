import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { formatUsd, wadToPercentString } from "@/lib/money";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { defaultCtx } from "@/server/services/context";
import { portfolio } from "@/server/services/me";
import { AnimalAvatar, Badge, ButtonLink, Empty, humanStatus, Notice, PageHeader, Stat, statusTone } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";
import { WithdrawForm } from "./WithdrawForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My portfolio" };

const DEPOSIT_STEPS = ["onramp_pending", "onramp_completed", "bridging", "bridged", "vault_pending", "supplied"];
const DEPOSIT_LABEL: Record<string, string> = {
  created: "Starting",
  onramp_pending: "Waiting for checkout",
  onramp_completed: "Payment received",
  bridging: "Moving to NEAR",
  bridged: "Arrived on NEAR",
  vault_pending: "Entering the Vault",
  supplied: "Earning on RHEA",
  failed: "Not completed",
  refunded: "Refunded",
  manual_review: "Being reviewed",
};

export default async function Portfolio() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/portfolio");
  const ctx = await defaultCtx();
  const p = await portfolio(ctx, user.id);
  const live = env().HUGSHIRE_MODE === "live";
  const inFlight = p.deposits.some((d) => !["supplied", "failed", "refunded", "onramp_pending"].includes(d.d.status)) || p.withdrawals.some((w) => !["completed", "failed"].includes(w.status));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <AutoRefresh active={inFlight} />
      <PageHeader eyebrow="My portfolio" title="Your money, and what it has done" actions={<ButtonLink href="/explore">Support another town</ButtonLink>}>
        Values come from the Hugshire ledger, checked against the lending pool. Nothing here is a promise of future returns.
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Principal working" value={formatUsd(p.principalMicro)} hint={`${formatUsd(p.totalDepositedMicro)} deposited in total`} />
        <Stat label="Withdrawable estimate" value={formatUsd(p.redeemableMicro)} hint={p.poolHealthy ? "Before bridge and cash-out fees" : "Pool below principal: pro-rata"} />
        <Stat label="Yield earned (lifetime)" tone="orange" value={formatUsd(p.yield.earnedMicro, { precise: true })} hint={p.aprWad !== null ? `RHEA supply rate ${wadToPercentString(p.aprWad)} at last check` : undefined} />
        <Stat label="Ready to deliver" tone="leaf" value={formatUsd(p.yield.eligibleMicro, { precise: true })} hint={p.yield.settlingMicro > 0n ? `${formatUsd(p.yield.settlingMicro, { precise: true })} still settling` : "Yield you can deliver now"} />
      </div>

      {!p.poolHealthy && (
        <div className="mt-4">
          <Notice tone="berry" title="The lending pool is below total principal">
            Hugshire has paused yield and alerted its operators. Withdrawals are paid pro-rata to what the pool actually holds.
          </Notice>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="card p-6">
          <h2 className="text-lg font-extrabold">Deposits</h2>
          {p.deposits.length === 0 ? (
            <div className="mt-4">
              <Empty title="No deposits yet" action={<ButtonLink href="/explore">Pick a cause</ButtonLink>}>
                Choose a town, add money, and a helper moves in.
              </Empty>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line-soft">
              {p.deposits.map(({ d, causeTitle, causeSlug, cityName }) => {
                const step = DEPOSIT_STEPS.indexOf(d.status);
                return (
                  <li key={d.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                    <AnimalAvatar kind={d.animal} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num font-bold">{formatUsd(d.principalMicro ?? d.requestedMicro)}</span>
                        <Badge tone={statusTone(d.status)}>{DEPOSIT_LABEL[d.status] ?? humanStatus(d.status)}</Badge>
                      </div>
                      <div className="text-sm text-ink-soft">
                        {d.helperNickname} in{" "}
                        <Link className="font-semibold hover:underline" href={`/city/${causeSlug}`}>
                          {cityName}
                        </Link>{" "}
                        · {causeTitle}
                      </div>
                      {step >= 0 && d.status !== "supplied" && (
                        <div className="mt-2 flex gap-1" aria-label={`Step ${step + 1} of ${DEPOSIT_STEPS.length}`}>
                          {DEPOSIT_STEPS.map((s, i) => (
                            <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-orange" : "bg-line"}`} />
                          ))}
                        </div>
                      )}
                      {d.failureReason && <div className="mt-1 text-xs text-berry">{d.failureReason}</div>}
                    </div>
                    <div className="text-xs text-ink-soft sm:text-right">
                      {d.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                      {d.feesMicro > 0n && <div>fees {formatUsd(d.feesMicro)}</div>}
                      {d.status === "onramp_pending" && !live && (
                        <Link className="font-bold text-orange-deep hover:underline" href={`/sandbox/checkout/${d.id}`}>
                          Finish test checkout
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-6">
          <section className="card p-6">
            <h2 className="text-lg font-extrabold">Withdraw principal</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Available to request: <span className="num font-bold text-ink">{formatUsd(p.principalMicro)}</span>
            </p>
            <div className="mt-4">
              <WithdrawForm maxUsd={formatUsd(p.principalMicro)} live={live} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-soft">
              Withdrawals go through stages: leaving RHEA, crossing back to Base, then cash-out through Coinbase. It is not instant. You receive the real value at the time, minus bridge and cash-out fees. Yield already earned stays with the causes.
            </p>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-extrabold">Withdrawals</h2>
            {p.withdrawals.length === 0 && <p className="mt-2 text-sm text-ink-soft">None yet.</p>}
            <ul className="mt-3 space-y-4">
              {p.withdrawals.map((w) => (
                <li key={w.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="num font-bold">{formatUsd(w.requestedMicro)}</span>
                    <Badge tone={statusTone(w.status)}>{humanStatus(w.status)}</Badge>
                  </div>
                  <ol className="mt-2 space-y-0.5 border-l-2 border-line pl-3 text-xs text-ink-soft">
                    {w.history.map((h, i) => (
                      <li key={i}>
                        {humanStatus(h.status)} · {new Date(h.at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}
                        {h.note && <span className="block text-ink-soft/80">{h.note}</span>}
                      </li>
                    ))}
                  </ol>
                  {w.receivedMicro !== null && <div className="mt-1 text-xs">Received: {formatUsd(w.receivedMicro)}</div>}
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-extrabold">Towns you support</h2>
            {p.linkedCauses.length === 0 && <p className="mt-2 text-sm text-ink-soft">None yet.</p>}
            <ul className="mt-3 space-y-2">
              {p.linkedCauses.map((c) => (
                <li key={c.id}>
                  <Link href={`/city/${c.slug}`} className="flex items-center justify-between rounded-xl bg-cream/70 px-3 py-2.5 text-sm font-semibold hover:bg-orange-soft/60">
                    <span>{c.cityName}</span>
                    <span className="text-ink-soft">{c.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
