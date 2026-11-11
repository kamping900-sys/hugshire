import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { formatUsd } from "@/lib/money";
import { adRevenueReports, poolCycles, poolPayouts, treasuryProposals, causes } from "@/server/db/schema";
import { defaultCtx } from "@/server/services/context";
import { poolOverview } from "@/server/services/pool";
import { openReports } from "@/server/services/stories";
import { Badge, Card, Notice } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { ApiForm } from "@/components/ApiForm";

export const metadata: Metadata = { title: "Admin · Community Heart Pool" };

const NEXT: Record<string, { action: string; label: string; extra?: Record<string, unknown> } | null> = {
  revenue_reported: { action: "finalize", label: "Finalize revenue" },
  revenue_finalized: { action: "transfer", label: "Record budget transfer" },
  budget_transferred: { action: "fund", label: "Confirm treasury funded" },
  treasury_funded: { action: "snapshot", label: "Finalize eligibility snapshot" },
  snapshot_finalized: { action: "allocate", label: "Calculate equal allocations" },
  allocations_calculated: null,
  choosing: { action: "prepare", label: "Close choices & prepare payouts" },
  payouts_prepared: { action: "propose", label: "Create treasury proposals" },
  awaiting_approval: { action: "sync", label: "Sync proposal status" },
  executed: { action: "reconcile", label: "Reconcile" },
  reconciled: null,
};

