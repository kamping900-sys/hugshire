import type { Db } from "../db/client";
import { env, type Env } from "../env";
import { NearRpc, readRheaSupplyApr } from "./near";
import { CoinbaseOnramp, OneClickBridge, PrivyWallets, VaultLending, VaultPayout } from "./live";
import { SandboxBridge, SandboxLending, SandboxOnramp, SandboxPayout, SandboxWallets } from "./sandbox";
import type { Providers } from "./types";

let override: ((db: Db) => Providers) | undefined;

/** Tests can swap in deterministic providers. */
export function setProvidersForTests(f: ((db: Db) => Providers) | undefined) {
  override = f;
}

export function liveAprReader(e: Env) {
  const rpc = new NearRpc(e.NEAR_RPC_URL);
  return () => readRheaSupplyApr(rpc, e.RHEA_LENDING_CONTRACT, e.NEAR_USDC_CONTRACT);
}

export function providers(db: Db): Providers {
  if (override) return override(db);
  const e = env();
  if (e.HUGSHIRE_MODE === "live") {
    return {
      onramp: new CoinbaseOnramp(e),
      bridge: new OneClickBridge(e),
      lending: new VaultLending(e),
      payout: new VaultPayout(e),
      wallet: new PrivyWallets(e),
    };
  }
  return {
    onramp: new SandboxOnramp(e.APP_URL),
    bridge: new SandboxBridge(),
    lending: new SandboxLending(db, liveAprReader(e)),
    payout: new SandboxPayout(),
    wallet: new SandboxWallets(),
  };
}
