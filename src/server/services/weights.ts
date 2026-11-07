import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { rows, type Environment } from "../core";

export type BalanceEvent = { at: Date; delta: bigint };

/**
 * ∫ balance dt over [start, end] in (micro × seconds), given the opening balance at `start`
 * and signed changes inside the window. Events outside the window are ignored.
 * Negative running balances are clamped to zero (they can't earn).
 */
export function balanceSeconds(opening: bigint, events: BalanceEvent[], start: Date, end: Date): bigint {
  if (end <= start) return 0n;
  const sorted = events
    .filter((e) => e.at > start && e.at <= end)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  let bal = opening;
  let cursor = start.getTime();
  let acc = 0n;
  for (const e of sorted) {
    const t = e.at.getTime();
    const secs = BigInt(Math.floor((t - cursor) / 1000));
    if (bal > 0n && secs > 0n) acc += bal * secs;
    // carry sub-second remainder forward by moving cursor only by whole seconds
    cursor += Number(secs) * 1000;
    bal += e.delta;
  }
  const tail = BigInt(Math.floor((end.getTime() - cursor) / 1000));
  if (bal > 0n && tail > 0n) acc += bal * tail;
  return acc;
}

/** Signed (debit-positive) sum of an account up to and including `asOf`. */
export async function accountSumAsOf(db: Db, environment: Environment, account: string, asOf: Date): Promise<bigint> {
  const r = await db.execute<{ s: string }>(sql`
    select coalesce(sum(e.amount_micro), 0)::text as s
    from ledger_entries e join ledger_journals j on j.id = e.journal_id
    where e.account = ${account} and j.environment = ${environment} and e.created_at <= ${asOf.toISOString()}`);
  return BigInt(rows<{ s: string }>(r)[0]?.s ?? "0");
}

/** Debit-positive deltas for the given accounts in (start, end]. */
export async function accountEventsBetween(
  db: Db,
  environment: Environment,
  accounts: string[],
  start: Date,
  end: Date,
): Promise<{ account: string; at: Date; delta: bigint }[]> {
  if (!accounts.length) return [];
  const r = await db.execute<{ account: string; at: string | Date; amount: string }>(sql`
    select e.account, e.created_at as at, e.amount_micro::text as amount
    from ledger_entries e join ledger_journals j on j.id = e.journal_id
    where j.environment = ${environment}
      and e.account in (${sql.join(accounts.map((a) => sql`${a}`), sql`, `)})
      and e.created_at > ${start.toISOString()} and e.created_at <= ${end.toISOString()}
    order by e.created_at asc`);
  return rows<{ account: string; at: string | Date; amount: string }>(r).map((x) => ({
    account: x.account,
    at: new Date(x.at),
    delta: BigInt(x.amount),
  }));
}

/**
 * Principal-seconds per user over [start, end] from the ledger (user:{id}:principal accounts,
 * credit-normal, so deltas are negated). Only principal that is actually supplied earns;
 * principal being withdrawn has already moved to principal_withdrawing and stops earning.
 */
export async function principalSecondsByUser(db: Db, environment: Environment, start: Date, end: Date): Promise<Map<string, bigint>> {
  const opening = await db.execute<{ account: string; s: string }>(sql`
    select e.account, (-sum(e.amount_micro))::text as s
    from ledger_entries e join ledger_journals j on j.id = e.journal_id
    where j.environment = ${environment} and e.account like 'user:%:principal' and e.created_at <= ${start.toISOString()}
    group by e.account`);
  const inWindow = await db.execute<{ account: string; at: string | Date; amount: string }>(sql`
    select e.account, e.created_at as at, (-e.amount_micro)::text as amount
    from ledger_entries e join ledger_journals j on j.id = e.journal_id
    where j.environment = ${environment} and e.account like 'user:%:principal'
      and e.created_at > ${start.toISOString()} and e.created_at <= ${end.toISOString()}`);

  const open = new Map<string, bigint>();
  for (const r of rows<{ account: string; s: string }>(opening)) open.set(r.account, BigInt(r.s));
  const evs = new Map<string, BalanceEvent[]>();
  for (const r of rows<{ account: string; at: string | Date; amount: string }>(inWindow)) {
    const list = evs.get(r.account) ?? [];
    list.push({ at: new Date(r.at), delta: BigInt(r.amount) });
    evs.set(r.account, list);
  }
  const out = new Map<string, bigint>();
  for (const account of new Set([...open.keys(), ...evs.keys()])) {
    const userId = account.split(":")[1];
    const w = balanceSeconds(open.get(account) ?? 0n, evs.get(account) ?? [], start, end);
    if (w > 0n) out.set(userId, w);
  }
  return out;
}
