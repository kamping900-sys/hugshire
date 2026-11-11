/**
 * Community Heart Pool treasury. Two implementations behind one interface:
 *
 *  - SandboxDaoTreasury: a clearly labelled stand-in that models a Sputnik DAO in the database
 *    (proposals need `threshold` distinct council approvals). It only ever holds independently
 *    funded TEST assets. It is not decentralized and is never presented as such.
 *
 *  - SputnikTreasury: a real Sputnik DAO v2 on NEAR (the contracts Trezu is built on). Hugshire's
 *    key only has the *proposer* role: it can create Transfer proposals but cannot approve them.
 *    Council members approve in Trezu (or any Sputnik UI); Sputnik executes a Transfer proposal in
 *    the same call that reaches the approval threshold. Equal allocations are computed off-chain
 *    and published (see services/pool.ts snapshot) so anyone can check each proposal's amount.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { treasuryProposals } from "../db/schema";
import { accountSum, getSettings, type Environment } from "../core";
import { env } from "../env";
import { NearRpc } from "./near";

export type ProposalStatus = "in_progress" | "approved" | "rejected" | "executed" | "failed";

export interface TreasuryProvider {
  readonly name: "sandbox_dao" | "sputnik";
  readonly decentralized: boolean;
  info(): Promise<{ account: string; threshold: number | null; council: string[]; balanceMicro: bigint | null; notes: string }>;
  /** Sandbox: move independently funded TEST assets in. Live: verify a real transfer by its tx hash + balance. */
  fund(i: { cycleId: string; amountMicro: bigint; txHash?: string }): Promise<{ txHash: string }>;
  propose(i: { payoutId: string; receiver: string; amountMicro: bigint; description: string }): Promise<{ proposalId: string }>;
  status(proposalId: string): Promise<{ status: ProposalStatus; txHash?: string | null }>;
}

export class SandboxDaoTreasury implements TreasuryProvider {
  readonly name = "sandbox_dao" as const;
  readonly decentralized = false;
  constructor(private db: Db, private environment: Environment) {}
  async info() {
    const s = await getSettings(this.db);
    const council = (s.poolCouncil.trim() ? s.poolCouncil : env().ADMIN_EMAILS).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bal = await accountSum(this.db, this.environment, "pool:treasury");
    return {
      account: "sandbox-community-treasury (test assets only)",
      threshold: Math.min(s.poolThreshold, Math.max(1, council.length)),
      council,
      balanceMicro: bal,
      notes: "Sandbox stand-in for a Sputnik DAO. Holds independently funded test assets only. Not decentralized.",
    };
  }
  async fund(i: { cycleId: string }) {
    return { txHash: `sandbox-test-funding-${i.cycleId.slice(0, 8)}` };
  }
  async propose(i: { payoutId: string; receiver: string; amountMicro: bigint; description: string }) {
    const inf = await this.info();
    const existing = await this.db.select().from(treasuryProposals).where(eq(treasuryProposals.payoutId, i.payoutId));
    if (existing.length) return { proposalId: existing[0].id };
    const [p] = await this.db
      .insert(treasuryProposals)
      .values({ environment: this.environment, provider: "sandbox_dao", kind: "transfer", description: i.description, receiver: i.receiver, amountMicro: i.amountMicro, payoutId: i.payoutId, threshold: inf.threshold ?? 1 })
      .returning();
    return { proposalId: p.id };
  }
  async status(proposalId: string) {
    const [p] = await this.db.select().from(treasuryProposals).where(and(eq(treasuryProposals.id, proposalId), eq(treasuryProposals.provider, "sandbox_dao")));
    if (!p) return { status: "failed" as const };
    return { status: p.status, txHash: p.txHash };
  }
}

type SputnikProposal = { id: number; status: string; kind: unknown; description: string };

