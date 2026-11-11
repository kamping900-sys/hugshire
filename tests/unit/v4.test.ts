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
  judgeStone,
  judgeWood,
  pickResource,
  stoneRound,
  tierOf,
  woodRound,
  type WoodRound,
} from "@/game/v4/rules";
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
  it("$10 earns 0.01 per Hit; Perfect is 2×; no deposit earns nothing", () => {
    expect(baseReward(10_000_000n)).toBe(10_000n); // 0.01 × 1e6
    expect(actionReward(baseReward(10_000_000n), "perfect", 1)).toBe(20_000n);
    expect(baseReward(0n)).toBe(0n);
    expect(baseReward(999_999n)).toBe(0n); // below $1
  });
  it("is linear to $1,000, then diminishing (√)", () => {
    expect(baseReward(1_000_000_000n)).toBe(RES_UNIT); // $1,000 → 1 per Hit
    expect(baseReward(4_000_000_000n)).toBe(2n * RES_UNIT); // 4× money → 2×
    expect(baseReward(100_000_000_000n)).toBe(10n * RES_UNIT); // 100× → 10×
    // splitting within the knee never helps
    expect(baseReward(500_000_000n) * 2n).toBe(baseReward(1_000_000_000n));
  });
  it("combo is bounded at 2×", () => {
    expect(comboBps(1)).toBe(10_000n);
    expect(comboBps(11)).toBe(15_000n);
    expect(comboBps(500)).toBe(20_000n);
  });
  it("server picks the resource: both missing → random, one done → the other, cooling → other, all cooling → wait", () => {
    const none = { wood: null, stone: null };
    expect(pickResource({ wood: true, stone: true }, none, 0, 0.2)).toEqual({ kind: "play", resource: "wood" });
    expect(pickResource({ wood: true, stone: true }, none, 0, 0.8)).toEqual({ kind: "play", resource: "stone" });
    expect(pickResource({ wood: false, stone: true }, none, 0, 0.2)).toEqual({ kind: "play", resource: "stone" });
    expect(pickResource({ wood: true, stone: true }, { wood: 100, stone: null }, 0, 0.1)).toEqual({ kind: "play", resource: "stone" });
    expect(pickResource({ wood: true, stone: true }, { wood: 100, stone: 50 }, 0, 0.1)).toEqual({ kind: "wait", untilMs: 50 });
    expect(pickResource({ wood: false, stone: false }, none, 0, 0.1)).toEqual({ kind: "done" });
  });
});

describe("V4 Wood: player-driven rhythm with fake-outs (no memorisation)", () => {
  const chart: WoodRound = {
    game: "wood",
    round: 0,
    tier: 0,
    durationMs: 4000,
    events: [
      { i: 0, t: 1000, kind: "log", variant: "normal", approachMs: 1000, zoneAt: 0.7, perfectMs: 50, hitMs: 140 },
      { i: 1, t: 2000, kind: "fake", variant: "normal", approachMs: 1000, zoneAt: 0.7, perfectMs: 50, hitMs: 140, tellAt: 0.4 },
      { i: 2, t: 3000, kind: "log", variant: "fast", approachMs: 1000, zoneAt: 0.7, perfectMs: 50, hitMs: 140 },
    ],
  };
  it("holding back on a fake-out is a read that keeps the combo", () => {
    const { judgements } = judgeWood(chart, [1000, 3100]);
    expect(judgements.map((j) => j.result)).toEqual(["perfect", "fake_read", "hit"]);
    const r = applyRound({ hearts: 3, combo: 0, bestCombo: 0, earnedMicro: 0n }, judgements, 1000n, 10n ** 12n);
    expect(r.state.combo).toBe(2);
    expect(r.state.hearts).toBe(3);
    // the fake-out itself pays nothing
    expect(r.applied.find((a) => a.result === "fake_read")!.rewardMicro).toBe(0n);
  });
  it("swinging at a fake-out is a Miss: lose a heart, combo resets", () => {
    const { judgements } = judgeWood(chart, [1000, 2000, 3000]);
    expect(judgements.find((j) => j.ref === 1)).toMatchObject({ result: "miss", reason: "fake_swing" });
    const r = applyRound({ hearts: 3, combo: 0, bestCombo: 0, earnedMicro: 0n }, judgements, 1000n, 10n ** 12n);
    expect(r.state.hearts).toBe(2);
    expect(r.state.bestCombo).toBe(1);
  });
  it("missing a real log and stray swings are Misses; three Misses end the game, keeping what was earned", () => {
    const { judgements } = judgeWood(chart, [1000, 1600, 2600]);
    const r = applyRound({ hearts: 3, combo: 0, bestCombo: 0, earnedMicro: 0n }, judgements, 1000n, 10n ** 12n);
    expect(r.state.hearts).toBe(0);
    expect(r.stopped).toBe("hearts");
    expect(r.state.earnedMicro).toBe(2000n); // the Perfect before Game Over is preserved
  });
  it("charts are deterministic, fair (no overlapping windows) and get harder", () => {
    expect(woodRound(42, 4)).toEqual(woodRound(42, 4));
    for (const round of [0, 2, 5, 8, 14]) {
      const c = woodRound(7, round);
      for (let k = 1; k < c.events.length; k++) expect(c.events[k].t - c.events[k - 1].t).toBeGreaterThanOrEqual(c.events[k].hitMs * 2 + 120);
      expect(c.events.some((e) => e.kind === "log")).toBe(true);
    }
    expect(woodRound(7, 0).events.every((e) => e.kind === "log")).toBe(true); // no fakes at first
    expect(woodRound(7, 2).events.filter((e) => e.kind === "fake")).toHaveLength(1); // gentle introduction
    expect(woodRound(7, 12).events[0].hitMs).toBeLessThan(woodRound(7, 0).events[0].hitMs);
  });
});

