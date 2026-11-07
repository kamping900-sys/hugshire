import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { simpleInterest } from "@/lib/money";
import type { Db } from "../db/client";
import { lendingPositions, yieldSnapshots } from "../db/schema";
import { accountSum, acct } from "../core";
import { accountEventsBetween, accountSumAsOf, balanceSeconds } from "../services/weights";
import type {
  BridgeProvider,
  BridgeStatus,
  LendingProvider,
  OnrampProvider,
  PayoutProvider,
  WalletProvider,
} from "./types";

/*
 * SANDBOX providers. These never move money and never claim to.
 * Every record they touch is stamped environment = 'sandbox' and the UI shows a Test mode banner.
 * The only real input is the live RHEA USDC supply APR, used to simulate accrual honestly.
 */

export class SandboxOnramp implements OnrampProvider {
  readonly name = "sandbox" as const;
  constructor(private appUrl: string) {}
  async createBuySession(i: { depositId: string; userId: string }) {
    return {
      kind: "sandbox" as const,
      url: `${this.appUrl}/sandbox/checkout/${i.depositId}`,
      partnerUserRef: `sandbox-${i.userId}`,
    };
  }
  async createSellSession(i: { withdrawalId: string; userId: string }) {
    return { kind: "sandbox" as const, url: `${this.appUrl}/portfolio?withdrawal=${i.withdrawalId}`, partnerUserRef: `sandbox-${i.userId}` };
  }
}

export class SandboxBridge implements BridgeProvider {
  readonly name = "sandbox" as const;
  async quote(i: { amountInMicro: bigint }) {
    return {
      depositAddress: `sandbox-deposit-${randomBytes(6).toString("hex")}`,
      amountInMicro: i.amountInMicro,
      amountOutMicro: i.amountInMicro, // sandbox charges no fee and says so
      minAmountOutMicro: i.amountInMicro,
      feeMicro: 0n,
      timeEstimateSeconds: 5,
      deadline: null,
      raw: { sandbox: true },
    };
  }
  async status(): Promise<BridgeStatus> {
    return { status: "SUCCESS", amountOutMicro: null, txHashes: [], raw: { sandbox: true } };
  }
}

/**
 * Simulated pool. Value = what the ledger says is in the pool, plus simple interest at the
 * *live* RHEA APR on the time-weighted pool balance since the last yield snapshot.
 * Stateless: the same inputs always give the same value, so re-observing never invents yield.
 */
export class SandboxLending implements LendingProvider {
  readonly name = "sandbox" as const;
  constructor(
    private db: Db,
    private liveApr: () => Promise<bigint>,
  ) {}

  supplyApr() {
    return this.liveApr();
  }

  async observe(now: Date) {
    const apr = await this.liveApr();
    const [last] = await this.db
      .select({ end: yieldSnapshots.periodEnd })
      .from(yieldSnapshots)
      .where(eq(yieldSnapshots.environment, "sandbox"))
      .orderBy(desc(yieldSnapshots.periodEnd))
      .limit(1);
    const ledgerNow = await accountSum(this.db, "sandbox", acct.poolLending);
    let interest = 0n;
    const since = last?.end ?? (await firstEntryAt(this.db));
    if (since && since < now) {
      const opening = await accountSumAsOf(this.db, "sandbox", acct.poolLending, since);
      const events = await accountEventsBetween(this.db, "sandbox", [acct.poolLending], since, now);
      const balSecs = balanceSeconds(opening, events.map((e) => ({ at: e.at, delta: e.delta })), since, now);
      interest = simpleInterest(balSecs, apr, 1n);
    }
    const assets = ledgerNow + interest;
    const values = {
      environment: "sandbox" as const,
      vaultAccount: "sandbox-vault",
      observedAssetsMicro: assets,
      onchainPrincipalMicro: 0n,
      supplyAprWad: apr.toString(),
      lastObservedAt: now,
      updatedAt: now,
    };
    await this.db.insert(lendingPositions).values(values).onConflictDoUpdate({ target: lendingPositions.environment, set: values });
    return {
      assetsMicro: assets,
      onchainPrincipalMicro: 0n,
      supplyAprWad: apr,
      source: "sandbox_simulated_from_live_apr" as const,
      observedAt: now,
    };
  }
}

async function firstEntryAt(db: Db): Promise<Date | null> {
  const { ledgerEntries, ledgerJournals } = await import("../db/schema");
  const { and, asc } = await import("drizzle-orm");
  const r = await db
    .select({ at: ledgerEntries.createdAt })
    .from(ledgerEntries)
    .innerJoin(ledgerJournals, eq(ledgerJournals.id, ledgerEntries.journalId))
    .where(and(eq(ledgerEntries.account, acct.poolLending), eq(ledgerJournals.environment, "sandbox")))
    .orderBy(asc(ledgerEntries.createdAt))
    .limit(1);
  return r[0]?.at ?? null;
}

export class SandboxPayout implements PayoutProvider {
  readonly name = "sandbox" as const;
  async distribute(i: { payoutId: string }) {
    return { txHash: `sandbox-${i.payoutId}` };
  }
  async confirm() {
    return "confirmed" as const;
  }
}

export class SandboxWallets implements WalletProvider {
  readonly name = "sandbox" as const;
  async getUserWallets(i: { userId: string }) {
    // Not real addresses: clearly marked so nothing can ever send funds to them.
    return { baseAddress: `sandbox-base-${i.userId.slice(0, 8)}`, nearAccountId: `sandbox-near-${i.userId.slice(0, 8)}` };
  }
}
