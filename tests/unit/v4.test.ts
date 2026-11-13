import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accountSum, acct, liabilityBalance, setSetting } from "@/server/core";
import { constructionProjects, gameSessions, helperPreferences, identityAttestations, poolAllocations, poolCycles, resourceContributions, users } from "@/server/db/schema";
import {
  RES_UNIT,
  RULES,
  actionReward,
  applyRound,
  baseReward,
  comboBps,
  barAt,
  barAttempt,
  judgeRound,
  judgeStop,
  MIN_GREEN,
  MIN_YELLOW,
  pickResource,
  tierOf,
  woodRound,
  type WoodRound,
} from "@/game/v4/rules";

/** A stop time that lands dead in the green zone (searched the way a perfect player would). */
function perfectStop(a: ReturnType<typeof barAttempt>, offsetMs = 0) {
  for (let t = 200; t < 8000; t += 2) if (judgeStop(a, t).result === "perfect" && judgeStop(a, t + offsetMs).result === "perfect") return t + offsetMs;
  throw new Error("no perfect stop");
}
const perfectStops = (c: WoodRound) => c.attempts.map((a, i) => perfectStop(a, i % 2 ? 2 : 0));
const claimed = (stops: (number | null)[]) => Math.ceil(stops.reduce<number>((x, t) => x + (t ?? 8000), 0) / 1000) + 1;
import { BLUEPRINTS, plotsFor, ROADS, townLayout } from "@/game/v4/town";
import { contribute, cooldowns, expireReservations, runAutoWorkers, startProject, startSession, submitRound, quitSession } from "@/server/services/game";
import { fruitSplit, heartTree } from "@/server/services/heartTree";
import * as pool from "@/server/services/pool";
import { runYieldSnapshot } from "@/server/services/yield";
import { makeWorld, type World } from "./harness";

let w: World;
beforeEach(async () => {
  w = await makeWorld();
});
afterEach(async () => {
  await w.close();
});

// ───────────────────────────── pure rules ─────────────────────────────

describe("V4 rules: deposit-scaled, fixed-point rewards", () => {
  it("$10 earns 0.5 per Hit; Perfect is 2×; no deposit earns nothing", () => {
    expect(baseReward(10_000_000n)).toBe(500_000n); // 0.5 × 1e6
    expect(actionReward(baseReward(10_000_000n), "perfect", 1)).toBe(1_000_000n);
    expect(baseReward(0n)).toBe(0n);
    expect(baseReward(999_999n)).toBe(0n); // below $1
  });
  it("is linear to $1,000, then diminishing (√)", () => {
    expect(baseReward(1_000_000_000n)).toBe(50n * RES_UNIT); // $1,000 → 50 per Hit
    expect(baseReward(4_000_000_000n)).toBe(100n * RES_UNIT); // 4× money → 2×
    expect(baseReward(100_000_000_000n)).toBe(500n * RES_UNIT); // 100× → 10×
    // splitting within the knee never helps
    expect(baseReward(500_000_000n) * 2n).toBe(baseReward(1_000_000_000n));
  });
  it("combo: min(1 + floor(combo / 5) × 0.05, 1.5)", () => {
    expect(comboBps(0)).toBe(10_000n);
    expect(comboBps(4)).toBe(10_000n);
    expect(comboBps(5)).toBe(10_500n);
    expect(comboBps(14)).toBe(11_000n);
    expect(comboBps(24)).toBe(12_000n);
    expect(comboBps(50)).toBe(15_000n);
    expect(comboBps(500)).toBe(15_000n);
  });
  it("the server picks Wood (the only game); waits only if a cooldown is set", () => {
    const none = { wood: null, stone: null };
    expect(pickResource({ wood: true, stone: true }, none, 0)).toEqual({ kind: "play", resource: "wood" });
    expect(pickResource({ wood: true, stone: false }, { wood: 100, stone: null }, 0)).toEqual({ kind: "wait", untilMs: 100 });
    expect(pickResource({ wood: false, stone: true }, none, 0)).toEqual({ kind: "done" });
  });
});

