import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { allocateProRata, decimalToWad, formatUsd, parseUsd, simpleInterest } from "@/lib/money";
import { accountSum, acct, AppError, liabilityBalance, postJournal, rows, setSetting, UnbalancedJournalError } from "@/server/core";
import { charityPayouts, deliveries, deposits, helpers, supportPositions, systemAlerts, withdrawals, yieldAllocations } from "@/server/db/schema";
import { settleDepositSupplied } from "@/server/services/deposits";
import { createDelivery, effectiveMode, recordPlayerAction, runAutoDelivery } from "@/server/services/deliveries";
import { batchPayouts, confirmPayouts, submitPayouts } from "@/server/services/payouts";
import { processWithdrawals } from "@/server/services/processor";
import { reconcile } from "@/server/services/reconcile";
import { balanceSeconds } from "@/server/services/weights";
import { requestWithdrawal, withdrawalQuote } from "@/server/services/withdrawals";
import { runYieldSnapshot, yieldSummary } from "@/server/services/yield";
import { decideCause, decideOrganization, computeStage, createCause } from "@/server/services/orgs";
import { helperPreferences } from "@/server/db/schema";
import { makeWorld, type World } from "./harness";

let w: World;
beforeEach(async () => {
  w = await makeWorld();
});
afterEach(async () => {
  await w.close();
});

describe("money primitives", () => {
  it("parses and formats without floating point", () => {
    expect(parseUsd("25")).toBe(25_000_000n);
    expect(parseUsd("1,000.25")).toBe(1_000_250_000n);
    expect(() => parseUsd("1.1234567")).toThrow();
    expect(() => parseUsd("-5")).toThrow();
    expect(formatUsd(1_234_567_890n)).toBe("$1,234.56");
    expect(formatUsd(1_234n, { precise: true })).toBe("$0.001234");
  });

  it("pro-rata allocation always sums exactly to the total", () => {
    for (const total of [0n, 1n, 7n, 1_000_001n, 999_999_999_999n]) {
      const parts = allocateProRata(total, [3n, 3n, 3n, 0n, 11n]);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      expect(parts[3]).toBe(0n);
    }
  });

  it("simple interest at the live RHEA APR", () => {
    const apr = decimalToWad("0.089684268932155393");
    // $1,000 for one year ≈ $89.68
    expect(simpleInterest(1_000_000_000n, apr, 31_536_000n)).toBe(89_684_268n);
  });

  it("time-weighted balance integrates correctly", () => {
    const s = new Date("2026-01-01T00:00:00Z");
    const e = new Date("2026-01-01T00:01:40Z"); // 100 s
    // 10 for 50s, then 30 for 50s = 500 + 1500
    expect(balanceSeconds(10n, [{ at: new Date(s.getTime() + 50_000), delta: 20n }], s, e)).toBe(2000n);
  });
});

describe("ledger", () => {
  it("refuses unbalanced journals and posts each business event once", async () => {
    await expect(
      postJournal(w.db, { environment: "sandbox", kind: "x", refType: "t", refId: "1", entries: [{ account: "a", amount: 5n }, { account: "b", amount: -4n }] }),
    ).rejects.toBeInstanceOf(UnbalancedJournalError);
    const e = { environment: "sandbox" as const, kind: "x", refType: "t", refId: "2", entries: [{ account: "a", amount: 5n }, { account: "b", amount: -5n }] };
    expect(await postJournal(w.db, e)).toBe(true);
    expect(await postJournal(w.db, e)).toBe(false);
    expect(await accountSum(w.db, "sandbox", "a")).toBe(5n);
  });
});

describe("organisation and cause approval", () => {
  it("cause cannot be approved before its organisation, and unapproved causes take no money", async () => {
    const { createOrganization } = await import("@/server/services/orgs");
    const org = await createOrganization(w.ctx, w.orgOwner.id, { name: "New Org", description: "", contactEmail: "a@b.test" });
    const cause = await createCause(w.ctx, w.orgOwner.id, org.id, { title: "Library", summary: "Books for every child in town.", description: "", category: "education", cityName: "Bookton", goalUsd: 500 });
    await expect(decideCause(w.ctx, w.admin.id, cause.id, "approved")).rejects.toThrow(/organisation first/);
    const u = await w.user("u@x.test");
    await expect(w.deposit(u.id, cause.id, 10)).rejects.toMatchObject({ code: "cause_unavailable" });
    await decideOrganization(w.ctx, w.admin.id, org.id, "approved");
    await decideCause(w.ctx, w.admin.id, cause.id, "approved");
    await expect(w.deposit(u.id, cause.id, 10)).resolves.toBeTruthy();
  });
});

