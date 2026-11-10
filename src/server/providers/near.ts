import { createHash } from "node:crypto";
import { KeyPair } from "@near-js/crypto";
import { actionCreators, createTransaction, encodeTransaction, Signature, SignedTransaction } from "@near-js/transactions";
import { baseDecode } from "@near-js/utils";
import { decimalToWad } from "@/lib/money";

/** Minimal NEAR JSON-RPC client (view calls, tx status, signed function calls). */
export class NearRpc {
  constructor(private url: string) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "hugshire", method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`NEAR RPC HTTP ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: unknown };
    if (j.error) throw new Error(`NEAR RPC error: ${JSON.stringify(j.error).slice(0, 300)}`);
    return j.result as T;
  }

  async view<T>(accountId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await this.call<{ result: number[]; error?: string }>("query", {
      request_type: "call_function",
      finality: "final",
      account_id: accountId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    if (r.error) throw new Error(`View ${accountId}.${method} failed: ${r.error}`);
    return JSON.parse(Buffer.from(r.result).toString()) as T;
  }

  /** Final status of a transaction: "success" | "failure" | "pending". */
  async txOutcome(txHash: string, senderId: string): Promise<{ state: "success" | "failure" | "pending"; returnValue?: unknown }> {
    try {
      const r = await this.call<{
        final_execution_status?: string;
        status: { SuccessValue?: string; Failure?: unknown };
      }>("tx", { tx_hash: txHash, sender_account_id: senderId, wait_until: "FINAL" });
      if (r.status?.Failure) return { state: "failure" };
      if (r.status?.SuccessValue !== undefined) {
        const raw = Buffer.from(r.status.SuccessValue, "base64").toString();
        let returnValue: unknown = raw;
        try {
          returnValue = raw ? JSON.parse(raw) : null;
        } catch {
          /* non-JSON return */
        }
        return { state: "success", returnValue };
      }
      return { state: "pending" };
    } catch (e) {
      if (String(e).includes("UNKNOWN_TRANSACTION") || String(e).includes("TIMEOUT")) return { state: "pending" };
      throw e;
    }
  }

  /**
   * Full outcome of a transaction: signer, receiver, final status, and every EVENT_JSON log
   * emitted by `fromContract` in any receipt. Used to verify user-signed transactions before booking.
   */
  async txEvents(txHash: string, senderId: string, fromContract: string): Promise<{
    state: "success" | "failure" | "pending";
    signerId?: string;
    receiverId?: string;
    events: { event: string; data: Record<string, string> }[];
  }> {
    try {
      const r = await this.call<{
        status: { SuccessValue?: string; Failure?: unknown };
        transaction: { signer_id: string; receiver_id: string };
        receipts_outcome: { outcome: { executor_id: string; logs: string[] } }[];
      }>("tx", { tx_hash: txHash, sender_account_id: senderId, wait_until: "FINAL" });
      const events: { event: string; data: Record<string, string> }[] = [];
      for (const ro of r.receipts_outcome) {
        if (ro.outcome.executor_id !== fromContract) continue;
        for (const log of ro.outcome.logs) {
          if (!log.startsWith("EVENT_JSON:")) continue;
          try {
            const e = JSON.parse(log.slice("EVENT_JSON:".length));
            if (e.standard === "hugshire") for (const d of Array.isArray(e.data) ? e.data : [e.data]) events.push({ event: e.event, data: d });
          } catch {
            /* ignore malformed */
          }
        }
      }
      const state = r.status?.Failure ? "failure" : r.status?.SuccessValue !== undefined ? "success" : "pending";
      return { state, signerId: r.transaction.signer_id, receiverId: r.transaction.receiver_id, events };
    } catch (e) {
      if (String(e).includes("UNKNOWN_TRANSACTION") || String(e).includes("TIMEOUT")) return { state: "pending", events: [] };
      throw e;
    }
  }

  /** Sign and send one function call with a (function-call-restricted) operator key. */
  async functionCall(i: {
    signerId: string;
    privateKey: string;
    receiverId: string;
    method: string;
    args: Record<string, unknown>;
    gas: bigint;
    deposit: bigint;
  }): Promise<string> {
    const kp = KeyPair.fromString(i.privateKey as `ed25519:${string}`);
    const pub = kp.getPublicKey();
    const ak = await this.call<{ nonce: number; block_hash: string }>("query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: i.signerId,
      public_key: pub.toString(),
    });
    const tx = createTransaction(
      i.signerId,
      pub,
      i.receiverId,
      BigInt(ak.nonce) + 1n,
      [actionCreators.functionCall(i.method, i.args, i.gas, i.deposit)],
      baseDecode(ak.block_hash),
    );
    const hash = createHash("sha256").update(encodeTransaction(tx)).digest();
    const sig = kp.sign(new Uint8Array(hash));
    const signed = new SignedTransaction({
      transaction: tx,
      signature: new Signature({ keyType: pub.keyType, data: sig.signature }),
    });
    const r = await this.call<{ transaction: { hash: string } }>("send_tx", {
      signed_tx_base64: Buffer.from(signed.encode()).toString("base64"),
      wait_until: "EXECUTED_OPTIMISTIC",
    });
    return r.transaction.hash;
  }
}

// ───────────────────────────── RHEA ─────────────────────────────

const RHEA_EXTRA_DECIMALS = 12n; // verified via get_asset(USDC).config.extra_decimals on 2026-11-07

let aprCache: { at: number; wad: bigint } | undefined;

/** Reads the live USDC supply APR from RHEA mainnet (cached 10 min). */
export async function readRheaSupplyApr(rpc: NearRpc, rheaContract: string, usdc: string): Promise<bigint> {
  if (aprCache && Date.now() - aprCache.at < 600_000) return aprCache.wad;
  const asset = await rpc.view<{ supply_apr: string; config: { can_deposit: boolean; can_withdraw: boolean } }>(
    rheaContract,
    "get_asset",
    { token_id: usdc },
  );
  const wad = decimalToWad(asset.supply_apr);
  aprCache = { at: Date.now(), wad };
  return wad;
}

/** Vault's USDC supplied in RHEA, converted from RHEA's inner 18-decimal balance to micro-USDC. */
export async function readRheaSupplied(rpc: NearRpc, rheaContract: string, account: string, usdc: string): Promise<bigint> {
  const acc = await rpc.view<{ supplied: { token_id: string; balance: string }[] } | null>(rheaContract, "get_account", {
    account_id: account,
  });
  const row = acc?.supplied.find((s) => s.token_id === usdc);
  if (!row) return 0n;
  return BigInt(row.balance) / 10n ** RHEA_EXTRA_DECIMALS;
}

export const __resetAprCacheForTests = () => (aprCache = undefined);