describe("Wood: one timing bar, one button", () => {
  const still = { n: 0, tier: 0 as const, start: 0, dir: 1 as const, speed: 0.5, accel: 0, zone: 0.5, zoneSpeed: 0, zoneDir: 1 as const, yellow: 0.3, green: 0.1 };
  it("green = Perfect, yellow = Hit, outside = Miss, no chop = Miss", () => {
    // indicator moves 0.5 bar/s from 0: reaches 0.5 (zone centre) at 1000 ms
    expect(judgeStop(still, 1000).result).toBe("perfect");
    expect(judgeStop(still, 1180).result).toBe("hit"); // 0.59: inside yellow (±0.15), outside green (±0.05)
    expect(judgeStop(still, 400).result).toBe("miss"); // 0.2
    expect(judgeStop(still, null)).toMatchObject({ result: "miss", reason: "timeout" });
    expect(judgeStop(still, 9000)).toMatchObject({ result: "miss", reason: "timeout" });
  });
  it("the indicator bounces at the ends and the same maths runs everywhere", () => {
    expect(barAt(still, 2000).indicator).toBeCloseTo(1, 5);
    expect(barAt(still, 3000).indicator).toBeCloseTo(0.5, 5);
    expect(judgeStop(still, 3000).result).toBe("perfect"); // second pass through the zone
  });
  it("difficulty rises with progress (never with deposit), zones stay readable", () => {
    const easy = barAttempt(7, 0), hard = barAttempt(7, 40);
    expect(tierOf(0)).toBe(0);
    expect(tierOf(40)).toBe(3);
    expect(easy.zoneSpeed).toBe(0); // easy: target stands still
    expect(hard.yellow).toBeLessThan(easy.yellow);
    for (let n = 0; n < 80; n++) {
      const x = barAttempt(11, n);
      expect(x.yellow).toBeGreaterThanOrEqual(MIN_YELLOW);
      expect(x.green).toBeGreaterThanOrEqual(MIN_GREEN);
      expect(x.green).toBeLessThan(x.yellow);
      expect(barAt(x, 1234).zone).toBeGreaterThanOrEqual(x.yellow / 2 - 1e-9);
    }
    expect(woodRound(5, 3)).toEqual(woodRound(5, 3));
  });
  it("Perfect pays 2×, combo grows slowly, three Misses end the game keeping what was earned", () => {
    const js = judgeRound({ game: "wood", round: 0, tier: 0, attempts: [still, still, still, still, still] }, [1000, 1180, 400, 400, 400]);
    const r = applyRound({ hearts: 3, combo: 0, bestCombo: 0, earnedMicro: 0n }, js, 1000n, 10n ** 12n);
    expect(r.applied.map((x) => x.rewardMicro)).toEqual([2000n, 1000n, 0n, 0n, 0n]);
    expect(r.state.hearts).toBe(0);
    expect(r.stopped).toBe("hearts");
    expect(r.state.earnedMicro).toBe(3000n);
  });
});

describe("V4 town layout", () => {
  it("plots never overlap roads or each other, and every blueprint size has a plot", () => {
    const plots = plotsFor();
    const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const p of plots) {
      for (const r of ROADS) expect(hit(p, r)).toBe(false);
      for (const q of plots) if (q !== p) expect(hit(p, q)).toBe(false);
    }
    for (const s of ["S", "M", "L"]) expect(BLUEPRINTS.some((b) => b.size === s) && plots.some((p) => p.size === s)).toBe(true);
    expect(townLayout(5)).toEqual(townLayout(5));
  });
});

describe("V4 Heart Tree", () => {
  it("splits real yield exactly into fruits; no fixed $0.01 per fruit", () => {
    expect(fruitSplit(0n)).toEqual([]);
    expect(fruitSplit(3_217n)).toEqual([3_217n]); // $0.003217 is still one honest fruit
    const f = fruitSplit(1_234_567n);
    expect(f.reduce((a, b) => a + b, 0n)).toBe(1_234_567n);
    expect(f.length).toBeLessThanOrEqual(12);
  });
});

// ───────────────────────────── services ─────────────────────────────

async function supporter(email: string, usd: number) {
  const { cause } = await w.approvedCause(`Town ${email}`, `City ${email.slice(0, 3)}`);
  const u = await w.user(email);
  if (usd > 0) await w.deposit(u.id, cause.id, usd);
  return { u, cause };
}

