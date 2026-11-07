import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { jobRuns, lendingPositions } from "@/server/db/schema";
import { DEFAULT_SETTINGS, getSettings, type PlatformSettings } from "@/server/core";
import { env } from "@/server/env";
import { JOBS } from "@/server/jobs";
import { defaultCtx } from "@/server/services/context";
import { wadToPercentString } from "@/lib/money";
import { Badge, Card } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { SettingInput } from "./SettingInput";

export const metadata: Metadata = { title: "Admin · System health" };

const LABELS: Record<keyof PlatformSettings, string> = {
  pauseDeposits: "Pause new deposits",
  pauseWithdrawals: "Pause withdrawal requests",
  pausePayouts: "Pause payouts to causes",
  pauseAutoDelivery: "Pause auto-delivery",
  defaultInactivitySeconds: "Default inactivity timeout (s)",
  yieldSettlementSeconds: "Yield settlement window (s)",
  minPayoutMicro: "Minimum payout (micro-USDC)",
  parcelSizeMicro: "Parcel size (micro-USDC)",
  minDepositMicro: "Minimum deposit (micro-USDC)",
  maxDepositMicro: "Maximum deposit (micro-USDC)",
  helperRenderCap: "Helpers drawn per city",
  helperRule: "Helper rule",
};

export default async function Health() {
  const ctx = await defaultCtx();
  const e = env();
  const settings = await getSettings(ctx.db);
  const runs = await ctx.db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(40);
  const [lp] = await ctx.db.select().from(lendingPositions).where(eq(lendingPositions.environment, ctx.environment));
  let apr: string;
  try {
    apr = wadToPercentString(await ctx.p.lending.supplyApr());
  } catch (err) {
    apr = `unreachable (${(err as Error).message.slice(0, 60)})`;
  }
  const config: [string, boolean][] = [
    ["Coinbase CDP API key", !!e.CDP_API_KEY_ID && !!e.CDP_API_KEY_SECRET],
    ["Coinbase webhook secret", !!e.CDP_WEBHOOK_SECRET],
    ["NEAR Intents API key", !!e.ONECLICK_API_KEY],
    ["Vault contract", !!e.NEAR_VAULT_CONTRACT],
    ["Operator key", !!e.NEAR_OPERATOR_PRIVATE_KEY],
    ["Privy", !!e.PRIVY_APP_ID && !!e.PRIVY_VERIFICATION_KEY],
    ["Object storage", e.STORAGE_DRIVER === "s3" && !!e.S3_BUCKET],
    ["Alert webhook", !!e.ALERT_WEBHOOK_URL],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-6">
        <div className="flex items-center gap-2 font-bold">
          Mode <Badge tone={e.HUGSHIRE_MODE === "live" ? "berry" : "butter"}>{e.HUGSHIRE_MODE}</Badge>
        </div>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
          <dt className="text-ink-soft">RHEA USDC supply APR (live mainnet)</dt>
          <dd className="num font-bold">{apr}</dd>
          <dt className="text-ink-soft">Pool last observed</dt>
          <dd>{lp?.lastObservedAt?.toLocaleString("en-US") ?? "never"}</dd>
          {config.map(([k, ok]) => (
            <div key={k} className="contents">
              <dt className="text-ink-soft">{k}</dt>
              <dd>{ok ? <Badge tone="leaf">configured</Badge> : <Badge tone="ink">not set</Badge>}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="p-6">
        <div className="font-bold">Controls</div>
        <p className="mt-1 text-xs text-ink-soft">Every change is audit-logged. Pauses take effect immediately. The Vault has its own on-chain pause, held by the owner multisig.</p>
        <div className="mt-4 space-y-2.5">
          {(Object.keys(DEFAULT_SETTINGS) as (keyof PlatformSettings)[]).map((k) => (
            <SettingInput key={k} name={k} label={LABELS[k]} value={settings[k]} />
          ))}
        </div>
      </Card>
      <Card className="p-6 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold">Jobs</div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(JOBS) as (keyof typeof JOBS)[]).map((j) => (
              <ActionButton key={j} path="/api/admin" body={{ action: "job.run", name: j }} label={`Run ${j.replace(/_/g, " ")}`} />
            ))}
          </div>
        </div>
        <table className="table-x mt-4">
          <thead>
            <tr>
              <th>Job</th>
              <th>Started</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.name}</td>
                <td className="whitespace-nowrap text-xs">{r.startedAt.toLocaleTimeString("en-US")}</td>
                <td>
                  <Badge tone={r.status === "done" ? "leaf" : r.status === "failed" ? "berry" : "butter"}>{r.status}</Badge>
                </td>
                <td className="max-w-md truncate font-mono text-xs">{r.error ?? JSON.stringify(r.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
