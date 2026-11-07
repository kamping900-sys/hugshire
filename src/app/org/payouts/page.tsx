import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { formatUsd } from "@/lib/money";
import { causes, charityPayouts } from "@/server/db/schema";
import { Badge, Card, Empty, humanStatus, statusTone } from "@/components/ui";
import { loadOrg, OrgNav } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payouts" };

export default async function OrgPayouts() {
  const { ctx, org } = await loadOrg("/org/payouts");
  if (!org) redirect("/org");
  const rows = await ctx.db
    .select({ p: charityPayouts, title: causes.title })
    .from(charityPayouts)
    .innerJoin(causes, eq(causes.id, charityPayouts.causeId))
    .where(eq(causes.orgId, org.id))
    .orderBy(desc(charityPayouts.createdAt))
    .limit(200);
  const total = rows.filter((r) => r.p.status === "confirmed").reduce((a, r) => a + r.p.amountMicro, 0n);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <OrgNav active="/org/payouts" orgName={org.name} status={org.status} />
      <Card className="mb-6 p-6">
        <div className="text-sm font-semibold text-ink-soft">Total received</div>
        <div className="num text-3xl font-extrabold text-orange-deep">{formatUsd(total, { precise: true })}</div>
        <p className="mt-1 text-sm text-ink-soft">
          Paid in USDC to <span className="font-mono text-xs">{org.payoutNearAccount ?? "—"}</span>. Every payout is a NEAR transaction you can check independently.
        </p>
      </Card>
      {rows.length === 0 ? (
        <Empty title="No payouts yet">Payouts are sent in batches once supporters deliver at least the minimum payout amount to one of your causes.</Empty>
      ) : (
        <Card className="overflow-x-auto p-2">
          <table className="table-x">
            <thead>
              <tr>
                <th>Date</th>
                <th>Cause</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, title }) => (
                <tr key={p.id}>
                  <td>{p.createdAt.toLocaleDateString("en-US")}</td>
                  <td>{title}</td>
                  <td className="num font-bold">{formatUsd(p.amountMicro, { precise: true })}</td>
                  <td>
                    <Badge tone={statusTone(p.status)}>{humanStatus(p.status)}</Badge>
                  </td>
                  <td className="font-mono text-xs">
                    {p.txHash ? (
                      p.txHash.startsWith("sandbox-") ? (
                        "test mode"
                      ) : (
                        <a className="text-orange-deep hover:underline" href={`https://nearblocks.io/txns/${p.txHash}`} target="_blank" rel="noopener noreferrer">
                          {p.txHash.slice(0, 10)}…
                        </a>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