describe("deposit lifecycle", () => {
  it("moves through every state, credits principal once and creates one helper", async () => {
    const { cause } = await w.approvedCause();
    const u = await w.user("ada@x.test");
    const id = await w.deposit(u.id, cause.id, 100, "same-key");
    const [d] = await w.db.select().from(deposits).where(eq(deposits.id, id));
    expect(d.status).toBe("supplied");
    expect(d.principalMicro).toBe(100_000_000n);
    expect(await liabilityBalance(w.db, "sandbox", acct.userPrincipal(u.id))).toBe(100_000_000n);
    expect(await accountSum(w.db, "sandbox", acct.poolLending)).toBe(100_000_000n);
    const hs = await w.db.select().from(helpers).where(eq(helpers.userId, u.id));
    expect(hs).toHaveLength(1);
    expect(hs[0].animal).toBe("otter");

    // Re-settling (duplicate webhook / worker retry) changes nothing.
    const again = await settleDepositSupplied(w.ctx, { depositId: id, principalMicro: 100_000_000n, feesMicro: 0n, vaultTxHash: null });
    expect(again.alreadySettled).toBe(true);
    expect(await liabilityBalance(w.db, "sandbox", acct.userPrincipal(u.id))).toBe(100_000_000n);
    expect(await w.db.select().from(helpers).where(eq(helpers.userId, u.id))).toHaveLength(1);
  });

  it("same idempotency key returns the same deposit", async () => {
    const { cause } = await w.approvedCause();
    const u = await w.user("b@x.test");
    const { createDeposit } = await import("@/server/services/deposits");
    const args = { userId: u.id, causeId: cause.id, amountMicro: 20_000_000n, animal: "fox" as const, nickname: "Ember", idempotencyKey: "k-123456", clientIp: "1.1.1.1" };
    const a = await createDeposit(w.ctx, args);
    const b = await createDeposit(w.ctx, args);
    expect(b.deposit.id).toBe(a.deposit.id);
    expect(b.replay).toBe(true);
    expect(await w.db.select().from(deposits)).toHaveLength(1);
  });

  it("refuses deposits while paused", async () => {
    const { cause } = await w.approvedCause();
    const u = await w.user("c@x.test");
    await setSetting(w.db, "pauseDeposits", true);
    await expect(w.deposit(u.id, cause.id, 10)).rejects.toMatchObject({ code: "paused" });
  });
});

describe("yield accounting", () => {
  it("splits measured yield by time-weighted principal, exactly", async () => {
    const { cause } = await w.approvedCause();
    const a = await w.user("a@x.test");
    const b = await w.user("b@x.test");
    await w.deposit(a.id, cause.id, 300);
    w.advance(100);
    await w.deposit(b.id, cause.id, 300);
    w.advance(100);
    w.lending.extra = 900n; // the pool grew by 900 micro over 200s
    const r = await runYieldSnapshot(w.ctx);
    expect(r.kind).toBe("allocated");
    const allocs = await w.db.select().from(yieldAllocations);
    const byUser = Object.fromEntries(allocs.map((x) => [x.userId, x.amountMicro]));
    // a: 300 × 200s, b: 300 × 100s → 2:1
    expect(byUser[a.id]).toBe(600n);
    expect(byUser[b.id]).toBe(300n);
    expect(allocs.reduce((s, x) => s + x.amountMicro, 0n)).toBe(900n);
  });

  it("never allocates a loss and raises a critical alert", async () => {
    const { cause } = await w.approvedCause();
    const a = await w.user("a@x.test");
    await w.deposit(a.id, cause.id, 50);
    w.advance(60);
    w.lending.extra = -10n;
    const r = await runYieldSnapshot(w.ctx);
    expect(r.kind).toBe("loss");
    expect(await w.db.select().from(yieldAllocations)).toHaveLength(0);
    const alerts = await w.db.select().from(systemAlerts);
    expect(alerts.some((x) => x.code === "pool_value_below_ledger" && x.severity === "critical")).toBe(true);
  });

  it("gameplay cannot change the amount of yield earned", async () => {
    async function scenario(play: boolean) {
      const world = await (await import("./harness")).makeWorld();
      const { cause } = await world.approvedCause();
      const u = await world.user("p@x.test");
      const other = await world.user("q@x.test");
      await world.deposit(u.id, cause.id, 100);
      await world.deposit(other.id, cause.id, 100);
      const [h] = await world.db.select().from(helpers).where(eq(helpers.userId, u.id));
      for (let k = 0; k < 20; k++) {
        world.advance(30);
        if (play) await recordPlayerAction(world.ctx, u.id, h.id);
      }
      world.lending.extra = 1_000n;
      await runYieldSnapshot(world.ctx);
      const s = await yieldSummary(world.ctx, u.id);
      await world.close();
      return s.earnedMicro;
    }
    const idle = await scenario(false);
    const active = await scenario(true);
    expect(active).toBe(idle);
    expect(idle).toBe(500n);
  });
});