describe("V4 construction", () => {
  it("one unfinished project per supporter; plots are exclusive; sizes must match", async () => {
    const { u, cause } = await supporter("a@x.test", 100);
    const b = await w.user("b@x.test");
    await w.deposit(b.id, cause.id, 50);
    await expect(startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p1", blueprintKey: "cottage" })).rejects.toMatchObject({ code: "blueprint_size" });
    await expect(startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "zz", blueprintKey: "cottage" })).rejects.toMatchObject({ code: "bad_plot" });
    await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "cottage" });
    await expect(startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p6", blueprintKey: "house" })).rejects.toMatchObject({ code: "one_project" });
    await expect(startProject(w.ctx, b.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "house" })).rejects.toMatchObject({ code: "plot_taken" });
    await expect(startProject(w.ctx, b.id, { causeId: cause.id, plotKey: "p6", blueprintKey: "tent" })).rejects.toMatchObject({ code: "bad_blueprint" }); // retired for the MVP
    const noDeposit = await w.user("c@x.test");
    await expect(startProject(w.ctx, noDeposit.id, { causeId: cause.id, plotKey: "p6", blueprintKey: "house" })).rejects.toMatchObject({ code: "not_eligible" });
  });

  it("contributions are idempotent, clamped to the requirement, and complete the building", async () => {
    const { u, cause } = await supporter("a@x.test", 100);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "cottage" }); // 30,000 Wood (Wood only)
    const c1 = await contribute(w.ctx, { projectId: p.id, userId: u.id, resource: "wood", amountMicro: 50_000n * RES_UNIT, source: "minigame", refKey: "s1" });
    expect(c1.appliedMicro).toBe(30_000n * RES_UNIT);
    expect(c1.completed).toBe(true);
    const again = await contribute(w.ctx, { projectId: p.id, userId: u.id, resource: "wood", amountMicro: 50_000n * RES_UNIT, source: "minigame", refKey: "s1" });
    expect(again.replay).toBe(true);
    // a finished building accepts nothing more
    const c2 = await contribute(w.ctx, { projectId: p.id, userId: u.id, resource: "wood", amountMicro: 10n * RES_UNIT, source: "minigame", refKey: "s2" });
    expect(c2.appliedMicro).toBe(0n);
    // the creator is free to start another one now
    await expect(startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p6", blueprintKey: "cottage" })).resolves.toBeTruthy();
  });

  it("idle reservations expire after 24h; started projects stay completable", async () => {
    const { u, cause } = await supporter("a@x.test", 100);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "cottage" });
    w.advance(25 * 3600);
    expect((await expireReservations(w.ctx)).expired).toBe(1);
    const [row] = await w.db.select().from(constructionProjects).where(eq(constructionProjects.id, p.id));
    expect(row.status).toBe("expired");
    const p2 = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "house" });
    await contribute(w.ctx, { projectId: p2.id, userId: u.id, resource: "wood", amountMicro: RES_UNIT, source: "minigame", refKey: "x" });
    w.advance(30 * 86400);
    expect((await expireReservations(w.ctx)).expired).toBe(0);
  });
});

