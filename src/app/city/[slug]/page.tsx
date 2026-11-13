import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatUsd } from "@/lib/money";
import { getSettings } from "@/server/core";
import { currentUser } from "@/server/http";
import { defaultCtx } from "@/server/services/context";
import { cityHelpers, deliverableCauses, deliveryState } from "@/server/services/me";
import { getCauseBySlug, STAGES } from "@/server/services/orgs";
import { isDeliverable } from "@/server/services/deliveries";
import { Badge, ButtonLink, cx, Notice, StageBar } from "@/components/ui";
import { CityPlay } from "@/components/game/CityPlay";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const ctx = await defaultCtx();
  const c = await getCauseBySlug(ctx, (await params).slug);
  return { title: c ? `${c.city.name} · ${c.cause.title}` : "Town" };
}

export default async function CityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await defaultCtx();
  const data = await getCauseBySlug(ctx, slug);
  const user = await currentUser();
  if (!data) notFound();
  const visible = data.cause.status === "approved" && data.org.status === "approved";
  if (!visible && user?.role !== "admin") notFound();

  const settings = await getSettings(ctx.db);
  const roster = await cityHelpers(ctx, data.cause.id, user?.id ?? null);
  const state = user ? await deliveryState(ctx, user.id) : null;
  const deliverable = await isDeliverable(ctx, data.cause.id);
  const others = await deliverableCauses(ctx);
  const ser = <T,>(v: T) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <Link href="/explore" className="font-semibold hover:text-ink">
          ← World map
        </Link>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1.55fr_1fr]">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="sky">
              Stage {data.stage.index + 1} of 6 · {data.stage.name}
            </Badge>
            {!visible && <Badge tone="berry">Not public: {data.cause.status}</Badge>}
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{data.city.name}</h1>
          <div className="mt-1 font-semibold text-ink-soft">
            {data.cause.title} · by {data.org.name}
          </div>
          <div className="mt-5">
            <CityPlay
              cause={{ id: data.cause.id, title: data.cause.title, slug: data.cause.slug }}
              cityName={data.city.name}
              seed={data.city.seed}
              mapType={data.city.mapType}
              stage={data.stage.index}
              helpers={roster}
              totalHelpers={data.stats.helpers}
              renderCap={settings.helperRenderCap}
              signedIn={!!user}
              deliverable={deliverable}
              initialState={state ? ser(state) : null}
              otherCauses={others}
            />
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card p-6">
            <div className="text-sm font-semibold text-ink-soft">Real yield delivered to this cause</div>
            <div className="num mt-1 text-3xl font-extrabold text-orange-deep">{formatUsd(data.stats.paidMicro, { precise: true })}</div>
            <div className="mt-1 text-xs text-ink-soft">
              plus <span className="num">{formatUsd(data.stats.pendingMicro, { precise: true })}</span> assigned and waiting for the next payout
            </div>
            <div className="mt-5">
              <StageBar index={data.stage.index} progressBps={data.stage.progressBps} />
            </div>
            <ol className="mt-4 grid grid-cols-3 gap-1.5 text-[11px] font-semibold">
              {STAGES.map((s, i) => (
                <li key={s} className={cx("rounded-lg px-2 py-1.5 text-center", i <= data.stage.index ? "bg-orange-soft text-orange-deep" : "bg-line-soft text-ink-soft")}>
                  {s}
                </li>
              ))}
            </ol>
            <div className="mt-5 flex items-center justify-between text-sm">
              <span className="text-ink-soft">Helpers in town</span>
              <span className="num font-bold">{data.stats.helpers}</span>
            </div>
            <ButtonLink href={`/support/${data.cause.slug}`} className="mt-5 w-full" sz="lg">
              Support {data.city.name}
            </ButtonLink>
            <p className="mt-2 text-center text-xs text-ink-soft">Your deposit stays yours. Only its yield helps.</p>
          </div>

          <div className="card p-6">
            <div className="font-bold">About this cause</div>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{data.cause.description || data.cause.summary}</p>
            <div className="mt-4 border-t border-line-soft pt-4 text-sm">
              <div className="font-bold">{data.org.name}</div>
              {data.org.website && (
                <a href={data.org.website} target="_blank" rel="noopener noreferrer nofollow" className="text-orange-deep hover:underline">
                  {data.org.website.replace(/^https?:\/\//, "")}
                </a>
              )}
              <p className="mt-1 text-ink-soft">{data.org.description}</p>
            </div>
          </div>

          <div className="card p-6">
            <div className="font-bold">Updates</div>
            {data.updates.length === 0 && <p className="mt-2 text-sm text-ink-soft">No updates yet.</p>}
            <ul className="mt-3 space-y-4">
              {data.updates.map((u) => (
                <li key={u.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{u.title}</span>
                    {u.kind === "verified_progress" ? <Badge tone="leaf">Verified real-world progress</Badge> : <Badge tone="ink">From the organisation</Badge>}
                  </div>
                  <div className="text-xs text-ink-soft">{u.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}</div>
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{u.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <Notice tone="sky" title="What the town shows">
            Buildings rise as real yield is paid to this cause. They are a symbol of support, not a report of a finished real-world project. Real progress appears only in updates marked verified.
          </Notice>
        </aside>
      </div>
    </div>
  );
}
