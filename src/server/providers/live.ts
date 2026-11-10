import { createHmac, timingSafeEqual } from "node:crypto";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type { Env } from "../env";
import { NearRpc, readRheaSupplied, readRheaSupplyApr } from "./near";
import type {
  BridgeProvider,
  BridgeQuote,
  BridgeStatus,
  LendingProvider,
  OnrampProvider,
  PayoutProvider,
  WalletProvider,
} from "./types";

/*
 * LIVE providers. Every call here touches a real external system.
 * Endpoints verified 2026-11-07, see docs/ARCHITECTURE.md §2.
 */

// ───────────────────────────── Coinbase Onramp / Offramp ─────────────────────────────

const CDP_HOST = "api.developer.coinbase.com";

export class CoinbaseOnramp implements OnrampProvider {
  readonly name = "coinbase" as const;
  constructor(private env: Env) {}

  private async sessionToken(address: string, clientIp: string): Promise<string> {
    const path = "/onramp/v1/token";
    const jwt = await generateJwt({
      apiKeyId: this.env.CDP_API_KEY_ID!,
      apiKeySecret: this.env.CDP_API_KEY_SECRET!,
      requestMethod: "POST",
      requestHost: CDP_HOST,
      requestPath: path,
      expiresIn: 120,
    });
    const res = await fetch(`https://${CDP_HOST}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ addresses: [{ address, blockchains: ["base"] }], assets: ["USDC"], clientIp }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Coinbase session token failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { token?: string };
    if (!j.token) throw new Error("Coinbase session token missing in response");
    return j.token;
  }

  async createBuySession(i: { depositId: string; userId: string; amountMicro: bigint; walletAddress: string; clientIp: string }) {
    const token = await this.sessionToken(i.walletAddress, i.clientIp);
    const partnerUserRef = `hs-${i.userId}`.slice(0, 49);
    const usd = (Number(i.amountMicro / 10_000n) / 100).toFixed(2); // display-only preset, not accounting
    const u = new URL("https://pay.coinbase.com/buy/select-asset");
    u.searchParams.set("sessionToken", token);
    u.searchParams.set("partnerUserRef", partnerUserRef);
    u.searchParams.set("defaultAsset", "USDC");
    u.searchParams.set("defaultNetwork", "base");
    u.searchParams.set("presetFiatAmount", usd);
    u.searchParams.set("fiatCurrency", "USD");
    u.searchParams.set("redirectUrl", `${this.env.APP_URL}/portfolio?deposit=${i.depositId}`);
    return { kind: "redirect" as const, url: u.toString(), partnerUserRef };
  }

  async createSellSession(i: { withdrawalId: string; userId: string; walletAddress: string; clientIp: string }) {
    const token = await this.sessionToken(i.walletAddress, i.clientIp);
    const partnerUserRef = `hs-${i.userId}`.slice(0, 49);
    const u = new URL("https://pay.coinbase.com/v3/sell/input");
    u.searchParams.set("sessionToken", token);
    u.searchParams.set("partnerUserRef", partnerUserRef);
    u.searchParams.set("redirectUrl", `${this.env.APP_URL}/portfolio?withdrawal=${i.withdrawalId}`);
    return { kind: "redirect" as const, url: u.toString(), partnerUserRef };
  }
}

/**
 * Verifies a CDP webhook (`X-Webhook-Signature: t=..,v0=..`), HMAC-SHA256 over `${t}.${rawBody}`,
 * with a replay window. Returns false on any mismatch.
 */
export function verifyCdpWebhook(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || !parts.v0) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(parts.v0), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ───────────────────────────── NEAR Intents 1Click ─────────────────────────────

export const ASSET_BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const ASSET_NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export class OneClickBridge implements BridgeProvider {
  readonly name = "oneclick" as const;
  constructor(private env: Env) {}

  private headers() {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.env.ONECLICK_API_KEY) h["X-API-Key"] = this.env.ONECLICK_API_KEY;
    return h;
  }

  async quote(i: { direction: "to_near" | "to_base"; amountInMicro: bigint; recipient: string; refundTo: string; dry: boolean }): Promise<BridgeQuote> {
    const body = {
      dry: i.dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: 50, // bps; stablecoin pair
      originAsset: i.direction === "to_near" ? ASSET_BASE_USDC : ASSET_NEAR_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: i.direction === "to_near" ? ASSET_NEAR_USDC : ASSET_BASE_USDC,
      amount: i.amountInMicro.toString(),
      refundTo: i.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: i.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      referral: "hugshire",
      quoteWaitingTimeMs: 3000,
    };
    const res = await fetch(`${this.env.ONECLICK_BASE_URL}/v0/quote`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`1Click quote failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    const j = JSON.parse(text) as {
      quote: { depositAddress?: string; amountIn: string; amountOut: string; minAmountOut: string; timeEstimate: number; deadline?: string };
    };
    const amountIn = BigInt(j.quote.amountIn);
    const amountOut = BigInt(j.quote.amountOut);
    return {
      depositAddress: j.quote.depositAddress ?? null,
      amountInMicro: amountIn,
      amountOutMicro: amountOut,
      minAmountOutMicro: BigInt(j.quote.minAmountOut),
      feeMicro: amountIn > amountOut ? amountIn - amountOut : 0n,
      timeEstimateSeconds: j.quote.timeEstimate,
      deadline: j.quote.deadline ?? null,
      raw: j,
    };
  }

  async status(depositAddress: string): Promise<BridgeStatus> {
    const u = new URL(`${this.env.ONECLICK_BASE_URL}/v0/status`);
    u.searchParams.set("depositAddress", depositAddress);
    const res = await fetch(u, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`1Click status failed: HTTP ${res.status}`);
    const j = (await res.json()) as {
      status: BridgeStatus["status"];
      swapDetails?: { amountOut?: string; nearTxHashes?: string[]; destinationChainTxHashes?: { hash: string }[] };
    };
    return {
      status: j.status,
      amountOutMicro: j.swapDetails?.amountOut ? BigInt(j.swapDetails.amountOut) : null,
      txHashes: [...(j.swapDetails?.nearTxHashes ?? []), ...(j.swapDetails?.destinationChainTxHashes ?? []).map((h) => h.hash)],
      raw: j,
    };
  }
}

// ───────────────────────────── Vault + RHEA ─────────────────────────────

export class VaultLending implements LendingProvider {
  readonly name = "rhea" as const;
  private rpc: NearRpc;
  constructor(private env: Env) {
    this.rpc = new NearRpc(env.NEAR_RPC_URL);
  }
  supplyApr() {
    return readRheaSupplyApr(this.rpc, this.env.RHEA_LENDING_CONTRACT, this.env.NEAR_USDC_CONTRACT);
  }
  async observe(now: Date) {
    const vault = this.env.NEAR_VAULT_CONTRACT!;
    const [supplied, idle, totals, apr] = await Promise.all([
      readRheaSupplied(this.rpc, this.env.RHEA_LENDING_CONTRACT, vault, this.env.NEAR_USDC_CONTRACT),
      Promise.resolve("0"),
      this.rpc.view<{ total_principal: string; idle: string }>(vault, "get_totals"),
      this.supplyApr(),
    ]);
    return {
      assetsMicro: supplied + BigInt(totals.idle) + BigInt(idle),
      onchainPrincipalMicro: BigInt(totals.total_principal),
      supplyAprWad: apr,
      source: "rhea_onchain" as const,
      observedAt: now,
    };
  }
}

export class VaultPayout implements PayoutProvider {
  readonly name = "vault" as const;
  private rpc: NearRpc;
  constructor(private env: Env) {
    this.rpc = new NearRpc(env.NEAR_RPC_URL);
  }
  async distribute(i: { payoutId: string; destination: string; amountMicro: bigint }) {
    // The Vault itself refuses non-allowlisted recipients and amounts above accrued yield.
    return {
      txHash: await this.rpc.functionCall({
        signerId: this.env.NEAR_OPERATOR_ACCOUNT!,
        privateKey: this.env.NEAR_OPERATOR_PRIVATE_KEY!,
        receiverId: this.env.NEAR_VAULT_CONTRACT!,
        method: "distribute_yield",
        args: { recipient: i.destination, amount: i.amountMicro.toString(), memo: i.payoutId },
        gas: 150_000_000_000_000n,
        deposit: 0n,
      }),
    };
  }
  async confirm(txHash: string) {
    const r = await this.rpc.txOutcome(txHash, this.env.NEAR_OPERATOR_ACCOUNT!);
    if (r.state === "pending") return "pending" as const;
    if (r.state === "failure") return "failed" as const;
    // distribute_yield resolves to true only when the RHEA withdraw + ft_transfer both succeeded.
    return r.returnValue === true ? ("confirmed" as const) : ("failed" as const);
  }
}

// ───────────────────────────── Privy wallets ─────────────────────────────

export class PrivyWallets implements WalletProvider {
  readonly name = "privy" as const;
  constructor(private env: Env) {}
  async getUserWallets(i: { userId: string; authSubject: string | null }) {
    if (!i.authSubject) return { baseAddress: null, nearAccountId: null };
    // Privy REST: GET https://auth.privy.io/api/v1/users/{did} (Basic auth app id : app secret)
    // Requires PRIVY_APP_SECRET; see SETUP_GUIDE.md §3. Not wired until credentials exist.
    throw new Error("Privy wallet lookup needs PRIVY_APP_SECRET and the client SDK (SETUP_GUIDE.md §3).");
  }
}
