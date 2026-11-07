import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, inArray } from "drizzle-orm";
import { formatUsd } from "@/lib/money";
import { causes, cities, deliveries, helpers } from "@/server/db/schema";
import { causeStats, computeStage } from "@/server/services/orgs";
import { AnimalAvatar, Badge, ButtonLink, Card, humanStatus, Notice, PageHeader, Stat, statusTone } from "@/components/ui";
import { ApiForm } from "@/components/ApiForm";
import { loadOrg, OrgNav } from "./shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Organizer portal" };

export default async function OrgHome() {
  const { ctx, org } = await loadOrg("/org");
  if (!org) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <PageHeader eyebrow="For organisations" title="Give your cause a town">
          Create your organisation. Hugshire reviews every organisation before its causes go live, and verifies where payouts are sent. You never need to understand crypto.
        </PageHeader>
        <Card className="p-6">
          <ApiForm
            path="/api/org"
            submitLabel="Create organisation"
            redirectTo="/org"
            fields={[
              { name: "name", label: "Organisation name", required: true, maxLength: 80 },
              { name: "contactEmail", label: "Contact email", type: "email", required: true },
              { name: "website", label: "Website", type: "url", placeholder: "https://" },
              { name: "taxId", label: "EIN / registration number", hint: "Only Hugshire admins see this. It helps us verify you." },
              { name: "description", label: "What does your organisation do?", type: "textarea", maxLength: 2000 },
            ]}
          />
        </Card>
      </div>
    );
  }

  const myCauses = await ctx.db.select({ c: causes, city: cities }).from(causes).innerJoin(cities, eq(cities.causeId, causes.id)).where(eq(causes.orgId, org.id));
  const ids = myCauses.map((m) => m.c.id);
  const stats = await causeStats(ctx, ids);
  const totals = [...stats.values()].reduce((a, s) => ({ paid: a.paid + s.paidMicro, pending: a.pending + s.pendingMicro, helpers: a.helpers + s.helpers }), { paid: 0n, pending: 0n, helpers: 0 });
  // Supporter activity without personal data: animal, helper name, amount, time.
  const recent = ids.length
    ? await ctx.db
        .select({ amount: deliveries.amountMicro, at: deliveries.createdAt, mode: deliveries.mode, causeId: deliveries.causeId, animal: helpers.animal, nickname: helpers.nickname })
        .from(deliveries)
        .leftJoin(helpers, eq(helpers.id, deliveries.helperId))
        .where(inArray(deliveries.causeId, ids))
        .orderBy(desc(deliveries.createdAt))
        .limit(10)
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <OrgNav active="/org" orgName={org.name} status={org.status} />
      {org.status === "pending" && (
        <div className="mb-6">
          <Notice tone="butter" title="Your organisation is being reviewed">
            You can prepare causes now. They go live after Hugshire approves your organisation and each cause.
          </Notice>
        </div>
      )}
      {!org.payoutVerifiedAt && (
        <div className="mb-6">
          <Notice tone="sky" title="Set up where payouts go">
            Add your receiving account in <Link href="/org/settings" className="font-bold underline">Settings</Link>. Hugshire verifies it before any yield can be sent.
          </Notice>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Yield received" tone="orange" value={formatUsd(totals.paid, { precise: true })} hint="Paid to your verified account" />
        <Stat label="Assigned, awaiting payout" value={formatUsd(totals.pending, { precise: true })} />
        <Stat label="Helpers in your towns" value={totals.helpers} />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold">Causes</h2>
            <ButtonLink href="/org/causes/new" sz="sm">
              New cause
            </ButtonLink>
          </div>
          <ul className="mt-4 divide-y divide-line-soft">
            {myCauses.map(({ c, city }) => {
              const s = stats.get(c.id)!;
              const st = computeStage(s.paidMicro, c.goalMicro);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <Link href={`/org/causes/${c.id}`} className="font-bold hover:underline">
                      {city.name}
                    </Link>
                    <div className="text-sm text-ink-soft">{c.title}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={statusTone(c.status)}>{humanStatus(c.status)}</Badge>
                    <span className="text-xs text-ink-soft">{st.name}</span>
                  </div>
                </li>
              );
            })}
            {!myCauses.length && <li className="py-3 text-sm text-ink-soft">No causes yet.</li>}
          </ul>
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-extrabold">Recent supporter activity</h2>
          <ul className="mt-4 space-y-3">
            {recent.map((r, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <AnimalAvatar kind={r.animal ?? "cat"} size={32} />
                <span className="flex-1">
                  <b>{r.nickname ?? "A helper"}</b> {r.mode === "auto" ? "auto-delivered" : "delivered"} <span className="num font-semibold">{formatUsd(r.amount, { precise: true })}</span>
                </span>
                <span className="text-xs text-ink-soft">{r.at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </li>
            ))}
            {!recent.length && <li className="text-sm text-ink-soft">Deliveries will appear here.</li>}
          </ul>
          <p className="mt-4 text-xs text-ink-soft">Supporters are shown only by their helper. Hugshire never shares supporters&apos; names or emails.</p>
        </Card>
      </div>
    </div>
  );
}
