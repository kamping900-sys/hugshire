import type { Metadata } from "next";
import { AnimalAvatar, ButtonLink, Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "How it works" };

const flow = [
  { t: "You add dollars", d: "Coinbase checkout (card or Apple Pay). You receive USDC — a dollar stablecoin — on the Base network, in a wallet that belongs to you.", who: "Coinbase Onramp" },
  { t: "USDC crosses to NEAR", d: "NEAR Intents swaps Base USDC for NEAR USDC at a quoted rate. If something fails, the bridge refunds to your Base wallet.", who: "NEAR Intents 1Click" },
  { t: "You deposit into the Vault", d: "The Hugshire Vault is a small smart contract. It records your principal under your own NEAR account and supplies the pooled USDC to RHEA lending.", who: "Hugshire Vault" },
  { t: "Borrowers pay interest", d: "RHEA lends to borrowers who post collateral. The interest they pay grows the pool. The rate changes constantly and can be very low.", who: "RHEA Finance" },
  { t: "Hugshire measures the yield", d: "Every few minutes Hugshire compares what the pool holds with what it already accounts for. Only that real difference is yield. It is shared by how much you had in, and for how long.", who: "Hugshire ledger" },
  { t: "You deliver it to causes", d: "Carry parcels to a Cause Hall, press Deliver, or let auto mode follow your rules. Deliveries are paid on chain to the organisation's verified account, in batches.", who: "You, or auto mode" },
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader eyebrow="How it works" title="The money model, in plain words">
        Hugshire is built so that your principal stays yours and only real yield reaches causes. Here is every step, including the parts that cost money or take time.
      </PageHeader>

      <ol className="relative space-y-4 border-l-2 border-dashed border-peach pl-6">
        {flow.map((f, i) => (
          <li key={f.t} className="card relative p-5">
            <span className="num absolute -left-[38px] top-5 flex h-7 w-7 items-center justify-center rounded-full bg-orange text-xs font-extrabold text-white">{i + 1}</span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-lg font-bold">{f.t}</div>
              <div className="text-xs font-bold uppercase tracking-wider text-ink-soft">{f.who}</div>
            </div>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{f.d}</p>
          </li>
        ))}
      </ol>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <div className="flex items-center gap-2">
            <AnimalAvatar kind="fox" size={40} />
            <div className="text-lg font-bold">What playing changes</div>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            <li>• <b className="text-ink">When</b> your earned yield is delivered</li>
            <li>• <b className="text-ink">Which</b> approved cause receives it</li>
          </ul>
          <div className="mt-4 text-lg font-bold">What playing never changes</div>
          <ul className="mt-2 space-y-2 text-sm text-ink-soft">
            <li>• How much yield your money earns</li>
            <li>• Your principal</li>
            <li>• Anyone else&apos;s share</li>
          </ul>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-2">
            <AnimalAvatar kind="raccoon" size={40} />
            <div className="text-lg font-bold">Auto mode</div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            If you don&apos;t play for an hour (you can change this), your helpers switch to auto. When your ready-to-deliver yield passes your threshold, auto mode delivers it — to your last cause, a default, a favourite, or split by percentage. Come back and you are in control again.
          </p>
        </div>
      </div>

      <div className="mt-12 space-y-4">
        <h2 className="text-2xl font-extrabold tracking-tight">Withdrawing</h2>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          Ask for any part of your principal at any time. From that moment it stops earning. The Vault returns it to your NEAR account, it crosses back to Base, and you can cash out through Coinbase to your bank. Each stage shows on your portfolio. The amount you receive is the real value at the time, minus the bridge and cash-out fees. If RHEA ever lost money, every supporter would share the loss in proportion; the Vault never pays some people at the cost of others.
        </p>
        <h2 className="pt-4 text-2xl font-extrabold tracking-tight">Fees</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px] text-ink-soft">
          <li>Coinbase network and card fees, shown at checkout.</li>
          <li>NEAR Intents bridge fee (about 0.01% for USDC with a partner key, plus network costs), shown in the quote.</li>
          <li>RHEA keeps part of borrower interest as protocol reserves; the supply rate shown is already after that.</li>
          <li>Hugshire currently takes no fee from your yield or principal.</li>
        </ul>
      </div>

      <div className="mt-10">
        <Notice tone="berry" title="Risks, honestly">
          Hugshire is not a bank and is not insured. Yield is variable and can be zero. Your principal is not guaranteed: it depends on RHEA, on the Hugshire Vault contract (not yet independently audited), on USDC keeping its dollar value, and on the bridge. Withdrawals can be delayed by protocol liquidity. Don&apos;t put in money you might need urgently.
        </Notice>
      </div>
      <div className="mt-8 flex gap-3">
        <ButtonLink href="/explore">Explore the world</ButtonLink>
      </div>
    </div>
  );
}
