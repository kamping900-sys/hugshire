import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  auditLogs,
  ledgerEntries,
  ledgerJournals,
  platformSettings,
  systemAlerts,
} from "./db/schema";

export type Environment = "sandbox" | "live";

// ───────────────────────────── errors ─────────────────────────────

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const notFound = (what = "Not found") => new AppError("not_found", what, 404);
export const forbidden = (what = "You do not have access to this") => new AppError("forbidden", what, 403);
export const paused = (what: string) => new AppError("paused", `${what} is temporarily paused by Hugshire operations.`, 423);

// ───────────────────────────── ledger ─────────────────────────────

/** Ledger account names. Liabilities are credit-normal (balance = -sum). */
export const acct = {
  userPrincipal: (u: string) => `user:${u}:principal`,
  userWithdrawing: (u: string) => `user:${u}:principal_withdrawing`,
  userYield: (u: string) => `user:${u}:yield_available`,
  causePending: (c: string) => `cause:${c}:yield_pending`,
  causePaid: (c: string) => `cause:${c}:yield_paid`,
  poolLending: "pool:lending",
  poolUnallocatedYield: "pool:unallocated_yield",
  poolShortfall: "pool:principal_shortfall",
  externalWithdrawn: "external:withdrawn",
} as const;

export type Posting = { account: string; amount: bigint };

export class UnbalancedJournalError extends Error {}

/**
 * Posts a balanced journal exactly once per (environment, kind, refType, refId).
 * Returns false (and writes nothing) when this business event was already posted.
 */
export async function postJournal(
  db: Db,
  j: {
    environment: Environment;
    kind: string;
    refType: string;
    refId: string;
    memo?: string;
    entries: Posting[];
    at?: Date;
  },
): Promise<boolean> {
  const entries = j.entries.filter((e) => e.amount !== 0n);
  const sum = entries.reduce((a, e) => a + e.amount, 0n);
  if (sum !== 0n) throw new UnbalancedJournalError(`Journal ${j.kind}/${j.refId} does not balance (${sum})`);
  if (entries.length < 2) throw new UnbalancedJournalError(`Journal ${j.kind}/${j.refId} needs at least two entries`);
  const at = j.at ?? new Date();
  const inserted = await db
    .insert(ledgerJournals)
    .values({ environment: j.environment, kind: j.kind, refType: j.refType, refId: j.refId, memo: j.memo, createdAt: at })
    .onConflictDoNothing()
    .returning({ id: ledgerJournals.id });
  if (!inserted.length) return false;
  await db
    .insert(ledgerEntries)
    .values(entries.map((e) => ({ journalId: inserted[0].id, account: e.account, amountMicro: e.amount, createdAt: at })));
  return true;
}

/** Raw signed sum of an account (debit-positive), within one environment. */
export async function accountSum(db: Db, environment: Environment, account: string): Promise<bigint> {
  const r = await db.execute<{ s: string | null }>(sql`
    select coalesce(sum(e.amount_micro), 0)::text as s
    from ledger_entries e join ledger_journals j on j.id = e.journal_id
    where e.account = ${account} and j.environment = ${environment}`);
  return BigInt(rows<{ s: string | null }>(r)[0]?.s ?? "0");
}
/** Balance of a credit-normal (liability) account. */
export const liabilityBalance = async (db: Db, env: Environment, account: string) => -(await accountSum(db, env, account));

