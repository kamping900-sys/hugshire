import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { causes, causeUpdates, cities } from "@/server/db/schema";
import { causeStats, computeStage } from "@/server/services/orgs";
import { Badge, Card, humanStatus, Notice, StageBar, statusTone } from "@/components/ui";
import { ApiForm } from "@/components/ApiForm";
import { ActionButton } from "@/components/ActionButton";
import { loadOrg, OrgNav } from "../../shared";
import { CATEGORY_OPTIONS } from "@/lib/categories";
import { CoverUpload } from "./CoverUpload";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit cause" };

export default async function EditCause({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, org } = await loadOrg(`/org/causes/${id}`);
  if (!org) redirect("/org");
  const [row] = await ctx.db.select({ c: causes, city: cities }).from(causes).innerJoin(cities, eq(cities.causeId, causes.id)).where(eq(causes.id, id));
  if (!row || row.c.orgId !== org.id) notFound();
  const { c, city } = row;
  const s = (await causeStats(ctx, [c.id])).get(c.id)!;
  const st = computeStage(s.paidMicro, c.goalMicro);
  const updates = await ctx.db.select().from(causeUpdates).where(eq(causeUpdates.causeId, c.id)).orderBy(desc(causeUpdates.createdAt));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <OrgNav active="/org/causes" orgName={org.name} status={org.status} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-extrabold">{city.name}</h2>
        <Badge tone={statusTone(c.status)}>{humanStatus(c.status)}</Badge>
        {c.status === "approved" && (
          <Link href={`/city/${c.slug}`} className="text-sm font-bold text-orange-deep hover:underline">
            View public town →
          </Link>
        )}
        {(c.status === "draft" || c.status === "rejected") && <ActionButton path={`/api/causes/${c.id}`} body={{ action: "submit" }} label="Submit for review" variant="primary" />}
      </div>
      {c.reviewNote && (
        <div className="mb-6">
          <Notice tone="berry" title="Note from Hugshire review">
            {c.reviewNote}
          </Notice>
        </div>
      )}
      {c.status === "approved" && (
        <div className="mb-6">
          <Notice tone="sky">Changing the title, summary or category of a live cause sends it back for a quick review.</Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <h3 className="font-extrabold">Cause details</h3>
          <div className="mt-4">
            <ApiForm
              path={`/api/causes/${c.id}`}
              method="PATCH"
              submitLabel="Save changes"
              fields={[
                { name: "cityName", label: "Town name", defaultValue: city.name, maxLength: 40 },
                { name: "title", label: "Cause title", defaultValue: c.title, maxLength: 80 },
                { name: "summary", label: "One-line summary", defaultValue: c.summary, maxLength: 200 },
                { name: "category", label: "Category", type: "select", options: CATEGORY_OPTIONS, defaultValue: c.category },
                { name: "description", label: "Full description", type: "textarea", defaultValue: c.description, maxLength: 5000 },
                { name: "goalUsd", label: "Symbolic goal (USD of yield)", type: "number", defaultValue: String(c.goalMicro / 1_000_000n) },
              ]}
            />
          </div>
        </Card>
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="font-extrabold">Town progress</h3>
            <div className="mt-1 text-sm text-ink-soft">
              {st.name} · <span className="num">{formatUsd(s.paidMicro, { precise: true })}</span> received, {s.helpers} helpers
            </div>
            <div className="mt-4">
              <StageBar index={st.index} progressBps={st.progressBps} />
            </div>
          </Card>
          <Card className="p-6">
            <h3 className="mb-3 font-extrabold">Cover image</h3>
            <CoverUpload causeId={c.id} current={c.coverImageUrl} />
          </Card>
          <Card className="p-6">
            <h3 className="font-extrabold">Post an update</h3>
            <p className="mt-1 text-xs text-ink-soft">Updates show as &ldquo;from the organisation&rdquo;. Hugshire can mark one as verified real-world progress after checking evidence.</p>
            <div className="mt-4">
              <ApiForm
                path={`/api/causes/${c.id}`}
                extra={{ action: "update" }}
                submitLabel="Publish update"
                successText="Published."
                fields={[
                  { name: "title", label: "Title", required: true, maxLength: 120 },
                  { name: "body", label: "What happened?", type: "textarea", required: true, maxLength: 4000 },
                ]}
              />
            </div>
            <ul className="mt-6 space-y-3">
              {updates.map((u) => (
                <li key={u.id} className="text-sm">
                  <div className="flex items-center gap-2 font-semibold">
                    {u.title} {u.kind === "verified_progress" && <Badge tone="leaf">Verified</Badge>}
                  </div>
                  <div className="text-xs text-ink-soft">{u.createdAt.toLocaleDateString("en-US")}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
