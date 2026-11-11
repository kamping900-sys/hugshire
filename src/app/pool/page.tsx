import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { formatUsd } from "@/lib/money";
import { identityAttestations } from "@/server/db/schema";
import { currentUser } from "@/server/http";
import { defaultCtx } from "@/server/services/context";
import { evaluateEligibility, poolOverview } from "@/server/services/pool";
import { Badge, Card, Notice } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";

export const metadata: Metadata = { title: "Community Heart Pool" };
export const dynamic = "force-dynamic";

const REASON: Record<string, string> = {
  account_not_active: "Your account is not active.",
  uniqueness_not_verified: "Verify you're a unique person (one share per person).",
};
const reasonText = (r: string) => REASON[r] ?? (r.startsWith("account_younger") ? "Your account is newer than the minimum age." : r.startsWith("held_less") ? "Keep at least the minimum deposit for the whole holding period." : r);

export default async function PoolPage() {
  const ctx = await defaultCtx();
  const user = await currentUser();
  const o = await poolOverview(ctx);
  const me = user ? await evaluateEligibility(ctx, user.id, ctx.now()) : null;
  const [att] = user ? await ctx.db.select().from(identityAttestations).where(eq(identityAttestations.userId, user.id)) : [];
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="eyebrow">Social money</div>
      <h1 className="text-3xl font-extrabold tracking-tight">Community Heart Pool</h1>
      <p className="mt-2 text-ink-soft">
        A separate charitable treasury. A published share of the advertising revenue Hugshire actually receives is moved into it each month, split
        <b> equally</b> between eligible Heart Trees, and each supporter chooses which approved causes receive their share. It never uses anyone&apos;s
        deposit or vault yield.
      </p>
      {ctx.environment === "sandbox" && (
        <div className="mt-4">
          <Notice tone="berry" title="Test mode">Revenue here is simulated and the treasury holds independently funded test assets. Nothing on this page is real advertising income.</Notice>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs font-bold text-ink-soft">Charity share of ad revenue</div>
          <div className="num text-3xl font-extrabold">{o.charityBps ? `${(o.charityBps / 100).toFixed(2)}%` : "Not set yet"}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-bold text-ink-soft">Treasury</div>
          <div className="text-sm font-bold">{o.treasury.account}</div>
          <Badge tone={o.treasury.decentralized ? "leaf" : "berry"}>{o.treasury.decentralized ? "Sputnik DAO multisig" : "Sandbox stand-in"}</Badge>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-bold text-ink-soft">Treasury balance</div>
          <div className="num text-2xl font-extrabold">{o.treasury.balanceMicro !== null ? formatUsd(o.treasury.balanceMicro, { precise: true }) : "—"}</div>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="font-extrabold">The rules</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>Only finalized revenue that has actually been received counts. Estimates never do. No fixed amount per ad view is promised.</li>
          <li>
            Each month: <code>per_tree = floor((charity budget + carry-in) ÷ eligible supporters)</code>, in whole micro-USDC. The remainder carries to the next month.
          </li>
          <li>Your share is the same no matter your deposit size, Wood, Stone, games, ads watched, combos, wallets or workers.</li>
          <li>
            Eligibility: an active deposit of at least {formatUsd(BigInt(o.rules.minDepositMicro))} kept for {o.rules.holdingDays} days, an account at least {o.rules.accountAgeDays} days old,
            and verified uniqueness (one share per person). Corrections and appeals are handled before each snapshot is finalized.
          </li>
          <li>You have {o.rules.choiceDays} days to choose causes. {o.rules.defaultBeneficiary}</li>
          <li>The allocation is not your money: it cannot be withdrawn, transferred or traded.</li>
          <li>Payments go through treasury proposals that need council approval. Every snapshot and payout is published below.</li>
        </ul>
      </Card>

      {user && me && (
        <Card className="mt-6 p-6">
          <h2 className="font-extrabold">Your eligibility right now</h2>
          {me.eligible ? <p className="mt-2 text-sm font-bold text-[#3f7f5b]">You qualify for the next snapshot.</p> : <ul className="mt-2 list-disc pl-5 text-sm">{me.reasons.map((r) => <li key={r}>{reasonText(r)}</li>)}</ul>}
          {!att && ctx.environment === "sandbox" && (
            <div className="mt-3">
              <ActionButton path="/api/pool/attest" label="Verify I'm a unique person (sandbox stand-in)" variant="soft" />
              <p className="mt-1 text-xs text-ink-soft">Test mode only. In live mode a privacy-preserving uniqueness provider is required; Hugshire stores only a salted hash.</p>
            </div>
          )}
        </Card>
      )}

      <h2 className="mt-8 text-xl font-extrabold">Monthly cycles</h2>
      {!o.cycles.length && <p className="mt-2 text-sm text-ink-soft">No cycles yet.</p>}
      <div className="mt-3 space-y-3">
        {o.cycles.map((c) => (
          <Card key={c.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <b className="text-base">{c.period}</b>
            <Badge tone="sky">{c.status.replaceAll("_", " ")}</Badge>
            {c.simulated && <Badge tone="berry">SIMULATED</Badge>}
            <span>Budget <b className="num">{formatUsd(c.charityBudgetMicro, { precise: true })}</b></span>
            <span>{c.eligibleCount} trees × <b className="num">{formatUsd(c.perTreeMicro, { precise: true })}</b></span>
            <Link href={`/api/pool/cycles/${c.id}`} className="ml-auto font-bold text-orange-deep underline">Verify (audit JSON)</Link>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-soft">
        How to verify: download a cycle&apos;s audit JSON, check that <code>sha256(JSON.stringify(snapshot))</code> equals the published hash, find your own pseudonym (shown on
        your account), and check each payout&apos;s proposal in the treasury.
      </p>
    </div>
  );
}
