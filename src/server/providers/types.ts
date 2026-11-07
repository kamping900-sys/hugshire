/**
 * Provider abstractions. Every money-moving integration sits behind one of these
 * interfaces with two implementations: a labelled sandbox provider (no money moves)
 * and the live provider (real API / chain). Services never branch on the mode.
 */

export type OnrampSession =
  | { kind: "redirect"; url: string; partnerUserRef: string }
  | { kind: "sandbox"; url: string; partnerUserRef: string };

export interface OnrampProvider {
  readonly name: "coinbase" | "sandbox";
  /** Create a single-use checkout session that buys USDC on Base into the user's own wallet. */
  createBuySession(i: {
    depositId: string;
    userId: string;
    amountMicro: bigint;
    walletAddress: string;
    clientIp: string;
  }): Promise<OnrampSession>;
  /** Offramp (sell USDC on Base -> bank). */
  createSellSession(i: { withdrawalId: string; userId: string; walletAddress: string; clientIp: string }): Promise<OnrampSession>;
}

export type BridgeQuote = {
  depositAddress: string | null;
  amountInMicro: bigint;
  amountOutMicro: bigint;
  minAmountOutMicro: bigint;
  feeMicro: bigint;
  timeEstimateSeconds: number;
  deadline: string | null;
  raw: unknown;
};

export type BridgeStatus = {
  status: "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";
  amountOutMicro: bigint | null;
  txHashes: string[];
  raw: unknown;
};

export interface BridgeProvider {
  readonly name: "oneclick" | "sandbox";
  quote(i: {
    direction: "to_near" | "to_base";
    amountInMicro: bigint;
    recipient: string;
    refundTo: string;
    dry: boolean;
  }): Promise<BridgeQuote>;
  status(depositAddress: string): Promise<BridgeStatus>;
}

export type PoolObservation = {
  /** Total value the Vault holds in RHEA, in micro-USDC. */
  assetsMicro: bigint;
  /** Vault's own on-chain principal total (live) or ledger principal (sandbox). */
  onchainPrincipalMicro: bigint;
  supplyAprWad: bigint;
  source: "rhea_onchain" | "sandbox_simulated_from_live_apr";
  observedAt: Date;
};

export interface LendingProvider {
  readonly name: "rhea" | "sandbox";
  observe(now: Date): Promise<PoolObservation>;
  /** Current live RHEA USDC supply APR (both modes read mainnet). */
  supplyApr(): Promise<bigint>;
}

export interface PayoutProvider {
  readonly name: "vault" | "sandbox";
  /** Send `amountMicro` of yield from the Vault to an allowlisted cause account. */
  distribute(i: { payoutId: string; destination: string; amountMicro: bigint }): Promise<{ txHash: string }>;
  confirm(txHash: string): Promise<"confirmed" | "pending" | "failed">;
}

export interface WalletProvider {
  readonly name: "privy" | "sandbox";
  /** Returns the user's own wallet addresses (created on first sign-in by Privy). */
  getUserWallets(i: { userId: string; authSubject: string | null }): Promise<{ baseAddress: string | null; nearAccountId: string | null }>;
}

export type Providers = {
  onramp: OnrampProvider;
  bridge: BridgeProvider;
  lending: LendingProvider;
  payout: PayoutProvider;
  wallet: WalletProvider;
};
