import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/server/db/client";
import { organizations, userProfiles, users } from "@/server/db/schema";
import { accountSum, acct, setSetting } from "@/server/core";
import { resetEnvForTests } from "@/server/env";
import type { Ctx } from "@/server/services/context";
import type { Providers } from "@/server/providers/types";
import { SandboxBridge, SandboxOnramp, SandboxWallets } from "@/server/providers/sandbox";
import { createCause, createOrganization, decideCause, decideOrganization, setPayoutAccount, verifyPayoutAccount } from "@/server/services/orgs";
import { createDeposit } from "@/server/services/deposits";
import { completeSandboxCheckout, processDeposits } from "@/server/services/processor";

export const T0 = new Date("2026-01-01T00:00:00Z");

/** Test pool: observed value = booked ledger value + whatever yield the test injects. No randomness. */
export class FakeLending {
  readonly name = "sandbox" as const;
  extra = 0n;
  constructor(private db: () => Db) {}
  async supplyApr() {
    return 89_684_268_932_155_393n; // 8.968% as WAD (the live value read on 2026-11-07)
  }
  async observe(now: Date) {
    const booked = await accountSum(this.db(), "sandbox", acct.poolLending);
    const v = booked + this.extra;
    this.extra = 0n; // injected yield is "observed" once, then becomes booked
    return { assetsMicro: v, onchainPrincipalMicro: 0n, supplyAprWad: await this.supplyApr(), source: "sandbox_simulated_from_live_apr" as const, observedAt: now };
  }
}

export class FakePayout {
  readonly name = "sandbox" as const;
  calls: { payoutId: string; destination: string; amountMicro: bigint }[] = [];
  failNext = 0;
  outcome: "confirmed" | "pending" | "failed" = "confirmed";
  async distribute(i: { payoutId: string; destination: string; amountMicro: bigint }) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("simulated RPC failure");
    }
    this.calls.push(i);
    return { txHash: `tx-${i.payoutId}-${this.calls.length}` };
  }
  async confirm() {
    return this.outcome;
  }
}

export type World = Awaited<ReturnType<typeof makeWorld>>;

export async function makeWorld() {
  resetEnvForTests({ HUGSHIRE_MODE: "sandbox", AUTH_PROVIDER: "dev", ADMIN_EMAILS: "admin@hugshire.test", NODE_ENV: "test" });
  const { db, close } = await openDb("pglite:memory");
  let now = new Date(T0);
  const lending = new FakeLending(() => db);
  const payout = new FakePayout();
  const p: Providers = {
    onramp: new SandboxOnramp("http://localhost:3200"),
    bridge: new SandboxBridge(),
    lending,
    payout,
    wallet: new SandboxWallets(),
  };
  const ctx: Ctx = { db, environment: "sandbox", now: () => new Date(now), p };
  await setSetting(db, "yieldSettlementSeconds", 0);
  await setSetting(db, "minDepositMicro", "1000000");

  const advance = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000);
    return now;
  };

  async function user(email: string) {
    const [u] = await db.insert(users).values({ email, authProvider: "dev", role: email.startsWith("admin") ? "admin" : "user" }).returning();
    await db.insert(userProfiles).values({ userId: u.id, displayName: email.split("@")[0], riskAcknowledgedAt: now });
    return u;
  }

  const admin = await user("admin@hugshire.test");
  const orgOwner = await user("owner@shelter.test");

  /** An approved organisation with a verified receiving account and an approved cause. */
  async function approvedCause(name = "Paws Shelter", city = "Pawsbury") {
    const org = await createOrganization(ctx, orgOwner.id, { name, description: "", contactEmail: "hi@shelter.test" });
    await decideOrganization(ctx, admin.id, org.id, "approved");
    await setPayoutAccount(ctx, orgOwner.id, org.id, `${org.slug}.near`);
    await verifyPayoutAccount(ctx, admin.id, org.id);
    const cause = await createCause(ctx, orgOwner.id, org.id, {
      title: `${name} rebuild`,
      summary: "A warm place for animals waiting for homes.",
      description: "",
      category: "animals",
      cityName: city,
      goalUsd: 1000,
    });
    await decideCause(ctx, admin.id, cause.id, "approved");
    const [o] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    return { org: o, cause };
  }

  /** Full sandbox deposit: checkout + processor until supplied. */
  async function deposit(userId: string, causeId: string, usd: number, key = `dep-${Math.random()}`) {
    const r = await createDeposit(ctx, {
      userId,
      causeId,
      amountMicro: BigInt(usd) * 1_000_000n,
      animal: "otter",
      nickname: "Pip",
      idempotencyKey: key,
      clientIp: "127.0.0.1",
    });
    await completeSandboxCheckout(ctx, r.deposit.id, userId);
    for (let k = 0; k < 4; k++) await processDeposits(ctx);
    return r.deposit.id;
  }

  return { db, ctx, close, lending, payout, advance, user, admin, orgOwner, approvedCause, deposit, nowRef: () => now };
}
