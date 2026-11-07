import { sql } from "drizzle-orm";
import { accountSum, acct, raiseAlert, resolveAlertsByKey, rows } from "../core";
import type { Ctx } from "./context";

export type ReconCheck = { key: string; ok: boolean; detail: string };

/**
 * Compares independent sources of truth and raises an alert for every disagreement.
 * Alerts auto-resolve when the check passes again.
 */
export async function reconcile(ctx: Ctx): Promise<ReconCheck[]> {
  const e = ctx.environment;
  const checks: ReconCheck[] = [];

  // 1. Every journal balances.
  const unbalanced = rows<{ n: number }>(
    await ctx.db.execute(sql`
      select count(*)::int as n from (
        select j.id from ledger_journals j join ledger_entries x on x.journal_id = j.id
        where j.environment = ${e} group by j.id having sum(x.amount_micro) <> 0) t`),
  )[0].n;
  checks.push({ key: "journals_balanced", ok: Number(unbalanced) === 0, detail: `${unbalanced} unbalanced journals` });

  // 2. Position cache equals ledger.
  const drift = rows<{ n: number }>(
    await ctx.db.execute(sql`
      select count(*)::int as n from support_positions p
      where p.environment = ${e} and (
        p.principal_micro <> coalesce((select -sum(x.amount_micro) from ledger_entries x join ledger_journals j on j.id = x.journal_id
                                       where j.environment = ${e} and x.account = 'user:' || p.user_id || ':principal'), 0)
        or p.withdrawing_micro <> coalesce((select -sum(x.amount_micro) from ledger_entries x join ledger_journals j on j.id = x.journal_id
                                       where j.environment = ${e} and x.account = 'user:' || p.user_id || ':principal_withdrawing'), 0))`),
  )[0].n;
  checks.push({ key: "positions_match_ledger", ok: Number(drift) === 0, detail: `${drift} positions drift from the ledger` });

  // 3. Unconsumed yield allocations equal user yield_available balances.
  const r3 = rows<{ alloc: string; ledger: string }>(
    await ctx.db.execute(sql`
      select
        (select coalesce(sum(a.amount_micro - a.consumed_micro),0) from yield_allocations a join yield_snapshots s on s.id = a.snapshot_id where s.environment = ${e})::text as alloc,
        (select coalesce(-sum(x.amount_micro),0) from ledger_entries x join ledger_journals j on j.id = x.journal_id
          where j.environment = ${e} and x.account like 'user:%:yield_available')::text as ledger`),
  )[0];
  checks.push({ key: "yield_allocations_match_ledger", ok: r3.alloc === r3.ledger, detail: `allocations ${r3.alloc} vs ledger ${r3.ledger}` });

  // 4. Pending + queued deliveries equal cause yield_pending balances.
  const r4 = rows<{ d: string; ledger: string }>(
    await ctx.db.execute(sql`
      select
        (select coalesce(sum(amount_micro),0) from deliveries where environment = ${e} and status in ('pending','queued'))::text as d,
        (select coalesce(-sum(x.amount_micro),0) from ledger_entries x join ledger_journals j on j.id = x.journal_id
          where j.environment = ${e} and x.account like 'cause:%:yield_pending')::text as ledger`),
  )[0];
  checks.push({ key: "deliveries_match_ledger", ok: r4.d === r4.ledger, detail: `deliveries ${r4.d} vs ledger ${r4.ledger}` });

  // 5. Observed pool value is not below the ledger's pool value.
  const obs = await ctx.p.lending.observe(ctx.now());
  const booked = await accountSum(ctx.db, e, acct.poolLending);
  checks.push({
    key: "pool_not_below_ledger",
    ok: obs.assetsMicro >= booked,
    detail: `observed ${obs.assetsMicro} vs booked ${booked} (${obs.source})`,
  });

  // 6. Live: the Vault's own principal total equals the ledger's principal owed.
  if (e === "live") {
    const owed = rows<{ s: string }>(
      await ctx.db.execute(sql`
        select coalesce(-sum(x.amount_micro),0)::text as s from ledger_entries x join ledger_journals j on j.id = x.journal_id
        where j.environment = 'live' and (x.account like 'user:%:principal' or x.account like 'user:%:principal_withdrawing')`),
    )[0].s;
    checks.push({ key: "vault_principal_matches", ok: BigInt(owed) === obs.onchainPrincipalMicro, detail: `ledger ${owed} vs vault ${obs.onchainPrincipalMicro}` });
  }

  // 7. Nothing is stuck.
  const stuck = rows<{ deposits: number; withdrawals: number; payouts: number }>(
    await ctx.db.execute(sql`
      select
        (select count(*)::int from deposits where environment = ${e} and status in ('onramp_completed','bridging','bridged','vault_pending') and updated_at < ${ctx.now().toISOString()}::timestamptz - interval '2 hours') as deposits,
        (select count(*)::int from withdrawals where environment = ${e} and status not in ('completed','failed') and updated_at < ${ctx.now().toISOString()}::timestamptz - interval '48 hours') as withdrawals,
        (select count(*)::int from charity_payouts where environment = ${e} and status = 'submitted' and submitted_at < ${ctx.now().toISOString()}::timestamptz - interval '1 hour') as payouts`),
  )[0];
  const nStuck = Number(stuck.deposits) + Number(stuck.withdrawals) + Number(stuck.payouts);
  checks.push({ key: "nothing_stuck", ok: nStuck === 0, detail: `deposits ${stuck.deposits}, withdrawals ${stuck.withdrawals}, payouts ${stuck.payouts}` });

  for (const c of checks) {
    const dedupeKey = `recon:${e}:${c.key}`;
    if (c.ok) await resolveAlertsByKey(ctx.db, dedupeKey);
    else
      await raiseAlert(ctx.db, {
        severity: c.key === "nothing_stuck" ? "warning" : "critical",
        code: `reconciliation_${c.key}`,
        message: `Reconciliation failed: ${c.key} (${c.detail})`,
        dedupeKey,
      });
  }
  return checks;
}