describe("V4 Stone: call-and-response memory, up to four buttons", () => {
  it("NPC demonstrates, player repeats: right button AND right time", () => {
    const c = stoneRound(99, 7);
    const perfect = c.expected.map((e) => ({ t: e.t, b: e.b }));
    expect(judgeStone(c, perfect).judgements.every((j) => j.result === "perfect")).toBe(true);
    const wrong = perfect.map((x, i) => (i === 1 ? { ...x, b: (x.b + 1) % c.buttons || (c.buttons > 1 ? 1 : 0) } : x));
    if (c.buttons > 1) expect(judgeStone(c, wrong).judgements.find((j) => j.ref === 1)).toMatchObject({ result: "miss", reason: "wrong_button" });
    const late = perfect.map((x, i) => (i === 0 ? { ...x, t: x.t + c.hitMs + 200 } : x));
    expect(judgeStone(c, late).judgements.some((j) => j.result === "miss")).toBe(true);
  });
  it("progresses from 1 button to at most 4, with longer patterns", () => {
    expect(stoneRound(1, 0).buttons).toBe(1);
    expect(stoneRound(1, 4).buttons).toBe(2);
    expect(Math.max(...Array.from({ length: 30 }, (_, r) => stoneRound(3, r).buttons))).toBe(4);
    for (let r = 0; r < 30; r++) expect(stoneRound(5, r).demo.every((n) => n.b < 4)).toBe(true);
    expect(stoneRound(1, 12).demo.length).toBeGreaterThan(stoneRound(1, 0).demo.length);
    expect(tierOf(12)).toBe(3);
  });
  it("Wood and Stone are mechanically distinct: Stone has a demonstration, Wood has none", () => {
    expect("demo" in stoneRound(1, 0)).toBe(true);
    expect("demo" in woodRound(1, 0)).toBe(false);
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
    await expect(startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p6", blueprintKey: "tent" })).rejects.toMatchObject({ code: "one_project" });
    await expect(startProject(w.ctx, b.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "gazebo" })).rejects.toMatchObject({ code: "plot_taken" });
    const noDeposit = await w.user("c@x.test");
    await expect(startProject(w.ctx, noDeposit.id, { causeId: cause.id, plotKey: "p6", blueprintKey: "tent" })).rejects.toMatchObject({ code: "not_eligible" });
  });

  it("contributions are idempotent, clamped to the requirement, and complete the building", async () => {
    const { u, cause } = await supporter("a@x.test", 100);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "tent" }); // 180 W / 40 S
    const c1 = await contribute(w.ctx, { projectId: p.id, userId: u.id, resource: "wood", amountMicro: 500n * RES_UNIT, source: "minigame", refKey: "s1" });
    expect(c1.appliedMicro).toBe(180n * RES_UNIT);
    const again = await contribute(w.ctx, { projectId: p.id, userId: u.id, resource: "wood", amountMicro: 500n * RES_UNIT, source: "minigame", refKey: "s1" });
    expect(again.replay).toBe(true);
    const c2 = await contribute(w.ctx, { projectId: p.id, userId: u.id, resource: "stone", amountMicro: 40n * RES_UNIT, source: "minigame", refKey: "s2" });
    expect(c2.completed).toBe(true);
    // the creator is free to start another one now
    await expect(startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p6", blueprintKey: "cottage" })).resolves.toBeTruthy();
  });

  it("idle reservations expire after 24h; started projects stay completable", async () => {
    const { u, cause } = await supporter("a@x.test", 100);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "tent" });
    w.advance(25 * 3600);
    expect((await expireReservations(w.ctx)).expired).toBe(1);
    const [row] = await w.db.select().from(constructionProjects).where(eq(constructionProjects.id, p.id));
    expect(row.status).toBe("expired");
    const p2 = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p5", blueprintKey: "gazebo" });
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
    await expect(startSession(w.ctx, poor.id, proj.id)).rejects.toMatchObject({ code: "not_eligible" });
    const { u, p } = { u: (await w.db.select().from(users).where(eq(users.email, "a@x.test")))[0], p: proj };
    const s = await startSession(w.ctx, u.id, p.id);
    expect(s.kind).toBe("play");
    if (s.kind !== "play") return;
    expect(["wood", "stone"]).toContain(s.session.resource);
    expect(JSON.stringify(s.session, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain('"seed"');
    expect(s.session.baseRewardMicro).toBe(RES_UNIT); // $1,000 → 1 per Hit
  });

  it("judges raw timings, refuses too-fast and replayed rounds, commits once, then 5-minute cooldown per resource", async () => {
    const { u, p } = await playable();
    const s = await startSession(w.ctx, u.id, p.id);
    if (s.kind !== "play") throw new Error("expected play");
    const chart = s.session.chart!;
    const perfectInput =
      chart.game === "wood"
        ? { swings: chart.events.filter((e) => e.kind === "log").map((e) => e.t + 7 * ((e.i % 3) - 1)) }
        : { strikes: chart.expected.map((e, i) => ({ t: e.t + 9 * ((i % 3) - 1), b: e.b })) };
    await expect(submitRound(w.ctx, u.id, s.session.id, { round: 0, ...perfectInput })).rejects.toMatchObject({ code: "too_fast" });
    w.advance(Math.ceil(chart.durationMs / 1000));
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
    // independent cooldowns: the same resource waits 5 minutes, the other is free
    const cd = await cooldowns(w.ctx, u.id);
    expect(cd[s.session.resource]).toBeGreaterThan(w.nowRef().getTime());
    const other = s.session.resource === "wood" ? "stone" : "wood";
    expect(cd[other]).toBeNull();
    const next = await startSession(w.ctx, u.id, p.id);
    expect(next.kind === "play" && next.session.resource).toBe(other);
    await quitSession(w.ctx, u.id, (next as { session: { id: string } }).session.id);
    const wait = await startSession(w.ctx, u.id, p.id);
    expect(wait.kind).toBe("wait");
    w.advance(RULES.cooldownSeconds + 1);
    expect((await startSession(w.ctx, u.id, p.id)).kind).toBe("play");
  });

  it("caps a session at 1,000 resources (Perfect and combo count) and never trusts client rewards", async () => {
    const { u, cause } = await supporter("rich@x.test", 2500);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p1", blueprintKey: "townHall" });
    // force a huge base reward to hit the cap quickly
    const s = await startSession(w.ctx, u.id, p.id);
    if (s.kind !== "play") throw new Error();
    await w.db.update(gameSessions).set({ baseRewardMicro: 400n * RES_UNIT }).where(eq(gameSessions.id, s.session.id));
    let cur = s.session;
    for (let k = 0; k < 6 && cur.status === "open"; k++) {
      const chart = cur.chart!;
      const input =
        chart.game === "wood"
          ? { swings: chart.events.filter((e) => e.kind === "log").map((e) => e.t + 11 * ((e.i % 3) - 1)) }
          : { strikes: chart.expected.map((e, i) => ({ t: e.t + 13 * ((i % 3) - 1), b: e.b })) };
      w.advance(Math.ceil(chart.durationMs / 1000) + 1);
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

describe("V4 auto workers", () => {
  it("produce ~25× slower than baseline manual play, hourly and idempotently, only with a deposit", async () => {
    const { u, cause } = await supporter("a@x.test", 1000);
    const p = await startProject(w.ctx, u.id, { causeId: cause.id, plotKey: "p1", blueprintKey: "school" });
    expect((await runAutoWorkers(w.ctx)).applied).toBe(1);
    expect((await runAutoWorkers(w.ctx)).applied).toBe(0); // same hour: no double production
    const [row] = await w.db.select().from(constructionProjects).where(eq(constructionProjects.id, p.id));
    expect(row.woodContributed + row.stoneContributed).toBe(RES_UNIT * RULES.autoBasePerHour);
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