describe("V4 server-authoritative sessions", () => {
  async function playable() {
    const { u, cause } = await supporter("a@x.test", 1000);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p1", blueprintKey: "school" });
    return { u, cause, p };
  }

  it("needs an active deposit; the server picks the resource and hides the seed", async () => {
    const { cause } = await playable();
    const poor = await w.user("poor@x.test");
    const [proj] = await w.db.select().from(constructionProjects).where(eq(constructionProjects.causeId, cause.id));
    // free play: no deposit still plays, at 0.01 per Hit
    const free = await startSession(w.ctx, poor.id, proj.id);
    expect(free.kind === "play" && free.session.baseRewardMicro).toBe(RULES.freeBaseMicro);
    if (free.kind === "play") await quitSession(w.ctx, poor.id, free.session.id);
    const { u, p } = { u: (await w.db.select().from(users).where(eq(users.email, "a@x.test")))[0], p: proj };
    const s = await startSession(w.ctx, u.id, p.id);
    expect(s.kind).toBe("play");
    if (s.kind !== "play") return;
    expect(s.session.resource).toBe("wood");
    expect(JSON.stringify(s.session, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain('"seed"');
    expect(s.session.baseRewardMicro).toBe(50n * RES_UNIT); // $1,000 → 50 per Hit
  });

  it("judges raw timings, refuses too-fast and replayed rounds, commits once, then a per-resource cooldown when enabled", async () => {
    await setSetting(w.db, "gameCooldownSeconds", 300);
    const { u, p } = await playable();
    const s = await startSession(w.ctx, u.id, p.id);
    if (s.kind !== "play") throw new Error("expected play");
    const chart = s.session.chart!;
    const perfectInput = { stops: perfectStops(chart) };
    await expect(submitRound(w.ctx, u.id, s.session.id, { round: 0, ...perfectInput })).rejects.toMatchObject({ code: "too_fast" });
    w.advance(claimed(perfectInput.stops));
    const r = await submitRound(w.ctx, u.id, s.session.id, { round: 0, ...perfectInput });
    expect(BigInt(r.session.earnedMicro)).toBeGreaterThan(0n);
    expect(r.session.hearts).toBe(3);
    await expect(submitRound(w.ctx, u.id, s.session.id, { round: 0, ...perfectInput })).rejects.toMatchObject({ code: "round_mismatch" });
    // a second tab cannot open a parallel session: it resumes the same one
    const again = await startSession(w.ctx, u.id, p.id);
    expect(again.kind === "play" && again.session.id).toBe(s.session.id);
    // quit: commits earned resources directly to the building, exactly once
    const q = await quitSession(w.ctx, u.id, s.session.id);
    expect(q.session.status).toBe("ended");
    const contribs = await w.db.select().from(resourceContributions);
    expect(contribs).toHaveLength(1);
    expect(contribs[0].amountMicro).toBe(BigInt(r.session.earnedMicro));
    // with a cooldown configured, Wood rests for 5 minutes
    const cd = await cooldowns(w.ctx, u.id);
    expect(cd.wood).toBeGreaterThan(w.nowRef().getTime());
    const wait = await startSession(w.ctx, u.id, p.id);
    expect(wait.kind).toBe("wait");
    w.advance(301);
    expect((await startSession(w.ctx, u.id, p.id)).kind).toBe("play");
  });

  it("caps a session at 50,000 resources (Perfect and combo count) and never trusts client rewards", async () => {
    const { u, cause } = await supporter("rich@x.test", 2500);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p1", blueprintKey: "townHall" });
    // force a huge base reward to hit the cap quickly
    const s = await startSession(w.ctx, u.id, p.id);
    if (s.kind !== "play") throw new Error();
    await w.db.update(gameSessions).set({ baseRewardMicro: 20_000n * RES_UNIT }).where(eq(gameSessions.id, s.session.id));
    let cur = s.session;
    for (let k = 0; k < 6 && cur.status === "open"; k++) {
      const chart = cur.chart!;
      const input = { stops: perfectStops(chart) };
      w.advance(claimed(input.stops));
      cur = (await submitRound(w.ctx, u.id, cur.id, { round: cur.round, ...input, ...({ rewardMicro: "999999999999" } as object) })).session;
    }
    expect(cur.status).toBe("ended");
    expect(cur.endReason).toBe("cap");
    expect(BigInt(cur.earnedMicro)).toBe(RULES.sessionCapMicro);
  });

  it("gameplay never touches money: principal and yield are unchanged by play", async () => {
    const { u, p } = await playable();
    const before = await liabilityBalance(w.db, "sandbox", acct.userPrincipal(u.id));
    const lend = await accountSum(w.db, "sandbox", acct.poolLending);
    const s = await startSession(w.ctx, u.id, p.id);
    if (s.kind !== "play") throw new Error();
    w.advance(30);
    await quitSession(w.ctx, u.id, s.session.id);
    expect(await liabilityBalance(w.db, "sandbox", acct.userPrincipal(u.id))).toBe(before);
    expect(await accountSum(w.db, "sandbox", acct.poolLending)).toBe(lend);
    expect(await liabilityBalance(w.db, "sandbox", acct.userYield(u.id))).toBe(0n);
  });
});

describe("V4 free play (no deposit)", () => {
  it("earns 0.5 per Hit and stops at 500 resources per day, Wood and Stone combined", async () => {
    const { u, cause } = await supporter("owner@x.test", 1000);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p1", blueprintKey: "school" });
    const f = await w.user("free@x.test");
    const s = await startSession(w.ctx, f.id, p.id);
    if (s.kind !== "play") throw new Error("expected play");
    expect(s.session.baseRewardMicro).toBe(RULES.freeBaseMicro);
    // pretend they already earned 9.99 today
    await w.db.insert(resourceContributions).values({ projectId: p.id, userId: f.id, environment: "sandbox", resource: "wood", amountMicro: RULES.freeDailyCapMicro - 500_000n, source: "minigame", refKey: "earlier" });
    // a huge base would blow past the allowance; the server clamps the session to what is left
    await w.db.update(gameSessions).set({ baseRewardMicro: 250n * RES_UNIT }).where(eq(gameSessions.id, s.session.id));
    const chart = s.session.chart!;
    const input = { stops: perfectStops(chart) };
    w.advance(claimed(input.stops));
    const r = await submitRound(w.ctx, f.id, s.session.id, { round: 0, ...input });
    expect(r.session.status).toBe("ended");
    expect(r.session.endReason).toBe("daily_limit");
    expect(BigInt(r.session.earnedMicro)).toBe(500_000n);
    // allowance used up: no new session today
    await expect(startSession(w.ctx, f.id, p.id)).rejects.toMatchObject({ code: "daily_limit" });
    w.advance(86400 + 1);
    expect((await startSession(w.ctx, f.id, p.id)).kind).toBe("play");
  });
});

describe("V4 auto workers", () => {
  it("produce ~25× slower than baseline manual play, hourly and idempotently, only with a deposit", async () => {
    const { u, cause } = await supporter("a@x.test", 1000);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p1", blueprintKey: "school" });
    expect((await runAutoWorkers(w.ctx)).applied).toBe(1);
    expect((await runAutoWorkers(w.ctx)).applied).toBe(0); // same hour: no double production
    const [row] = await w.db.select().from(constructionProjects).where(eq(constructionProjects.id, p.id));
    expect(row.woodContributed + row.stoneContributed).toBe(50n * RES_UNIT * RULES.autoBasePerHour); // base 50 per Hit ($1,000) × 24 per hour
    expect(RULES.manualBaselineBasePerHour / RULES.autoBasePerHour).toBeGreaterThanOrEqual(10n);
    expect(RULES.manualBaselineBasePerHour / RULES.autoBasePerHour).toBeLessThanOrEqual(50n);
    w.advance(3600);
    expect((await runAutoWorkers(w.ctx)).applied).toBe(1);
  });
});

// ───────────────────────────── Community Heart Pool ─────────────────────────────

describe("V4 Community Heart Pool", () => {
  async function eligiblePeople(n: number) {
    await setSetting(w.db, "poolHoldingDays", 1);
    await setSetting(w.db, "poolAccountAgeDays", 0);
    await setSetting(w.db, "poolChoiceDays", 3);
    const { cause } = await w.approvedCause("Pool Town", "Poolbury");
    const people = [];
    for (let k = 0; k < n; k++) {
      const u = await w.user(`p${k}@x.test`);
      await w.deposit(u.id, cause.id, 20 + k * 500); // very different deposits
      people.push(u);
    }
    return { cause, people };
  }

  async function runToChoosing(grossUsd: string) {
    const r = await pool.reportRevenue(w.ctx, w.admin.id, { period: "2026-01", provider: "simulated", source: "simulated", externalRef: "stmt-1", grossMicro: BigInt(Math.round(Number(grossUsd) * 1e6)) });
    await expect(pool.finalizeRevenue(w.ctx, w.admin.id, r.cycle.id)).rejects.toMatchObject({ code: "charity_share_unset" });
    await setSetting(w.db, "poolCharityBps", 5000);
    await expect(pool.finalizeRevenue(w.ctx, w.admin.id, r.cycle.id)).rejects.toMatchObject({ code: "not_received" });
    await pool.markRevenueReceived(w.ctx, w.admin.id, r.report.id);
    await pool.finalizeRevenue(w.ctx, w.admin.id, r.cycle.id);
    await pool.transferBudget(w.ctx, w.admin.id, r.cycle.id);
    await pool.confirmFunding(w.ctx, w.admin.id, r.cycle.id);
    await pool.finalizeSnapshot(w.ctx, w.admin.id, r.cycle.id);
    await pool.calculateAllocations(w.ctx, w.admin.id, r.cycle.id);
    return r.cycle.id;
  }

  it("equal allocation: floor(budget / eligible), integer micro-USDC, remainder carried", () => {
    expect(pool.equalSplit(1_000_000n, 3)).toEqual({ perTree: 333_333n, remainder: 1n });
    expect(pool.equalSplit(5n, 0)).toEqual({ perTree: 0n, remainder: 5n });
  });

  it("full monthly cycle: eligibility, equal shares regardless of deposit size, choices, DAO approvals, reconciliation", async () => {
    const { cause, people } = await eligiblePeople(3);
    for (const u of people.slice(0, 2)) await pool.sandboxAttest(w.ctx, u.id, u.email);
    // the third has no uniqueness attestation → not eligible
    w.advance(2 * 86400);
    const principalsBefore = await Promise.all(people.map((u) => liabilityBalance(w.db, "sandbox", acct.userPrincipal(u.id))));
    const cycleId = await runToChoosing("100.01"); // budget = 50.005 USDC
    const c = await pool.getCycle(w.ctx, cycleId);
    expect(c.simulated).toBe(true);
    expect(c.eligibleCount).toBe(2);
    expect(c.perTreeMicro).toBe(25_002_500n);
    expect(c.remainderMicro).toBe(0n);
    const allocs = await w.db.select().from(poolAllocations);
    expect(allocs.map((a) => a.amountMicro)).toEqual([25_002_500n, 25_002_500n]); // same for $20 and $520 deposits
    // golden fruit appears only now that the allocation is funded and final
    const tree = await heartTree(w.ctx, people[0].id);
    expect(tree.golden).toHaveLength(1);
    expect(tree.golden[0].canChoose).toBe(true);
    await pool.chooseCauses(w.ctx, people[0].id, allocs.find((a) => a.userId === people[0].id)!.id, [{ causeId: cause.id, bps: 10000 }]);
    await expect(pool.chooseCauses(w.ctx, people[2].id, allocs[0].id, [{ causeId: cause.id, bps: 10000 }])).rejects.toMatchObject({ code: "forbidden" });
    await expect(pool.preparePayouts(w.ctx, w.admin.id, cycleId)).rejects.toMatchObject({ code: "choice_open" });
    w.advance(4 * 86400);
    await pool.preparePayouts(w.ctx, w.admin.id, cycleId); // person 2 gets the disclosed default (helper home town)
    // multi-party approval: threshold 2 of the council
    const council = await w.user("council2@x.test");
    await w.db.update(users).set({ role: "admin" }).where(eq(users.id, council.id));
    await setSetting(w.db, "poolCouncil", `admin@hugshire.test,council2@x.test`);
    await pool.proposePayouts(w.ctx, w.admin.id, cycleId);
    const props = await w.db.query.treasuryProposals.findMany();
    expect(props).toHaveLength(1);
    await pool.approveProposal(w.ctx, { id: w.admin.id, email: "admin@hugshire.test" }, props[0].id);
    await expect(pool.approveProposal(w.ctx, { id: w.admin.id, email: "admin@hugshire.test" }, props[0].id)).rejects.toMatchObject({ code: "already_voted" });
    await expect(pool.approveProposal(w.ctx, { id: people[0].id, email: people[0].email }, props[0].id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await pool.syncPayouts(w.ctx, cycleId)).synced).toBe(0); // 1 of 2: not executed
    await pool.approveProposal(w.ctx, { id: council.id, email: "council2@x.test" }, props[0].id);
    expect((await pool.syncPayouts(w.ctx, cycleId)).synced).toBe(1);
    expect((await pool.syncPayouts(w.ctx, cycleId)).synced).toBe(0); // never paid twice
    const rec = await pool.reconcileCycle(w.ctx, w.admin.id, cycleId);
    expect(rec).toEqual({ ok: true, problems: [] });
    expect((await pool.getCycle(w.ctx, cycleId)).status).toBe("reconciled");
    // public verification: the hash recomputes from the published snapshot
    const pub = await pool.publicSnapshot(w.ctx, cycleId);
    expect(pub.recomputedHash).toBe(pub.snapshotHash);
    expect(JSON.stringify(pub, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(people[0].id);
    // strict separation: supporters' principal untouched; treasury emptied by exactly the payouts
    const principalsAfter = await Promise.all(people.map((u) => liabilityBalance(w.db, "sandbox", acct.userPrincipal(u.id))));
    expect(principalsAfter).toEqual(principalsBefore);
    expect(await accountSum(w.db, "sandbox", pool.poolAcct.treasury)).toBe(0n);
  });

  it("one person cannot claim two shares with two accounts", async () => {
    const { people } = await eligiblePeople(2);
    await pool.sandboxAttest(w.ctx, people[0].id, "same.person@x.test");
    await expect(pool.sandboxAttest(w.ctx, people[1].id, "same.person@x.test")).rejects.toMatchObject({ code: "duplicate_identity" });
    expect(await w.db.select().from(identityAttestations)).toHaveLength(1);
  });

  it("withdrawing below the minimum during the holding period loses eligibility", async () => {
    await setSetting(w.db, "poolHoldingDays", 10);
    await setSetting(w.db, "poolAccountAgeDays", 0);
    const { cause } = await w.approvedCause("Hold Town", "Holdbury");
    const u = await w.user("h@x.test");
    await w.deposit(u.id, cause.id, 50);
    await pool.sandboxAttest(w.ctx, u.id, u.email);
    w.advance(5 * 86400);
    expect((await pool.evaluateEligibility(w.ctx, u.id, w.nowRef())).reasons).toContain("held_less_than_minimum_for_10_days");
    w.advance(6 * 86400);
    expect((await pool.evaluateEligibility(w.ctx, u.id, w.nowRef())).eligible).toBe(true);
  });

  it("refuses simulated revenue in live mode and skipping cycle steps", async () => {
    await expect(pool.reportRevenue({ ...w.ctx, environment: "live" }, w.admin.id, { period: "2026-02", provider: "x", source: "simulated", externalRef: "a", grossMicro: 1n })).rejects.toMatchObject({ code: "simulated_in_live" });
    const r = await pool.reportRevenue(w.ctx, w.admin.id, { period: "2026-02", provider: "x", source: "simulated", externalRef: "a", grossMicro: 1_000_000n });
    await expect(pool.finalizeSnapshot(w.ctx, w.admin.id, r.cycle.id)).rejects.toMatchObject({ code: "bad_cycle_state" });
    const [c] = await w.db.select().from(poolCycles).where(eq(poolCycles.id, r.cycle.id));
    expect(c.status).toBe("revenue_reported");
  });
});

describe("V4 golden fruit and heart tree states", () => {
  it("red fruit reflects only real eligible yield; pending until paid", async () => {
    const { u, cause } = await supporter("t@x.test", 100);
    let t = await heartTree(w.ctx, u.id);
    expect(t.red.fruits).toEqual([]);
    w.advance(3600);
    w.lending.extra = 1_500_000n;
    await runYieldSnapshot(w.ctx);
    t = await heartTree(w.ctx, u.id);
    expect(t.red.eligibleMicro).toBe(1_500_000n);
    expect(t.red.fruits.reduce((a, b) => a + BigInt(b), 0n)).toBe(1_500_000n);
    const { createDelivery } = await import("@/server/services/deliveries");
    await createDelivery(w.ctx, { userId: u.id, causeId: cause.id, mode: "manual", idempotencyKey: "harvest-1", capMicro: 500_000n });
    t = await heartTree(w.ctx, u.id);
    expect(t.red.pendingMicro).toBe(500_000n);
    expect(t.red.eligibleMicro).toBe(1_000_000n);
    expect(t.red.deliveredMicro).toBe(0n); // "delivered" only after the payout is confirmed
    expect(t.golden).toEqual([]);
    void helperPreferences;
  });
});

describe("journey onboarding", () => {
  it("lets a brand-new player go straight to planting (no helper yet, createHelper: false)", async () => {
    const { onboard } = await import("@/server/services/journey");
    const { helpers } = await import("@/server/db/schema");
    const { cause } = await w.approvedCause();
    const u = await w.user("newbie@hugshire.test");
    await expect(onboard(w.ctx, u.id, { animal: "cat", nickname: "Miso", homeCauseId: cause.id, createHelper: false })).resolves.toBeTruthy();
    expect(await w.db.select().from(helpers).where(eq(helpers.userId, u.id))).toHaveLength(0); // the deposit creates it
    await onboard(w.ctx, u.id, { animal: "fox", nickname: "Ember", homeCauseId: cause.id });
    const hs = await w.db.select().from(helpers).where(eq(helpers.userId, u.id));
    expect(hs.map((h) => [h.animal, h.nickname])).toEqual([["fox", "Ember"]]);
  });
});

describe("Wood: harder, faster", () => {
  it("ramps quickly: still for 3 chops, then sliding targets, then double/triple bars", async () => {
    const { BAR_TIERS } = await import("@/game/v4/rules");
    expect([0, 2, 3, 9, 10, 19, 20].map(tierOf)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(barAttempt(3, 2).zoneSpeed).toBe(0);
    expect(barAttempt(3, 4).zoneSpeed).toBeGreaterThan(0); // 5th chop: the target slides
    // round 2 (chops 10–14) is Hard: double, single, double
    const r2 = woodRound(9, 2).attempts;
    expect(r2.map((a) => [a.seq, a.size])).toEqual([[0, 2], [1, 2], [0, 1], [0, 2], [1, 2]]);
    expect(r2[0].group).toBe(r2[1].group);
    expect(r2[0].zone).toBeLessThan(r2[1].zone); // targets read left → right
    expect(r2[1].speed).toBe(r2[0].speed); // one shared marker
    // round 4 (chops 20–24) is Extreme: triple then double, with a shorter timer
    const r4 = woodRound(9, 4).attempts;
    expect(r4.map((a) => a.size)).toEqual([3, 3, 3, 2, 2]);
    expect(r4[0].timeoutMs).toBe(BAR_TIERS[3].timeoutMs);
    expect(r4[0].timeoutMs!).toBeLessThan(barAttempt(9, 0).timeoutMs!);
  });

  it("multi-target bars must be hit in order on one timeline", async () => {
    const { claimedMs } = await import("@/game/v4/rules");
    const base = { tier: 2 as const, start: 0, dir: 1 as const, speed: 0.5, accel: 0, zoneSpeed: 0, zoneDir: 1 as const, yellow: 0.2, green: 0.08, group: 10, size: 2, timeoutMs: 6000 };
    const a = { ...base, n: 10, seq: 0, zone: 0.25 }; // marker reaches 0.25 at 500 ms
    const b = { ...base, n: 11, seq: 1, zone: 0.75 }; // …and 0.75 at 1500 ms
    const chart = { game: "wood" as const, round: 2, tier: 2 as const, attempts: [a, b] };
    expect(judgeRound(chart, [500, 1500]).map((j) => j.result)).toEqual(["perfect", "perfect"]);
    // second target "hit" before the first one: out of order = miss
    expect(judgeStop(b, 1500, 1600)).toMatchObject({ result: "miss", reason: "order" });
    // first target timed out: the second can't be played
    expect(judgeRound(chart, [null, 1500]).map((j) => j.result)).toEqual(["miss", "miss"]);
    // one shared timeline: the round claims 1500 ms, not 500 + 1500
    expect(claimedMs(chart, [500, 1500])).toBe(1500);
  });

  it("the fading marker is presentation only", async () => {
    const { markerHidden } = await import("@/game/v4/rules");
    const faded = { n: 0, tier: 2 as const, start: 0, dir: 1 as const, speed: 0.5, accel: 0, zone: 0.5, zoneSpeed: 0, zoneDir: 1 as const, yellow: 0.3, green: 0.1, fade: { from: 800, to: 1300 } };
    expect(markerHidden(faded, 1000)).toBe(true);
    expect(markerHidden(faded, 1400)).toBe(false);
    expect(judgeStop(faded, 1000).result).toBe("perfect"); // judged exactly the same while hidden
  });
});