describe("deliveries", () => {
  async function setupWithYield() {
    const { cause, org } = await w.approvedCause();
    const u = await w.user("d@x.test");
    await w.deposit(u.id, cause.id, 100);
    w.advance(3600);
    w.lending.extra = 2_000_000n; // $2 of yield
    await runYieldSnapshot(w.ctx);
    const [h] = await w.db.select().from(helpers).where(eq(helpers.userId, u.id));
    return { cause, org, u, h };
  }

  it("delivers eligible yield once; the same yield cannot be delivered twice", async () => {
    const { cause, u, h } = await setupWithYield();
    const d = await createDelivery(w.ctx, { userId: u.id, causeId: cause.id, helperId: h.id, mode: "manual", idempotencyKey: "drop-1" });
    expect(d.delivery.amountMicro).toBe(2_000_000n);
    // Replaying the same request returns the same delivery.
    const replay = await createDelivery(w.ctx, { userId: u.id, causeId: cause.id, helperId: h.id, mode: "manual", idempotencyKey: "drop-1" });
    expect(replay.replay).toBe(true);
    // A new request finds nothing left.
    await expect(createDelivery(w.ctx, { userId: u.id, causeId: cause.id, helperId: h.id, mode: "manual", idempotencyKey: "drop-2" })).rejects.toMatchObject({ code: "nothing_to_deliver" });
    expect(await w.db.select().from(deliveries)).toHaveLength(1);
    // The database itself refuses over-consumption.
    await expect(w.db.update(yieldAllocations).set({ consumedMicro: sql`${yieldAllocations.amountMicro} + 1` })).rejects.toThrow();
  });

  it("yield is not deliverable before the settlement window", async () => {
    await setSetting(w.db, "yieldSettlementSeconds", 3600);
    const { cause, u } = await setupWithYield();
    await expect(createDelivery(w.ctx, { userId: u.id, causeId: cause.id, mode: "manual", idempotencyKey: "early" })).rejects.toMatchObject({ code: "nothing_to_deliver" });
    w.advance(3601);
    await expect(createDelivery(w.ctx, { userId: u.id, causeId: cause.id, mode: "manual", idempotencyKey: "later" })).resolves.toBeTruthy();
  });

  it("refuses wrong causes and other people's helpers", async () => {
    const { u, h } = await setupWithYield();
    const second = await w.approvedCause("Green Valley", "Fernhollow");
    await decideCause(w.ctx, w.admin.id, second.cause.id, "suspended");
    await expect(createDelivery(w.ctx, { userId: u.id, causeId: second.cause.id, mode: "manual", idempotencyKey: "x1" })).rejects.toMatchObject({ code: "cause_not_deliverable" });
    await expect(createDelivery(w.ctx, { userId: u.id, causeId: "00000000-0000-0000-0000-000000000000", mode: "manual", idempotencyKey: "x2" })).rejects.toMatchObject({ code: "not_found" });
    const third = await w.approvedCause("Sunny Kitchen", "Ladle Lane");
    const stranger = await w.user("s@x.test");
    await expect(createDelivery(w.ctx, { userId: stranger.id, causeId: third.cause.id, helperId: h.id, mode: "manual", idempotencyKey: "x3" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await w.db.select().from(deliveries)).toHaveLength(0);
  });

  it("player inactive for more than an hour switches to auto; returning resumes manual", async () => {
    const { u, h } = await setupWithYield();
    const now = w.nowRef();
    const at = (s: number) => new Date(now.getTime() - s * 1000);
    expect(effectiveMode({ controlPreference: "manual", lastPlayerActionAt: at(59 * 60) }, 3600, now).mode).toBe("manual");
    expect(effectiveMode({ controlPreference: "manual", lastPlayerActionAt: at(61 * 60) }, 3600, now).mode).toBe("auto");
    expect(effectiveMode({ controlPreference: "auto", lastPlayerActionAt: at(1) }, 3600, now).mode).toBe("auto");

    // Recently active: auto-delivery leaves the yield alone.
    await recordPlayerAction(w.ctx, u.id, h.id);
    expect((await runAutoDelivery(w.ctx)).delivered).toBe(0);
    // Away for 61 minutes: auto mode delivers to the home cause.
    w.advance(61 * 60);
    expect((await runAutoDelivery(w.ctx)).delivered).toBe(1);
    // Player comes back: manual again.
    const back = await recordPlayerAction(w.ctx, u.id, h.id);
    expect(effectiveMode(back, 3600, w.nowRef()).mode).toBe("manual");
  });

  it("auto mode honours a split rule and the threshold", async () => {
    const { cause, u } = await setupWithYield();
    const second = await w.approvedCause("Green Valley", "Fernhollow");
    await w.db.insert(helperPreferences).values({ userId: u.id, deliveryRule: "split", split: [{ causeId: cause.id, bps: 7000 }, { causeId: second.cause.id, bps: 3000 }], autoThresholdMicro: 5_000_000n }).onConflictDoNothing();
    w.advance(7200);
    expect((await runAutoDelivery(w.ctx)).delivered).toBe(0); // $2 < $5 threshold
    await w.db.update(helperPreferences).set({ autoThresholdMicro: 1_000_000n }).where(eq(helperPreferences.userId, u.id));
    expect((await runAutoDelivery(w.ctx)).delivered).toBe(2);
    const ds = await w.db.select().from(deliveries);
    const by = Object.fromEntries(ds.map((d) => [d.causeId, d.amountMicro]));
    expect(by[cause.id]).toBe(1_400_000n);
    expect(by[second.cause.id]).toBe(600_000n);
  });

  it("payouts batch, submit, confirm — and failures retry then go to manual review", async () => {
    const { cause, u, h } = await setupWithYield();
    await createDelivery(w.ctx, { userId: u.id, causeId: cause.id, helperId: h.id, mode: "manual", idempotencyKey: "p1" });
    w.payout.failNext = 1;
    expect((await batchPayouts(w.ctx)).created).toBe(1);
    expect((await submitPayouts(w.ctx)).submitted).toBe(0); // failed once, back to created
    expect((await submitPayouts(w.ctx)).submitted).toBe(1);
    expect((await confirmPayouts(w.ctx)).confirmed).toBe(1);
    const [p] = await w.db.select().from(charityPayouts);
    expect(p.status).toBe("confirmed");
    expect(w.payout.calls).toHaveLength(1);
    expect((await w.db.select().from(deliveries))[0].status).toBe("paid");
    expect(await accountSum(w.db, "sandbox", acct.poolLending)).toBe(100_000_000n); // yield left, principal stayed
    // confirming again does nothing
    expect((await confirmPayouts(w.ctx)).confirmed).toBe(0);

    // A payout that keeps failing ends in manual review with a critical alert.
    w.advance(10);
    w.lending.extra = 3_000_000n;
    await runYieldSnapshot(w.ctx);
    await createDelivery(w.ctx, { userId: u.id, causeId: cause.id, mode: "manual", idempotencyKey: "p2" });
    await batchPayouts(w.ctx);
    w.payout.failNext = 5;
    for (let k = 0; k < 3; k++) await submitPayouts(w.ctx);
    const ps = await w.db.select().from(charityPayouts).where(eq(charityPayouts.status, "manual_review"));
    expect(ps).toHaveLength(1);
    expect((await w.db.select().from(systemAlerts)).some((a) => a.code === "payout_failed")).toBe(true);
  });

  it("city stage follows only real paid yield", () => {
    expect(computeStage(0n, 1_000_000_000n).name).toBe("Abandoned");
    expect(computeStage(30_000_000n, 1_000_000_000n).name).toBe("Cleared");
    expect(computeStage(950_000_000n, 1_000_000_000n).name).toBe("Thriving Community");
  });
});

describe("withdrawals", () => {
  it("cannot exceed principal, moves through statuses, and stops earning", async () => {
    const { cause } = await w.approvedCause();
    const a = await w.user("a@x.test");
    const b = await w.user("b@x.test");
    await w.deposit(a.id, cause.id, 100);
    await w.deposit(b.id, cause.id, 100);
    await expect(requestWithdrawal(w.ctx, { userId: a.id, amountMicro: 100_000_001n, idempotencyKey: "w0" })).rejects.toMatchObject({ code: "insufficient_principal" });
    const q = await withdrawalQuote(w.ctx, a.id);
    expect(q.redeemableMicro).toBe(100_000_000n);
    const { withdrawal } = await requestWithdrawal(w.ctx, { userId: a.id, amountMicro: 100_000_000n, idempotencyKey: "w1" });
    const dup = await requestWithdrawal(w.ctx, { userId: a.id, amountMicro: 100_000_000n, idempotencyKey: "w1" });
    expect(dup.withdrawal.id).toBe(withdrawal.id);
    await expect(requestWithdrawal(w.ctx, { userId: a.id, amountMicro: 1n, idempotencyKey: "w2" })).rejects.toMatchObject({ code: "insufficient_principal" });

    for (let k = 0; k < 4; k++) await processWithdrawals(w.ctx);
    const [done] = await w.db.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id));
    expect(done.status).toBe("completed");
    expect(done.history.map((x) => x.status)).toEqual(["requested", "pending_protocol_withdrawal", "bridging", "available_for_offramp", "completed"]);
    expect(await liabilityBalance(w.db, "sandbox", acct.userWithdrawing(a.id))).toBe(0n);
    expect(await accountSum(w.db, "sandbox", acct.poolLending)).toBe(100_000_000n);

    // From now on only b earns.
    w.advance(500);
    w.lending.extra = 777n;
    await runYieldSnapshot(w.ctx);
    expect((await yieldSummary(w.ctx, b.id)).earnedMicro).toBe(777n);
    expect((await yieldSummary(w.ctx, a.id)).earnedMicro).toBe(0n);
    const [pa] = await w.db.select().from(supportPositions).where(eq(supportPositions.userId, a.id));
    expect(pa.principalMicro).toBe(0n);
    expect(pa.totalWithdrawnMicro).toBe(100_000_000n);
  });
});

