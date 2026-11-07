import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { causes, causeUpdates, cities, organizations } from "@/server/db/schema";
import { defaultCtx } from "@/server/services/context";
import { Badge, Card, humanStatus, statusTone } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";

export const metadata: Metadata = { title: "Admin · Causes" };

export default async function AdminCauses() {
  const ctx = await defaultCtx();
  const list = await ctx.db
    .select({ c: causes, city: cities, org: organizations })
    .from(causes)
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .innerJoin(organizations, eq(organizations.id, causes.orgId))
    .orderBy(desc(causes.updatedAt));
  const updates = await ctx.db.select({ u: causeUpdates, title: causes.title }).from(causeUpdates).innerJoin(causes, eq(causes.id, causeUpdates.causeId)).where(eq(causeUpdates.kind, "note")).orderBy(desc(causeUpdates.createdAt)).limit(20);
  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-4">
        {list.map(({ c, city, org }) => (
          <Card key={c.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-extrabold">{city.name}</span>
                  <Badge tone={statusTone(c.status)}>{humanStatus(c.status)}</Badge>
                  {c.payoutReadyAt ? <Badge tone="leaf">payout ready</Badge> : <Badge tone="ink">payout not ready</Badge>}
                </div>
                <div className="text-sm font-semibold">{c.title}</div>
                <div className="text-sm text-ink-soft">
                  {org.name} ({humanStatus(org.status)}) · {c.category}
                </div>
                <p className="mt-2 text-sm text-ink-soft">{c.summary}</p>
                {c.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-ink-soft">{c.description}</p>}
                <Link href={`/city/${c.slug}`} className="mt-2 inline-block text-xs font-bold text-orange-deep hover:underline">
                  Preview town
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.status !== "approved" && c.status !== "draft" && <ActionButton path="/api/admin" body={{ action: "cause.decide", id: c.id, decision: "approved" }} label="Approve" variant="primary" askReason />}
                {c.status === "pending_review" && <ActionButton path="/api/admin" body={{ action: "cause.decide", id: c.id, decision: "rejected" }} label="Reject" askReason />}
                {c.status === "approved" && <ActionButton path="/api/admin" body={{ action: "cause.decide", id: c.id, decision: "suspended" }} label="Suspend" variant="danger" askReason confirm="Suspend this cause? Deliveries to it will be refused." />}
              </div>
            </div>
          </Card>
        ))}
        {!list.length && <p className="text-sm text-ink-soft">No causes yet.</p>}
      </div>
      <Card className="h-fit p-5">
        <div className="font-bold">Updates to verify</div>
        <p className="mt-1 text-xs text-ink-soft">Mark an update as verified real-world progress only after checking evidence (photos, receipts, a call).</p>
        <ul className="mt-3 space-y-4">
          {updates.map(({ u, title }) => (
            <li key={u.id} className="text-sm">
              <div className="font-semibold">{u.title}</div>
              <div className="text-xs text-ink-soft">{title}</div>
              <p className="mt-1 line-clamp-3 text-xs text-ink-soft">{u.body}</p>
              <div className="mt-2">
                <ActionButton path="/api/admin" body={{ action: "update.verify", id: u.id }} label="Mark verified" confirm="You checked real-world evidence for this update?" />
              </div>
            </li>
          ))}
          {!updates.length && <li className="text-sm text-ink-soft">Nothing to verify.</li>}
        </ul>
      </Card>
    </div>
  );
}