export class SputnikTreasury implements TreasuryProvider {
  readonly name = "sputnik" as const;
  readonly decentralized = true;
  private rpc = new NearRpc(env().NEAR_RPC_URL);
  private dao = env().POOL_DAO_ACCOUNT;
  private usdc = env().NEAR_USDC_CONTRACT;
  private need() {
    if (!this.dao) throw new Error("POOL_DAO_ACCOUNT is not set: create a Sputnik DAO (e.g. in Trezu) first.");
    return this.dao;
  }
  async info() {
    const dao = this.need();
    const policy = await this.rpc.view<{ roles: { name: string; kind: { Group?: string[] } | string; permissions: string[]; vote_policy: Record<string, { threshold: unknown }> }[]; proposal_bond: string }>(dao, "get_policy");
    const council = policy.roles.flatMap((r) => (typeof r.kind === "object" && r.kind.Group && r.permissions.some((p) => p.includes("VoteApprove") || p === "*:*") ? r.kind.Group : []));
    const bal = await this.rpc.view<string>(this.usdc, "ft_balance_of", { account_id: dao });
    return { account: dao, threshold: null, council: [...new Set(council)], balanceMicro: BigInt(bal), notes: "Sputnik DAO v2. Approve proposals in Trezu or any Sputnik UI. Vote thresholds are as set in the DAO policy." };
  }
  async fund(i: { amountMicro: bigint; txHash?: string }) {
    // Hugshire never moves company money automatically; the finance team transfers USDC to the DAO
    // and records the transaction hash. We only accept it if the DAO's balance covers it.
    if (!i.txHash) throw new Error("Record the hash of the USDC transfer into the DAO.");
    const inf = await this.info();
    if ((inf.balanceMicro ?? 0n) < i.amountMicro) throw new Error("The DAO's USDC balance does not cover this cycle's budget yet.");
    return { txHash: i.txHash };
  }
  async propose(i: { payoutId: string; receiver: string; amountMicro: bigint; description: string }) {
    const dao = this.need();
    const e = env();
    if (!e.POOL_PROPOSER_ACCOUNT || !e.POOL_PROPOSER_PRIVATE_KEY) throw new Error("POOL_PROPOSER_ACCOUNT / POOL_PROPOSER_PRIVATE_KEY are not set.");
    const policy = await this.rpc.view<{ proposal_bond: string }>(dao, "get_policy");
    const hash = await this.rpc.functionCall({
      signerId: e.POOL_PROPOSER_ACCOUNT,
      privateKey: e.POOL_PROPOSER_PRIVATE_KEY,
      receiverId: dao,
      method: "add_proposal",
      args: { proposal: { description: `${i.description} [hugshire-payout:${i.payoutId}]`, kind: { Transfer: { token_id: this.usdc, receiver_id: i.receiver, amount: i.amountMicro.toString(), msg: null } } } },
      gas: 50_000_000_000_000n,
      deposit: BigInt(policy.proposal_bond),
    });
    const out = await this.rpc.txOutcome(hash, e.POOL_PROPOSER_ACCOUNT);
    if (out.state !== "success" || out.returnValue === undefined) throw new Error(`add_proposal did not succeed (${out.state}); tx ${hash}`);
    return { proposalId: String(out.returnValue) };
  }
  async status(proposalId: string) {
    const p = await this.rpc.view<SputnikProposal>(this.need(), "get_proposal", { id: Number(proposalId) });
    // Sputnik executes Transfer proposals when they reach the threshold, so "Approved" means paid.
    const map: Record<string, ProposalStatus> = { InProgress: "in_progress", Approved: "executed", Rejected: "rejected", Removed: "rejected", Expired: "rejected", Failed: "failed", Moved: "in_progress" };
    return { status: map[p.status] ?? "in_progress", txHash: null };
  }
}

export function treasury(db: Db, environment: Environment): TreasuryProvider {
  return environment === "live" ? new SputnikTreasury() : new SandboxDaoTreasury(db, environment);
}
