/**
 * NEAR testnet money flow for the demo: real onchain transactions with the Hugshire Vault, a mock USDC
 * token and a mock RHEA lending pool (RHEA, NEAR Intents and Coinbase are mainnet-only, so those legs stay
 * simulated). Every player gets a small testnet wallet derived from CHAIN_WALLET_SECRET (no keys stored):
 *
 *   deposit   ops mints test USDC to the player's wallet (stands in for the bridged USDC) → the wallet sends it
 *             to the Vault (ft_transfer_call) → keeper process_deposits → keeper supply (Vault → mock RHEA)
 *   interest  the "borrowers" (ops) mint USDC into mock RHEA and accrue() raises every supplier's balance
 *   donate    the player's wallet calls vault.donate → the Vault withdraws from RHEA and pays the cause's wallet
 *   withdraw  the player's wallet calls vault.withdraw → principal returns to the player's wallet
 *
 * Testnet only: CHAIN_MODE=testnet. Nothing here ever touches mainnet.
 */
import { createHash, createHmac } from "node:crypto";
import { KeyPair, KeyPairEd25519, PublicKey } from "@near-js/crypto";
import { actionCreators, createTransaction, encodeTransaction, Signature, SignedTransaction, type Action } from "@near-js/transactions";
import { baseDecode, baseEncode } from "@near-js/utils";
import { ed25519 } from "@noble/curves/ed25519";
import { NearRpc } from "../providers/near";

export const TGAS = 10n ** 12n;
export const NEAR = 10n ** 24n;
export const MILLINEAR = 10n ** 21n;
const YOCTO = 1n;
const RHEA_EXTRA = 10n ** 12n;

export type ChainConfig = {
  rpcUrl: string;
  root: string; // owns the contracts and the Vault's owner role
  ops: string; // funds wallets, mints test USDC, admin of mock RHEA
  usdc: string;
  rhea: string;
  vault: string;
  keeper: string;
  keys: { root: string; ops: string; keeper: string };
  walletSecret: string;
};

/**
 * The app reads the testnet config from env only (CHAIN_MODE=testnet plus CHAIN_* variables; see
 * scripts/dev-chain.cjs and the Railway setup). Reading a file here made the dev bundler watch .data,
 * where the local database writes constantly, and the page refreshed in a loop.
 */
export function chainConfig(): ChainConfig | null {
  if (process.env.CHAIN_MODE !== "testnet" || !process.env.CHAIN_ROOT || !process.env.CHAIN_OPS_KEY) return null;
  const root = process.env.CHAIN_ROOT, ops = process.env.CHAIN_OPS!;
  return {
    rpcUrl: process.env.CHAIN_RPC_URL || "https://test.rpc.fastnear.com",
    root, ops,
    usdc: `usdc.${root}`, rhea: `rhea.${root}`, vault: `vault.${root}`, keeper: `keeper.${ops}`,
    keys: { root: process.env.CHAIN_ROOT_KEY!, ops: process.env.CHAIN_OPS_KEY!, keeper: process.env.CHAIN_KEEPER_KEY! },
    walletSecret: process.env.CHAIN_WALLET_SECRET!,
  };
}

/** For standalone scripts (not the app): the env variables for a saved .data/chain/config.json. */
export function chainEnvFromConfig(cfg: ChainConfig & { since?: string }): Record<string, string> {
  return {
    CHAIN_MODE: "testnet", CHAIN_RPC_URL: cfg.rpcUrl, CHAIN_ROOT: cfg.root, CHAIN_OPS: cfg.ops,
    CHAIN_ROOT_KEY: cfg.keys.root, CHAIN_OPS_KEY: cfg.keys.ops, CHAIN_KEEPER_KEY: cfg.keys.keeper,
    CHAIN_WALLET_SECRET: cfg.walletSecret, ...(cfg.since ? { CHAIN_SINCE: cfg.since } : {}),
  };
}

export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const explorerAccount = (id: string) => `https://testnet.nearblocks.io/address/${id}`;

/** The cause's testnet wallet (one per town), e.g. fernhollow.hugshire-ops-s5q1.testnet */
export const causeWallet = (cfg: ChainConfig, slug: string) => `${slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32)}.${cfg.ops}`;

/** A player's demo wallet: account id and key derived from the server secret and the user id. */
export function playerWallet(cfg: ChainConfig, userId: string) {
  const seed = createHmac("sha256", cfg.walletSecret).update(`hugshire-wallet:${userId}`).digest();
  const pub = ed25519.getPublicKey(seed);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(pub, 32);
  const key = new KeyPairEd25519(baseEncode(secret));
  const id = `p${createHash("sha256").update(userId).digest("hex").slice(0, 12)}.${cfg.ops}`;
  return { accountId: id, privateKey: key.toString(), publicKey: key.getPublicKey().toString() };
}

