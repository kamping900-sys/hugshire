import Link from "next/link";
import { ANIMAL_LIST, ANIMALS } from "@/lib/animals";
import { formatUsd } from "@/lib/money";
import { AnimalAvatar, Badge, ButtonLink, StageBar } from "@/components/ui";
import { HeroScene } from "@/components/HeroScene";
import { defaultCtx } from "@/server/services/context";
import { listPublicCauses } from "@/server/services/orgs";

export const dynamic = "force-dynamic";

const steps = [
  { n: 1, title: "Pick a cause", body: "Every cause has its own little town. Explore the world map and choose one you care about.", animal: "cat" as const },
  { n: 2, title: "Add money", body: "Pay by card through Coinbase. Your money becomes USDC and is lent through RHEA on NEAR.", animal: "otter" as const },
  { n: 3, title: "Get a helper", body: "A cozy animal moves into the town and starts clearing land, building and carrying parcels.", animal: "bunny" as const },
  { n: 4, title: "Yield does the good", body: "The interest your money earns is delivered to causes — by you, or automatically when you're away.", animal: "fox" as const },
];

export default async function Home() {
  const ctx = await defaultCtx();
  const causes = (await listPublicCauses(ctx)).slice(0, 3);
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 pt-12 md:grid-cols-[1.05fr_1fr] md:pt-20">
          <div>
            <Badge tone="orange">A cozy world for real causes</Badge>
            <h1 className="mt-5 text-[44px] font-extrabold leading-[1.02] tracking-tight sm:text-6xl">
              Where kindness
              <br />
              <span className="text-orange">takes shape.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-soft">
              Put money to work for a cause without giving it away. Your deposit stays yours. The yield it earns helps rebuild a little town — and the real organisation behind it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/explore" sz="lg">
                Explore the world
              </ButtonLink>
              <ButtonLink href="/how-it-works" variant="secondary" sz="lg">
                How the money works
              </ButtonLink>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
              <span>• Withdraw your principal later</span>
              <span>• Only yield goes to causes</span>
              <span>• Every payout is traceable</span>
            </div>
          </div>
          <div className="floaty">
            <HeroScene />
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="eyebrow">How it works</div>
        <h2 className="mt-2 max-w-xl text-3xl font-extrabold tracking-tight">Four steps, and then your helper takes it from there.</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="card p-6">
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-soft text-sm font-extrabold text-orange-deep">{s.n}</span>
                <AnimalAvatar kind={s.animal} size={52} />
              </div>
              <div className="mt-4 text-lg font-bold">{s.title}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Money flow */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="card overflow-hidden">
          <div className="grid gap-0 md:grid-cols-[1fr_1.3fr]">
            <div className="bg-orange-soft/50 p-8">
              <div className="eyebrow">Where your money goes</div>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight">Your principal works. The yield gives.</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                Hugshire never asks you to donate your deposit. It is supplied to a lending market, and only what it earns is delivered to causes. You can ask for your principal back at any time; it returns at its real value, after fees, when the route allows.
              </p>
              <Link href="/how-it-works" className="mt-5 inline-block text-sm font-bold text-orange-deep hover:underline">
                Read the full money model →
              </Link>
            </div>
            <ol className="grid gap-3 p-8 text-sm sm:grid-cols-2">
              {[
                ["You add dollars", "Card or Apple Pay via Coinbase Onramp"],
                ["It becomes USDC", "A dollar stablecoin, in your own wallet"],
                ["It travels to NEAR", "Bridged with NEAR Intents"],
                ["It is lent on RHEA", "Pooled in the Hugshire Vault contract"],
                ["Yield accrues", "Variable — measured, never promised"],
                ["Yield is delivered", "To the causes you pick, when you choose"],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3 rounded-2xl border border-line-soft bg-cream/60 p-3.5">
                  <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-extrabold text-orange-deep shadow-sm">{i + 1}</span>
                  <span>
                    <span className="block font-bold">{t}</span>
                    <span className="text-ink-soft">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Cities */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Towns in Hugshire</div>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Every cause starts as an abandoned plot.</h2>
          </div>
          <ButtonLink href="/explore" variant="secondary">
            See the whole map
          </ButtonLink>
        </div>
        {causes.length ? (
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {causes.map((c) => (
              <Link key={c.cause.id} href={`/city/${c.cause.slug}`} className="card group p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
                <div className="flex items-center justify-between">
                  <Badge tone="sky">{c.stage.name}</Badge>
                  {c.org.isSample && <Badge tone="ink">Sample</Badge>}
                </div>
                <div className="mt-4 text-xl font-extrabold">{c.city.name}</div>
                <div className="text-sm font-semibold text-ink-soft">{c.cause.title}</div>
                <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{c.cause.summary}</p>
                <div className="mt-4">
                  <StageBar index={c.stage.index} progressBps={c.stage.progressBps} />
                </div>
                <div className="mt-3 flex justify-between text-xs text-ink-soft">
                  <span>{c.stats.helpers} helpers</span>
                  <span className="num">{formatUsd(c.stats.paidMicro, { precise: true })} yield delivered</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-ink-soft">The first towns are being reviewed. Check back soon.</p>
        )}
      </section>

      {/* Helpers */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="card p-8">
          <div className="grid items-center gap-8 md:grid-cols-[1fr_1.4fr]">
            <div>
              <div className="eyebrow">Meet the helpers</div>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight">Choose the animal that moves into town for you.</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                Steer your helper yourself and carry parcels to the Cause Hall — or let it work on its own. Playing never changes how much your money earns. It only decides when, and where, your earned yield is delivered.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {ANIMAL_LIST.map((a) => (
                <div key={a} className="flex flex-col items-center rounded-2xl bg-cream/70 p-3">
                  <AnimalAvatar kind={a} size={64} />
                  <div className="mt-1 text-sm font-bold">{ANIMALS[a].label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Honesty */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <div className="font-bold">What is real</div>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
              <li>Your deposit, its current value, and your withdrawals</li>
              <li>The yield the lending market actually paid</li>
              <li>Every delivery and payout to an organisation, with its transaction</li>
            </ul>
          </div>
          <div className="card p-6">
            <div className="font-bold">What is symbolic</div>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
              <li>Helpers, parcels, chopping and building in the towns</li>
              <li>A town's stage reflects real yield delivered, not a finished real-world project</li>
              <li>Real-world progress appears only as updates verified by Hugshire</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-6">
        <div className="flex flex-col items-start justify-between gap-4 rounded-[28px] bg-ink p-8 text-cream md:flex-row md:items-center">
          <div>
            <div className="text-2xl font-extrabold">Run a charity or community project?</div>
            <p className="mt-1 text-cream/70">Create a cause, get your own town, and receive yield-funded support. No crypto knowledge needed.</p>
          </div>
          <ButtonLink href="/org" sz="lg">
            Start an organisation
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