/** Normalise drizzle execute() results across pglite / node-postgres. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rows<T>(r: any): T[] {
  return (Array.isArray(r) ? r : r.rows) as T[];
}

// ───────────────────────────── settings ─────────────────────────────

export type PlatformSettings = {
  pauseDeposits: boolean;
  pauseWithdrawals: boolean;
  pausePayouts: boolean;
  pauseAutoDelivery: boolean;
  defaultInactivitySeconds: number;
  /** Delay between a yield snapshot and the yield becoming deliverable. */
  yieldSettlementSeconds: number;
  minPayoutMicro: string;
  parcelSizeMicro: string;
  minDepositMicro: string;
  maxDepositMicro: string;
  helperRenderCap: number;
  helperRule: "one_per_deposit" | "one_per_cause";
  // ── V4 Community Heart Pool (separate charitable treasury) ──
  /** Share of finalized ad revenue that goes to the pool, in basis points. 0 = not configured (finalization refused). */
  poolCharityBps: number;
  poolMinDepositMicro: string;
  poolHoldingDays: number;
  poolAccountAgeDays: number;
  poolChoiceDays: number;
  /** Sandbox DAO council: comma-separated admin emails who can approve proposals (blank = ADMIN_EMAILS), and the approval threshold. */
  poolCouncil: string;
  poolThreshold: number;
  /** Real advertising stays off until a provider and its policies are approved. */
  adsProductionEnabled: boolean;
  adMinIntervalSeconds: number;
  adDailyLimit: number;
  /** Wood/Stone cooldown after a session ends, per resource. 0 = no cooldown. */
  gameCooldownSeconds: number;
};

export const DEFAULT_SETTINGS: PlatformSettings = {
  pauseDeposits: false,
  pauseWithdrawals: false,
  pausePayouts: false,
  pauseAutoDelivery: false,
  /** V4: the inactivity fallback is 7 days, and only applies after explicit authorisation. */
  defaultInactivitySeconds: 604800,
  yieldSettlementSeconds: 3600,
  minPayoutMicro: "1000000", // $1.00
  parcelSizeMicro: "1000", // $0.001 per heart parcel
  minDepositMicro: "5000000", // $5
  maxDepositMicro: "2500000000", // $2,500 (Coinbase weekly card limit)
  helperRenderCap: 24,
  helperRule: "one_per_cause",
  poolCharityBps: 0,
  poolMinDepositMicro: "10000000", // $10
  poolHoldingDays: 30,
  poolAccountAgeDays: 30,
  poolChoiceDays: 14,
  poolCouncil: "",
  poolThreshold: 2,
  adsProductionEnabled: false,
  adMinIntervalSeconds: 180,
  adDailyLimit: 10,
  gameCooldownSeconds: 0,
};

export async function getSettings(db: Db): Promise<PlatformSettings> {
  const r = await db.select().from(platformSettings);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of r) if (row.key in DEFAULT_SETTINGS) out[row.key] = row.value;
  return out as PlatformSettings;
}

export async function setSetting<K extends keyof PlatformSettings>(db: Db, key: K, value: PlatformSettings[K], by?: string) {
  await db
    .insert(platformSettings)
    .values({ key, value: value as never, updatedBy: by })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: value as never, updatedBy: by, updatedAt: new Date() } });
}

// ───────────────────────────── audit & alerts ─────────────────────────────

export async function audit(
  db: Db,
  a: {
    actorId?: string | null;
    actorType: "user" | "admin" | "system" | "worker" | "webhook";
    action: string;
    targetType?: string;
    targetId?: string;
    data?: unknown;
    ip?: string | null;
  },
) {
  await db.insert(auditLogs).values({
    actorId: a.actorId ?? null,
    actorType: a.actorType,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    data: a.data === undefined ? null : JSON.parse(JSON.stringify(a.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
    ip: a.ip ?? null,
  });
}

export async function raiseAlert(
  db: Db,
  a: { severity: "info" | "warning" | "critical"; code: string; message: string; dedupeKey: string; data?: unknown },
) {
  const open = await db
    .select({ id: systemAlerts.id })
    .from(systemAlerts)
    .where(and(eq(systemAlerts.dedupeKey, a.dedupeKey), isNull(systemAlerts.resolvedAt)))
    .limit(1);
  if (open.length) return false;
  await db.insert(systemAlerts).values({
    severity: a.severity,
    code: a.code,
    message: a.message,
    dedupeKey: a.dedupeKey,
    data: a.data === undefined ? null : JSON.parse(JSON.stringify(a.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
  });
  return true;
}

export async function resolveAlertsByKey(db: Db, dedupeKey: string) {
  await db
    .update(systemAlerts)
    .set({ resolvedAt: new Date() })
    .where(and(eq(systemAlerts.dedupeKey, dedupeKey), isNull(systemAlerts.resolvedAt)));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60);
}