export default async function AdminPool() {
  const ctx = await defaultCtx();
  const o = await poolOverview(ctx);
  const ids = o.cycles.map((c) => c.id);
  const reports = ids.length ? await ctx.db.select().from(adRevenueReports).where(inArray(adRevenueReports.cycleId, ids)).orderBy(desc(adRevenueReports.createdAt)) : [];
  const payouts = ids.length ? await ctx.db.select({ p: poolPayouts, title: causes.title }).from(poolPayouts).innerJoin(causes, eq(causes.id, poolPayouts.causeId)).where(inArray(poolPayouts.cycleId, ids)) : [];
  const proposals = await ctx.db.select().from(treasuryProposals).where(eq(treasuryProposals.environment, ctx.environment)).orderBy(desc(treasuryProposals.createdAt)).limit(50);
  const reportsOpen = await openReports(ctx);
  const sandbox = ctx.environment === "sandbox";
  const period = new Date().toISOString().slice(0, 7);
  void poolCycles;

  return (
    <div className="space-y-6">
      <Notice tone="sky" title="Community Heart Pool">
        A separate charitable treasury funded only by <b>finalized, received</b> advertising revenue × the published charity share. It never touches
        supporters&apos; principal or vault yield. Every step below is audit-logged and the cycle cannot skip a step.{" "}
        {sandbox && <b>Sandbox: revenue is simulated and the treasury holds test assets only. </b>}
        <Link href="/pool" className="font-bold underline">Public page</Link>
      </Notice>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6">
          <div className="font-extrabold">Charity share</div>
          <div className="num mt-1 text-3xl font-extrabold">{o.charityBps ? `${(o.charityBps / 100).toFixed(2)}%` : "not set"}</div>
          <p className="mt-1 text-xs text-ink-soft">Shown publicly. Finalization is refused until it is set.</p>
          <div className="mt-3">
            <ApiForm path="/api/admin/pool" extra={{ action: "set_share" }} submitLabel="Save share" fields={[{ name: "bps", label: "Basis points (e.g. 5000 = 50%)", type: "number", required: true, defaultValue: String(o.charityBps || "") }]} />
          </div>
        </Card>
        <Card className="p-6">
          <div className="font-extrabold">Treasury</div>
          <div className="mt-1 text-sm">{o.treasury.account}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={o.treasury.decentralized ? "leaf" : "berry"}>{o.treasury.decentralized ? "Sputnik DAO (multisig)" : "Sandbox DAO stand-in (not decentralized)"}</Badge>
          </div>
          <div className="mt-2 text-xs text-ink-soft">
            Balance: <span className="num font-bold">{o.treasury.balanceMicro !== null ? formatUsd(o.treasury.balanceMicro, { precise: true }) : "unknown"}</span>
            <br />
            Council: {o.treasury.council.join(", ") || "none"} {o.treasury.threshold ? `· ${o.treasury.threshold} approvals needed` : ""}
          </div>
          <p className="mt-2 text-xs text-ink-soft">{o.treasury.notes}</p>
        </Card>
        <Card className="p-6">
          <div className="font-extrabold">Record ad revenue</div>
          <p className="mt-1 text-xs text-ink-soft">Use provider statements only. Estimated earnings never count. {sandbox ? "In sandbox, choose “simulated”." : "Simulated revenue is refused in live mode."}</p>
          <div className="mt-3">
            <ApiForm
              path="/api/admin/pool"
              extra={{ action: "report" }}
              submitLabel="Record"
              fields={[
                { name: "period", label: "Month (YYYY-MM)", required: true, defaultValue: period, maxLength: 7 },
                { name: "source", label: "Source", type: "select", defaultValue: sandbox ? "simulated" : "provider_statement", options: [{ value: "simulated", label: "Simulated (demo only)" }, { value: "provider_statement", label: "Provider statement" }] },
                { name: "provider", label: "Provider", required: true, defaultValue: sandbox ? "simulated" : "", maxLength: 40 },
                { name: "externalRef", label: "Statement / reference id", required: true, maxLength: 80 },
                { name: "grossUsd", label: "Gross revenue (USD)", required: true, maxLength: 14 },
              ]}
            />
          </div>
        </Card>
      </div>

      {o.cycles.map((c) => {
        const next = NEXT[c.status];
        const rs = reports.filter((r) => r.cycleId === c.id);
        const ps = payouts.filter((p) => p.p.cycleId === c.id);
        return (
          <Card key={c.id} className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-lg font-extrabold">{c.period}</div>
              <Badge tone="sky">{c.status.replaceAll("_", " ")}</Badge>
              {c.simulated && <Badge tone="berry">SIMULATED</Badge>}
              <Link href={`/api/pool/cycles/${c.id}`} className="text-xs font-bold text-orange-deep underline">public audit JSON</Link>
              <div className="ml-auto flex gap-2">
                {next && <ActionButton path="/api/admin/pool" body={{ action: next.action, cycleId: c.id, ...(next.action === "prepare" && sandbox ? { force: true } : {}) }} label={next.action === "prepare" && sandbox ? `${next.label} (sandbox: now)` : next.label} variant="primary" sz="sm" />}
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
              <div>Revenue: <b className="num">{formatUsd(c.revenueFinalizedMicro, { precise: true })}</b></div>
              <div>Budget ({(c.charityBps / 100).toFixed(2)}%): <b className="num">{formatUsd(c.charityBudgetMicro, { precise: true })}</b> + carry <b className="num">{formatUsd(c.carryInMicro, { precise: true })}</b></div>
              <div>Eligible trees: <b>{c.eligibleCount}</b></div>
              <div>Each: <b className="num">{formatUsd(c.perTreeMicro, { precise: true })}</b> · remainder <b className="num">{formatUsd(c.remainderMicro, { precise: true })}</b></div>
            </div>
            {c.snapshotHash && <div className="mt-1 break-all text-xs text-ink-soft">Snapshot hash: {c.snapshotHash}</div>}
            {rs.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {rs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.source === "simulated" ? "berry" : "leaf"}>{r.source}</Badge>
                    {r.provider} · {r.externalRef} · <span className="num">{formatUsd(r.grossMicro, { precise: true })}</span> · {r.status}
                    {r.receivedAt ? <span className="text-xs text-ink-soft">received {r.receivedAt.toLocaleDateString("en-US")}</span> : r.status === "reported" && <ActionButton path="/api/admin/pool" body={{ action: "received", reportId: r.id }} label="Mark received" sz="sm" variant="soft" />}
                  </li>
                ))}
              </ul>
            )}
            {ps.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {ps.map(({ p, title }) => {
                  const prop = proposals.find((x) => x.id === p.proposalId);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-2">
                      <b>{title}</b> → {p.destinationAccount} · <span className="num">{formatUsd(p.amountMicro, { precise: true })}</span> · <Badge tone={p.status === "executed" ? "leaf" : "sky"}>{p.status}</Badge>
                      {prop && <span className="text-xs text-ink-soft">approvals {prop.approvals.length}/{prop.threshold} ({prop.approvals.map((a) => a.member).join(", ") || "none"})</span>}
                      {prop && prop.status === "in_progress" && sandbox && <ActionButton path="/api/admin/pool" body={{ action: "approve", proposalId: prop.id }} label="Approve (council)" sz="sm" variant="soft" />}
                      {(p.status === "failed" || p.status === "rejected") && <ActionButton path="/api/admin/pool" body={{ action: "repropose", payoutId: p.id }} label="Re-propose" sz="sm" variant="soft" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}

      <Card className="p-6">
        <div className="font-extrabold">Notice Board reports</div>
        {!reportsOpen.length && <p className="mt-2 text-sm text-ink-soft">No open reports.</p>}
        <ul className="mt-3 space-y-2 text-sm">
          {reportsOpen.map((r) => (
            <li key={r.r.id} className="flex flex-wrap items-center gap-2">
              <b>{r.title}</b> · “{r.r.reason}” · {r.visibility}
              <ActionButton path="/api/admin/stories" body={{ updateId: r.r.updateId, visibility: "hidden" }} askReason label="Hide post" sz="sm" variant="danger" />
              <ActionButton path="/api/admin/stories" body={{ updateId: r.r.updateId, visibility: "published" }} askReason label="Keep (dismiss)" sz="sm" variant="soft" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
