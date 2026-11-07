import { and, eq, lt } from "drizzle-orm";
import { jobRuns, loginCodes, sessions } from "./db/schema";
import { raiseAlert } from "./core";
import type { Ctx } from "./services/context";
import { runAutoDelivery } from "./services/deliveries";
import { batchPayouts, confirmPayouts, submitPayouts } from "./services/payouts";
import { expireStaleCheckouts, processDeposits, processWithdrawals } from "./services/processor";
import { reconcile } from "./services/reconcile";
import { runYieldSnapshot } from "./services/yield";
import { verifyVaultDeposits, verifyVaultWithdrawals } from "./services/live-steps";

/** Each job: what it does and how often it runs (seconds). */
export const JOBS = {
  process_deposits: { every: 5, run: (c: Ctx) => processDeposits(c) },
  process_withdrawals: { every: 10, run: (c: Ctx) => processWithdrawals(c) },
  verify_vault_deposits: { every: 15, run: (c: Ctx) => verifyVaultDeposits(c) },
  verify_vault_withdrawals: { every: 15, run: (c: Ctx) => verifyVaultWithdrawals(c) },
  yield_snapshot: { every: 300, run: (c: Ctx) => runYieldSnapshot(c) },
  auto_delivery: { every: 60, run: (c: Ctx) => runAutoDelivery(c) },
  batch_payouts: { every: 120, run: (c: Ctx) => batchPayouts(c) },
  submit_payouts: { every: 30, run: (c: Ctx) => submitPayouts(c) },
  confirm_payouts: { every: 30, run: (c: Ctx) => confirmPayouts(c) },
  reconcile: { every: 600, run: (c: Ctx) => reconcile(c) },
  expire_checkouts: { every: 3600, run: (c: Ctx) => expireStaleCheckouts(c) },
  housekeeping: { every: 3600, run: (c: Ctx) => housekeeping(c) },
} as const;
export type JobName = keyof typeof JOBS;

/** Prunes operational rows that are not financial records (job history, expired sessions and codes). */
async function housekeeping(ctx: Ctx) {
  const now = ctx.now();
  const jobs = await ctx.db.delete(jobRuns).where(lt(jobRuns.startedAt, new Date(now.getTime() - 3 * 86400_000))).returning({ id: jobRuns.id });
  await ctx.db.delete(sessions).where(lt(sessions.expiresAt, now));
  await ctx.db.delete(loginCodes).where(lt(loginCodes.expiresAt, new Date(now.getTime() - 86400_000)));
  return { prunedJobRuns: jobs.length };
}

/**
 * Runs a job at most once per time bucket across all workers: the (name, run_key) unique index
 * makes a second worker's insert fail, so it skips. Failures are recorded and alerted.
 */
export async function runJob(ctx: Ctx, name: JobName, opts: { force?: boolean } = {}) {
  const job = JOBS[name];
  const bucket = Math.floor(ctx.now().getTime() / 1000 / job.every);
  const runKey = opts.force ? `manual:${ctx.now().toISOString()}` : `${ctx.environment}:${bucket}`;
  const claimed = await ctx.db.insert(jobRuns).values({ name, runKey, status: "running" }).onConflictDoNothing().returning();
  if (!claimed.length) return { ran: false as const };
  try {
    const detail = await job.run(ctx);
    await ctx.db
      .update(jobRuns)
      .set({ status: "done", finishedAt: new Date(), detail: JSON.parse(JSON.stringify(detail ?? null, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) })
      .where(and(eq(jobRuns.name, name), eq(jobRuns.runKey, runKey)));
    return { ran: true as const, detail };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await ctx.db.update(jobRuns).set({ status: "failed", finishedAt: new Date(), error: msg.slice(0, 2000) }).where(and(eq(jobRuns.name, name), eq(jobRuns.runKey, runKey)));
    await raiseAlert(ctx.db, { severity: "warning", code: "job_failed", message: `Job ${name} failed: ${msg.slice(0, 300)}`, dedupeKey: `job_failed:${name}` });
    return { ran: true as const, error: msg };
  }
}

/** Simple scheduler loop used by the worker process (and in-process in sandbox dev). */
export function startScheduler(getCtx: () => Promise<Ctx>, log: (m: string) => void = () => {}) {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const ctx = await getCtx();
      for (const name of Object.keys(JOBS) as JobName[]) {
        const r = await runJob(ctx, name);
        if (r.ran && "error" in r) log(`[job] ${name} failed: ${r.error}`);
      }
    } catch (e) {
      log(`[scheduler] ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  const t = setInterval(tick, 5000);
  void tick();
  return () => {
    stopped = true;
    clearInterval(t);
  };
}