export class TestnetChain {
  readonly rpc: NearRpc;
  constructor(readonly cfg: ChainConfig) {
    this.rpc = new NearRpc(cfg.rpcUrl, 90_000); // send_tx waits for execution; testnet can take a while
    // public testnet RPCs rate-limit bursts: retry 429s and transient network errors with backoff
    const raw = this.rpc.call.bind(this.rpc);
    this.rpc.call = (async <T,>(method: string, params: unknown): Promise<T> => {
      for (let i = 0; ; i++) {
        try {
          return await raw<T>(method, params);
        } catch (e) {
          const s = String(e);
          const retryable = s.includes("HTTP 429") || s.includes("HTTP 502") || s.includes("HTTP 503") || s.includes("fetch failed") || (method !== "send_tx" && s.includes("TimeoutError"));
          if (!retryable || i >= 6) throw e;
          await new Promise((r) => setTimeout(r, 800 * 2 ** i));
        }
      }
    }) as typeof this.rpc.call;
  }

  /** Signs and sends any list of actions; waits until executed and throws on failure. Returns the tx hash. */
  async send(signerId: string, privateKey: string, receiverId: string, actions: Action[]): Promise<string> {
    const kp = KeyPair.fromString(privateKey as `ed25519:${string}`);
    const pub = kp.getPublicKey();
    for (let attempt = 0; attempt < 3; attempt++) {
      const ak = await this.rpc.call<{ nonce: number; block_hash: string }>("query", { request_type: "view_access_key", finality: "optimistic", account_id: signerId, public_key: pub.toString() });
      const tx = createTransaction(signerId, pub, receiverId, BigInt(ak.nonce) + 1n + BigInt(attempt), actions, baseDecode(ak.block_hash));
      const hash = createHash("sha256").update(encodeTransaction(tx)).digest();
      const signed = new SignedTransaction({ transaction: tx, signature: new Signature({ keyType: pub.keyType, data: kp.sign(new Uint8Array(hash)).signature }) });
      const txHash = baseEncode(new Uint8Array(hash)); // known before sending, so a timed-out send can be looked up
      type Outcome = { transaction: { hash: string }; status: { Failure?: unknown; SuccessValue?: string }; receipts_outcome: { outcome: { status: { Failure?: unknown } } }[] };
      let r: Outcome;
      try {
        r = await this.rpc.call<Outcome>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "EXECUTED" });
      } catch (e) {
        const s = String(e);
        if (s.includes("InvalidNonce") && attempt < 2) continue;
        if (!/HTTP 408|TimeoutError|TIMEOUT_ERROR|HTTP 50[234]/.test(s)) throw e;
        r = await this.waitTx(txHash, signerId); // the RPC gave up waiting; the transaction may still land
      }
      const failed = r.status?.Failure ?? r.receipts_outcome?.find((x) => x.outcome.status?.Failure)?.outcome.status.Failure;
      if (failed) throw new Error(`tx ${r.transaction.hash} failed: ${JSON.stringify(failed).slice(0, 400)}`);
      return r.transaction.hash;
    }
    throw new Error("unreachable");
  }

  /** Polls a transaction by hash until it has executed (or gives up after about two minutes). */
  private async waitTx<T>(txHash: string, signerId: string): Promise<T> {
    for (let i = 0; i < 40; i++) {
      try {
        return await this.rpc.call<T>("tx", { tx_hash: txHash, sender_account_id: signerId, wait_until: "EXECUTED" });
      } catch (e) {
        if (!/UNKNOWN_TRANSACTION|TIMEOUT|HTTP 408|HTTP 50[234]|TimeoutError/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw new Error(`tx ${txHash} not confirmed in time`);
  }

  call(signerId: string, key: string, receiverId: string, method: string, args: Record<string, unknown>, gasT = 100n, deposit = 0n) {
    return this.send(signerId, key, receiverId, [actionCreators.functionCall(method, args, gasT * TGAS, deposit)]);
  }

  async exists(accountId: string) {
    try {
      await this.rpc.call("query", { request_type: "view_account", finality: "optimistic", account_id: accountId });
      return true;
    } catch {
      return false;
    }
  }

  /** Creates a sub-account of `parent` with a full-access key and some NEAR for gas/storage. */
  async createSubAccount(parent: string, parentKey: string, accountId: string, publicKey: string, near: bigint) {
    return this.send(parent, parentKey, accountId, [actionCreators.createAccount(), actionCreators.transfer(near), actionCreators.addKey(PublicKey.from(publicKey), actionCreators.fullAccessKey())]);
  }

  async usdcBalance(accountId: string): Promise<bigint> {
    return BigInt(await this.rpc.view<string>(this.cfg.usdc, "ft_balance_of", { account_id: accountId }));
  }

  /** Vault member view (shares, principal, value, yield, withdrawable) with live RHEA balance. */
  async member(accountId: string) {
    const acc = await this.rpc.view<{ supplied: { balance: string }[] } | null>(this.cfg.rhea, "get_account", { account_id: this.cfg.vault });
    const rheaSupplied = (BigInt(acc?.supplied?.[0]?.balance ?? "0") / RHEA_EXTRA).toString(); // the Vault works in USDC micro-units
    return this.rpc.view<{ principal: string; value: string; yield_amount: string; withdrawable: string; donated: string; pending_deposit: string } | null>(this.cfg.vault, "get_member", { account_id: accountId, rhea_supplied: rheaSupplied });
  }

  // ── wallets ──
  async ensurePlayerWallet(userId: string) {
    const w = playerWallet(this.cfg, userId);
    const hashes: string[] = [];
    if (!(await this.exists(w.accountId))) hashes.push(await this.createSubAccount(this.cfg.ops, this.cfg.keys.ops, w.accountId, w.publicKey, 100n * MILLINEAR));
    if (!(await this.rpc.view(this.cfg.usdc, "storage_balance_of", { account_id: w.accountId })))
      hashes.push(await this.call(this.cfg.ops, this.cfg.keys.ops, this.cfg.usdc, "storage_deposit", { account_id: w.accountId }, 30n, 13n * MILLINEAR));
    // gas: NEAR reserves prepaid gas up front (300 TGas ≈ 0.3 NEAR on testnet, refunded after), so keep ~0.5 NEAR
    const acct = await this.rpc.call<{ amount: string }>("query", { request_type: "view_account", finality: "optimistic", account_id: w.accountId });
    if (BigInt(acct.amount) < 320n * MILLINEAR) hashes.push(await this.send(this.cfg.ops, this.cfg.keys.ops, w.accountId, [actionCreators.transfer(350n * MILLINEAR)]));
    return { wallet: w, hashes };
  }

  async ensureCauseWallet(slug: string) {
    const id = causeWallet(this.cfg, slug);
    if (!(await this.exists(id))) {
      const kp = KeyPairEd25519.fromRandom(); // the demo never signs for a cause wallet; it only receives
      await this.createSubAccount(this.cfg.ops, this.cfg.keys.ops, id, kp.getPublicKey().toString(), 50n * MILLINEAR);
    }
    // repair half-finished setups: USDC registration and Vault approval are checked every time
    if (!(await this.rpc.view(this.cfg.usdc, "storage_balance_of", { account_id: id })))
      await this.call(this.cfg.ops, this.cfg.keys.ops, this.cfg.usdc, "storage_deposit", { account_id: id }, 30n, 13n * MILLINEAR);
    const cause = await this.rpc.view<{ approved?: boolean } | null>(this.cfg.vault, "get_cause", { account_id: id }).catch(() => null);
    if (!cause || cause.approved === false) await this.call(this.cfg.root, this.cfg.keys.root, this.cfg.vault, "approve_cause", { account_id: id }, 30n);
    return id;
  }

  // ── money flows ──
  /** Deposit `micro` test USDC for a player: mint → wallet → Vault → process → supply to RHEA. */
  async deposit(userId: string, micro: bigint) {
    const { wallet, hashes } = await this.ensurePlayerWallet(userId);
    const mint = await this.call(this.cfg.ops, this.cfg.keys.ops, this.cfg.usdc, "mint", { account_id: wallet.accountId, amount: micro.toString() }, 30n);
    const toVault = await this.call(wallet.accountId, wallet.privateKey, this.cfg.usdc, "ft_transfer_call", { receiver_id: this.cfg.vault, amount: micro.toString(), msg: "" }, 100n, YOCTO);
    const processed = await this.call(this.cfg.keeper, this.cfg.keys.keeper, this.cfg.vault, "process_deposits", { accounts: [wallet.accountId] }, 300n);
    // process_deposits already supplies new funds to RHEA in the same transaction; only top up leftover idle USDC
    const totals = await this.rpc.view<{ idle: string }>(this.cfg.vault, "get_totals", {});
    const supplied = BigInt(totals.idle) > 0n ? await this.call(this.cfg.keeper, this.cfg.keys.keeper, this.cfg.vault, "supply", {}, 300n) : processed;
    return { wallet: wallet.accountId, setup: hashes, mint, toVault, processed, supplied };
  }

  /** Interest on mock RHEA: borrowers' USDC arrives in the pool (mint) and every supplier's balance grows. */
  async accrue(bps: number) {
    const acc = await this.rpc.view<{ supplied: { balance: string }[] } | null>(this.cfg.rhea, "get_account", { account_id: this.cfg.vault });
    const pool = BigInt(acc?.supplied?.[0]?.balance ?? "0") / RHEA_EXTRA;
    const interest = (pool * BigInt(bps)) / 10_000n + 1n;
    const mint = await this.call(this.cfg.ops, this.cfg.keys.ops, this.cfg.usdc, "mint", { account_id: this.cfg.rhea, amount: interest.toString() }, 30n);
    const accrued = await this.call(this.cfg.ops, this.cfg.keys.ops, this.cfg.rhea, "accrue", { bps }, 30n);
    return { interestMicro: interest, mint, accrued };
  }

  /** Makes sure the player's onchain yield covers `micro` (mock interest accrues until it does). */
  async ensureYield(userId: string, micro: bigint) {
    const w = playerWallet(this.cfg, userId);
    for (let i = 0; i < 4; i++) {
      const m = await this.member(w.accountId);
      const have = BigInt(m?.yield_amount ?? "0"), value = BigInt(m?.value ?? "0");
      if (have >= micro || value === 0n) return have;
      const bps = Number(((micro - have) * 10_000n) / value) + 1;
      await this.accrue(Math.min(Math.max(bps, 1), 5_000));
    }
    return BigInt((await this.member(w.accountId))?.yield_amount ?? "0");
  }

  /** The player sends `micro` of their yield to a cause's wallet (real USDC transfer, signed by the player). */
  async donate(userId: string, causeSlug: string, micro: bigint) {
    const w = playerWallet(this.cfg, userId);
    const cause = await this.ensureCauseWallet(causeSlug);
    await this.ensureYield(userId, micro);
    const hash = await this.call(w.accountId, w.privateKey, this.cfg.vault, "donate", { requests: [{ cause, amount: micro.toString() }] }, 300n, YOCTO);
    return { cause, hash };
  }

  /** The player takes principal back: Vault → RHEA withdraw → the player's wallet. */
  async withdraw(userId: string, micro: bigint | null) {
    const w = playerWallet(this.cfg, userId);
    const hash = await this.call(w.accountId, w.privateKey, this.cfg.vault, "withdraw", { amount: micro === null ? null : micro.toString() }, 300n, YOCTO);
    return { wallet: w.accountId, hash };
  }

  /** The Community Heart Pool treasury wallet (key derived from the server secret). */
  treasury() {
    return playerWallet({ ...this.cfg }, "__community-heart-pool-treasury__");
  }

  /**
   * A Community Heart Pool payout: the month's budget arrives in the treasury wallet (minted test USDC stands
   * in for the received ad revenue), then the treasury sends the cause's share to the cause's wallet.
   */
  async poolPayout(causeSlug: string, micro: bigint) {
    const t = this.treasury();
    if (!(await this.exists(t.accountId))) await this.createSubAccount(this.cfg.ops, this.cfg.keys.ops, t.accountId, t.publicKey, 300n * MILLINEAR);
    if (!(await this.rpc.view(this.cfg.usdc, "storage_balance_of", { account_id: t.accountId })))
      await this.call(this.cfg.ops, this.cfg.keys.ops, this.cfg.usdc, "storage_deposit", { account_id: t.accountId }, 30n, 13n * MILLINEAR);
    const cause = await this.ensureCauseWallet(causeSlug);
    const fund = await this.call(this.cfg.ops, this.cfg.keys.ops, this.cfg.usdc, "mint", { account_id: t.accountId, amount: micro.toString() }, 30n);
    const payout = await this.call(t.accountId, t.privateKey, this.cfg.usdc, "ft_transfer", { receiver_id: cause, amount: micro.toString(), memo: "Community Heart Pool payout" }, 30n, YOCTO);
    return { treasury: t.accountId, cause, fund, payout };
  }
}

let shared: TestnetChain | null | undefined;
/** The process-wide testnet client, or null when CHAIN_MODE isn't "testnet". */
export function testnetChain(): TestnetChain | null {
  if (shared === undefined) {
    const cfg = chainConfig();
    shared = cfg ? new TestnetChain(cfg) : null;
  }
  return shared;
}
