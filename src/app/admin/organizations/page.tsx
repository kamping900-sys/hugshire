import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { organizationMembers, organizations, users } from "@/server/db/schema";
import { defaultCtx } from "@/server/services/context";
import { Badge, Card, humanStatus, statusTone } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";

export const metadata: Metadata = { title: "Admin · Organizations" };

export default async function AdminOrgs() {
  const ctx = await defaultCtx();
  const list = await ctx.db.select().from(organizations).orderBy(desc(organizations.createdAt));
  const owners = await ctx.db.select({ orgId: organizationMembers.orgId, email: users.email }).from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId)).where(eq(organizationMembers.role, "owner"));
  const ownerOf = new Map(owners.map((o) => [o.orgId, o.email]));
  return (
    <div className="space-y-4">
      {list.map((o) => (
        <Card key={o.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-extrabold">{o.name}</span>
                <Badge tone={statusTone(o.status)}>{humanStatus(o.status)}</Badge>
                {o.isSample && <Badge tone="ink">Sample</Badge>}
              </div>
              <div className="mt-1 text-sm text-ink-soft">
                {o.contactEmail} · owner {ownerOf.get(o.id) ?? "—"} · {o.country} · EIN {o.taxId || "—"}
              </div>
              {o.website && (
                <a href={o.website} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-orange-deep hover:underline">
                  {o.website}
                </a>
              )}
              <p className="mt-2 max-w-2xl text-sm text-ink-soft">{o.description}</p>
              <div className="mt-3 text-sm">
                Receiving account: <span className="font-mono text-xs">{o.payoutNearAccount ?? "not set"}</span>{" "}
                {o.payoutNearAccount && (o.payoutVerifiedAt ? <Badge tone="leaf">verified</Badge> : <Badge tone="butter">unverified</Badge>)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {o.status !== "approved" && <ActionButton path="/api/admin" body={{ action: "org.decide", id: o.id, decision: "approved" }} label="Approve" variant="primary" askReason />}
              {o.status === "pending" && <ActionButton path="/api/admin" body={{ action: "org.decide", id: o.id, decision: "rejected" }} label="Reject" askReason />}
              {o.status === "approved" && <ActionButton path="/api/admin" body={{ action: "org.decide", id: o.id, decision: "suspended" }} label="Suspend" variant="danger" askReason confirm="Suspend this organisation and all its causes?" />}
              {o.status === "approved" && o.payoutNearAccount && !o.payoutVerifiedAt && (
                <ActionButton
                  path="/api/admin"
                  body={{ action: "org.verify_payout", id: o.id, confirmAllowlisted: true }}
                  label="Verify receiving account"
                  askReason
                  confirm={`Confirm: you verified ${o.payoutNearAccount} belongs to ${o.name} (contacted them out of band), AND in live mode the Vault owner has called add_recipient for it.`}
                />
              )}
            </div>
          </div>
        </Card>
      ))}
      {!list.length && <p className="text-sm text-ink-soft">No organisations yet.</p>}
    </div>
  );
}
