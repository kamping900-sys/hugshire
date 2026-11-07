import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { formatUsd } from "@/lib/money";
import { bridgeTransactions, deposits, ledgerEntries, ledgerJournals, users, withdrawals, webhookEvents } from "@/server/db/schema";
import { defaultCtx } from "@/server/services/context";
import { Badge, Card, humanStatus, statusTone } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";

export const metadata: Metadata = { title: "Admin · Transactions" };

export default async function AdminTx({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const { user } = await searchParams;
  const ctx = await defaultCtx();
  const byUser = user && /^[0-9a-f-]{36}$/.test(user) ? user : null;
  const [u] = byUser ? await ctx.db.select().from(users).where(eq(users.id, byUser)) : [];
  const deps = await ctx.db
    .select({ d: deposits, email: users.email })
    .from(deposits)
    .innerJoin(users, eq(users.id, deposits.userId))
    .where(byUser ? eq(deposits.userId, byUser) : undefined)
    .orderBy(desc(deposits.createdAt))
    .limit(50);
  const wds = await ctx.db
    .select({ w: withdrawals, email: users.email })
    .from(withdrawals)
    .innerJoin(users, eq(users.id, withdrawals.userId))
    .where(byUser ? eq(withdrawals.userId, byUser) : undefined)
    .orderBy(desc(withdrawals.createdAt))
    .limit(50);
  const bridges = await ctx.db.select().from(bridgeTransactions).orderBy(desc(bridgeTransactions.createdAt)).limit(20);
  const journals = await ctx.db.select().from(ledgerJournals).orderBy(desc(ledgerJournals.createdAt)).limit(25);
  const entries = journals.length ? await ctx.db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.createdAt)).limit(150) : [];
  const hooks = await ctx.db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(10);
  const tx = (h: string | null) => (!h ? "—" : h.startsWith("sandbox-") ? "test" : <a className="text-orange-deep hover:underline" target="_blank" rel="noopener noreferrer" href={`https://nearblocks.io/txns/${h}`}>{h.slice(0, 10)}…</a>);

  return (
    <div className="space-y-6">
      {u && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="font-bold">{u.email}</div>
            <div className="text-xs text-ink-soft">
              {u.id} · {u.role} · <Badge tone={statusTone(u.status === "active" ? "approved" : "suspended")}>{u.status}</Badge>
            </div>
          </div>
          {u.role !== "admin" && (
            <ActionButton
              path="/api/admin"
              body={{ action: "user.status", id: u.id, status: u.status === "active" ? "suspended" : "active" }}
              label={u.status === "active" ? "Suspend user" : "Reactivate user"}
              variant={u.status === "active" ? "danger" : "secondary"}
              askReason
            />
          )}
        </Card>
      )}
      <Card className="overflow-x-auto p-2">
        <div className="px-3 pt-3 font-bold">Deposits</div>
        <table className="table-x">
          <thead>
            <tr>
              <th>Created</th>
              <th>User</th>
              <th>Requested</th>
              <th>Principal</th>
              <th>Fees</th>
              <th>Status</th>
              <th>Vault tx</th>
            </tr>
          </thead>
          <tbody>
            {deps.map(({ d, email }) => (
              <tr key={d.id}>
                <td className="whitespace-nowrap">{d.createdAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{email}</td>
                <td className="num">{formatUsd(d.requestedMicro)}</td>
                <td className="num">{d.principalMicro !== null ? formatUsd(d.principalMicro) : "—"}</td>
                <td className="num">{formatUsd(d.feesMicro)}</td>
                <td>
                  <Badge tone={statusTone(d.status)}>{humanStatus(d.status)}</Badge>
                  {d.failureReason && <div className="text-xs text-berry">{d.failureReason}</div>}
                </td>
                <td className="font-mono text-xs">{tx(d.vaultTxHash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="overflow-x-auto p-2">
        <div className="px-3 pt-3 font-bold">Withdrawals</div>
        <table className="table-x">
          <thead>
            <tr>
              <th>Created</th>
              <th>User</th>
              <th>Requested</th>
              <th>Redeemed</th>
              <th>Received</th>
              <th>Status</th>
              <th>Vault tx</th>
            </tr>
          </thead>
          <tbody>
            {wds.map(({ w, email }) => (
              <tr key={w.id}>
                <td className="whitespace-nowrap">{w.createdAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{email}</td>
                <td className="num">{formatUsd(w.requestedMicro)}</td>
                <td className="num">{w.redeemedMicro !== null ? formatUsd(w.redeemedMicro) : "—"}</td>
                <td className="num">{w.receivedMicro !== null ? formatUsd(w.receivedMicro) : "—"}</td>
                <td>
                  <Badge tone={statusTone(w.status)}>{humanStatus(w.status)}</Badge>
                </td>
                <td className="font-mono text-xs">{tx(w.vaultTxHash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-x-auto p-2">
          <div className="px-3 pt-3 font-bold">Ledger (latest entries)</div>
          <table className="table-x">
            <thead>
              <tr>
                <th>Journal</th>
                <th>Account</th>
                <th className="text-right">Debit / credit</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 60).map((x) => {
                const j = journals.find((jj) => jj.id === x.journalId);
                return (
                  <tr key={x.id}>
                    <td className="text-xs">{j?.kind ?? x.journalId.slice(0, 8)}</td>
                    <td className="font-mono text-xs">{x.account.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => m.slice(0, 8))}</td>
                    <td className={`num text-right text-xs ${x.amountMicro > 0n ? "" : "text-ink-soft"}`}>{formatUsd(x.amountMicro, { precise: true, sign: true })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <div className="space-y-6">
          <Card className="overflow-x-auto p-2">
            <div className="px-3 pt-3 font-bold">Bridge legs</div>
            <table className="table-x">
              <tbody>
                {bridges.map((b) => (
                  <tr key={b.id}>
                    <td className="text-xs">{b.direction}</td>
                    <td className="text-xs">{b.provider}</td>
                    <td className="num text-xs">{formatUsd(b.amountInMicro)} → {b.amountOutMicro !== null ? formatUsd(b.amountOutMicro) : "?"}</td>
                    <td>
                      <Badge tone={b.status === "SUCCESS" ? "leaf" : "butter"}>{b.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card className="p-5">
            <div className="font-bold">Webhooks</div>
            <ul className="mt-2 space-y-1 text-xs">
              {hooks.map((h) => (
                <li key={h.id}>
                  {h.receivedAt.toLocaleString("en-US")} · {h.provider} · {h.eventType} · {h.processedAt ? "processed" : h.error ? `error: ${h.error}` : "pending"}
                </li>
              ))}
              {!hooks.length && <li className="text-ink-soft">None received.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
