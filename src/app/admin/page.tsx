import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { formatUsd, wadToPercentString } from "@/lib/money";
import { causes, charityPayouts, deposits, lendingPositions, organizations, systemAlerts, users, withdrawals } from "@/server/db/schema";
import { accountSum, acct, rows } from "@/server/core";
import { defaultCtx } from "@/server/services/context";
import { Badge, Card, humanStatus, Stat, statusTone } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await defaultCtx();
  const e = ctx.environment;
  const pool = await accountSum(ctx.db, e, acct.poolLending);
  const [lp] = await ctx.db.select().from(lendingPositions).where(eq(lendingPositions.environment, e));
  const agg = rows<{ principal: string; yield_avail: string; pending: string; users: number }>(
    await ctx.db.execute(sql`
      select
        coalesce((select -sum(x.amount_micro) from ledger_entries x join ledger_journals j on j.id=x.journal_id where j.environment=${e} and x.account like 'user:%:principal'),0)::text as principal,
        coalesce((select -sum(x.amount_micro) from ledger_entries x join ledger_journals j on j.id=x.journal_id where j.environment=${e} and x.account like 'user:%:yield_available'),0)::text as yield_avail,
        coalesce((select -sum(x.amount_micro) from ledger_entries x join ledger_journals j on j.id=x.journal_id where j.environment=${e} and x.account like 'cause:%:yield_pending'),0)::text as pending,
        (select count(*)::int from users) as users`),
  )[0];
  const paid = await ctx.db.select({ s: sql<string>`coalesce(sum(${charityPayouts.amountMicro}),0)::text` }).from(charityPayouts).where(and(eq(charityPayouts.environment, e), eq(charityPayouts.status, "confirmed")));
  const pendingOrgs = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(organizations).where(eq(organizations.status, "pending"));
  const pendingCauses = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(causes).where(eq(causes.status, "pending_review"));
  const alerts = await ctx.db.select().from(systemAlerts).where(isNull(systemAlerts.resolvedAt)).orderBy(desc(systemAlerts.createdAt)).limit(10);

  let results: { type: string; id: string; label: string; href: string; status?: string }[] = [];
  if (q && q.trim().length >= 2) {
    const s = `%${q.trim()}%`;
    const us = await ctx.db.select().from(users).where(or(ilike(users.email, s), sql`${users.id}::text = ${q.trim()}`)).limit(10);
    const os = await ctx.db.select().from(organizations).where(or(ilike(organizations.name, s), ilike(organizations.payoutNearAccount, s))).limit(10);
    const cs = await ctx.db.select().from(causes).where(or(ilike(causes.title, s), ilike(causes.slug, s))).limit(10);
    const ds = await ctx.db.select().from(deposits).where(or(sql`${deposits.id}::text = ${q.trim()}`, ilike(deposits.vaultTxHash, s))).limit(10);
    const ws = await ctx.db.select().from(withdrawals).where(or(sql`${withdrawals.id}::text = ${q.trim()}`, ilike(withdrawals.vaultTxHash, s))).limit(10);
    const ps = await ctx.db.select().from(charityPayouts).where(or(sql`${charityPayouts.id}::text = ${q.trim()}`, ilike(charityPayouts.txHash, s))).limit(10);
    results = [
      ...us.map((u) => ({ type: "User", id: u.id, label: u.email, href: `/admin/transactions?user=${u.id}`, status: u.status })),
      ...os.map((o) => ({ type: "Organization", id: o.id, label: o.name, href: `/admin/organizations`, status: o.status })),
      ...cs.map((c) => ({ type: "Cause", id: c.id, label: c.title, href: `/admin/causes`, status: c.status })),
      ...ds.map((d) => ({ type: "Deposit", id: d.id, label: formatUsd(d.requestedMicro), href: `/admin/transactions?user=${d.userId}`, status: d.status })),
      ...ws.map((w) => ({ type: "Withdrawal", id: w.id, label: formatUsd(w.requestedMicro), href: `/admin/transactions?user=${w.userId}`, status: w.status })),
      ...ps.map((p) => ({ type: "Payout", id: p.id, label: formatUsd(p.amountMicro, { precise: true }), href: `/admin/payouts`, status: p.status })),
    ];
  }

  return (
    <div className="space-y-6">
      {q && (
        <Card className="p-5">
          <div className="font-bold">Search results for “{q}”</div>
          {results.length === 0 && <p className="mt-2 text-sm text-ink-soft">Nothing found.</p>}
          <ul className="mt-3 divide-y divide-line-soft text-sm">
            {results.map((r) => (
              <li key={r.type + r.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <Badge tone="ink">{r.type}</Badge> <Link href={r.href} className="font-semibold hover:underline">{r.label}</Link> <span className="font-mono text-xs text-ink-soft">{r.id.slice(0, 8)}</span>
                </span>
                {r.status && <Badge tone={statusTone(r.status)}>{humanStatus(r.status)}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pool (ledger)" value={formatUsd(pool)} hint={lp ? `Observed ${formatUsd(lp.observedAssetsMicro)} · APR ${wadToPercentString(BigInt(lp.supplyAprWad))}` : "Not observed yet"} />
        <Stat label="Supporter principal" value={formatUsd(BigInt(agg.principal))} hint={`${agg.users} users`} />
        <Stat label="Yield awaiting delivery" value={formatUsd(BigInt(agg.yield_avail), { precise: true })} hint={`${formatUsd(BigInt(agg.pending), { precise: true })} assigned, unpaid`} />
        <Stat label="Yield paid to causes" tone="orange" value={formatUsd(BigInt(paid[0].s), { precise: true })} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card className="p-6">
          <div className="font-bold">Waiting for you</div>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between">
              <Link href="/admin/organizations" className="hover:underline">Organizations to review</Link>
              <b className="num">{pendingOrgs[0].n}</b>
            </li>
            <li className="flex justify-between">
              <Link href="/admin/causes" className="hover:underline">Causes to review</Link>
              <b className="num">{pendingCauses[0].n}</b>
            </li>
          </ul>
        </Card>
        <Card className="p-6">
          <div className="font-bold">Open alerts</div>
          {alerts.length === 0 && <p className="mt-2 text-sm text-ink-soft">All clear.</p>}
          <ul className="mt-3 space-y-3">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <Badge tone={a.severity === "critical" ? "berry" : a.severity === "warning" ? "butter" : "sky"}>{a.severity}</Badge> <span className="font-semibold">{a.code}</span>
                  <div className="text-ink-soft">{a.message}</div>
                </div>
                <ActionButton path="/api/admin" body={{ action: "alert.resolve", id: a.id }} label="Resolve" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
