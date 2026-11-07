import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { formatUsd } from "@/lib/money";
import { causes, charityPayouts } from "@/server/db/schema";
import { defaultCtx } from "@/server/services/context";
import { Badge, Card, humanStatus, statusTone } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";

export const metadata: Metadata = { title: "Admin · Payouts" };

export default async function AdminPayouts() {
  const ctx = await defaultCtx();
  const list = await ctx.db.select({ p: charityPayouts, title: causes.title }).from(charityPayouts).innerJoin(causes, eq(causes.id, charityPayouts.causeId)).orderBy(desc(charityPayouts.createdAt)).limit(200);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <ActionButton path="/api/admin" body={{ action: "job.run", name: "batch_payouts" }} label="Batch payouts now" />
        <ActionButton path="/api/admin" body={{ action: "job.run", name: "submit_payouts" }} label="Submit created payouts" />
        <ActionButton path="/api/admin" body={{ action: "job.run", name: "confirm_payouts" }} label="Confirm submitted payouts" />
      </div>
      <Card className="overflow-x-auto p-2">
        <table className="table-x">
          <thead>
            <tr>
              <th>Created</th>
              <th>Cause</th>
              <th>Destination</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Tx</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map(({ p, title }) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{p.createdAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{title}</td>
                <td className="font-mono text-xs">{p.destinationAccount}</td>
                <td className="num font-bold">{formatUsd(p.amountMicro, { precise: true })}</td>
                <td>
                  <Badge tone={statusTone(p.status)}>{humanStatus(p.status)}</Badge>
                  {p.failureReason && <div className="max-w-xs text-xs text-berry">{p.failureReason}</div>}
                </td>
                <td className="num">{p.attempts}</td>
                <td className="font-mono text-xs">{p.txHash ? (p.txHash.startsWith("sandbox-") ? "test" : <a className="text-orange-deep hover:underline" target="_blank" rel="noopener noreferrer" href={`https://nearblocks.io/txns/${p.txHash}`}>{p.txHash.slice(0, 10)}…</a>) : "—"}</td>
                <td>{p.status === "manual_review" && <ActionButton path="/api/admin" body={{ action: "payout.release", id: p.id }} label="Release to re-batch" confirm="Only release if you confirmed on chain that this payout did NOT go through." />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="p-4 text-sm text-ink-soft">No payouts yet.</p>}
      </Card>
    </div>
  );
}