describe("reconciliation", () => {
  it("passes after a full lifecycle and flags tampering", async () => {
    const { cause } = await w.approvedCause();
    const u = await w.user("r@x.test");
    await w.deposit(u.id, cause.id, 100);
    w.advance(60);
    w.lending.extra = 1_500_000n;
    await runYieldSnapshot(w.ctx);
    await createDelivery(w.ctx, { userId: u.id, causeId: cause.id, mode: "manual", idempotencyKey: "r1" });
    await batchPayouts(w.ctx);
    await submitPayouts(w.ctx);
    await confirmPayouts(w.ctx);
    await requestWithdrawal(w.ctx, { userId: u.id, amountMicro: 40_000_000n, idempotencyKey: "rw" });
    const checks = await reconcile(w.ctx);
    expect(checks.filter((c) => !c.ok)).toEqual([]);

    await w.db.update(supportPositions).set({ principalMicro: 1n }).where(eq(supportPositions.userId, u.id));
    const bad = await reconcile(w.ctx);
    expect(bad.find((c) => c.key === "positions_match_ledger")?.ok).toBe(false);
    const total = rows<{ s: string }>(await w.db.execute(sql`select coalesce(sum(amount_micro),0)::text as s from ledger_entries`))[0].s;
    expect(total).toBe("0");
  });
});

describe("errors", () => {
  it("AppError carries an HTTP status", () => {
    expect(new AppError("x", "y", 418).status).toBe(418);
  });
});
