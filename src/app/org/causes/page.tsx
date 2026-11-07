import Link from "next/link";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { causes, cities } from "@/server/db/schema";
import { causeStats, computeStage } from "@/server/services/orgs";
import { Badge, ButtonLink, Empty, humanStatus, StageBar, statusTone } from "@/components/ui";
import { loadOrg, OrgNav } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My causes" };

export default async function OrgCauses() {
  const { ctx, org } = await loadOrg("/org/causes");
  if (!org) redirect("/org");
  const rows = await ctx.db.select({ c: causes, city: cities }).from(causes).innerJoin(cities, eq(cities.causeId, causes.id)).where(eq(causes.orgId, org.id));
  const stats = await causeStats(ctx, rows.map((r) => r.c.id));
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <OrgNav active="/org/causes" orgName={org.name} status={org.status} />
      <div className="mb-4 flex justify-end">
        <ButtonLink href="/org/causes/new">New cause</ButtonLink>
      </div>
      {rows.length === 0 ? (
        <Empty title="No causes yet" action={<ButtonLink href="/org/causes/new">Create your first cause</ButtonLink>}>
          Each cause gets its own town on the Hugshire map.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ c, city }) => {
            const s = stats.get(c.id)!;
            const st = computeStage(s.paidMicro, c.goalMicro);
            return (
              <Link key={c.id} href={`/org/causes/${c.id}`} className="card p-5 hover:shadow-[var(--shadow-lift)]">
                <div className="flex items-center justify-between">
                  <Badge tone={statusTone(c.status)}>{humanStatus(c.status)}</Badge>
                  <span className="text-xs text-ink-soft">{s.helpers} helpers</span>
                </div>
                <div className="mt-3 text-xl font-extrabold">{city.name}</div>
                <div className="text-sm text-ink-soft">{c.title}</div>
                <div className="mt-4">
                  <StageBar index={st.index} progressBps={st.progressBps} />
                </div>
                <div className="mt-3 text-sm">
                  <span className="num font-bold">{formatUsd(s.paidMicro, { precise: true })}</span> <span className="text-ink-soft">received · goal {formatUsd(c.goalMicro)}</span>
                </div>
                {c.reviewNote && <p className="mt-2 text-xs text-berry">Review note: {c.reviewNote}</p>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
