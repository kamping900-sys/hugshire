import Link from "next/link";
import type { Metadata } from "next";
import { formatUsd } from "@/lib/money";
import { CAUSE_CATEGORIES } from "@/server/db/schema";
import { defaultCtx } from "@/server/services/context";
import { listPublicCauses } from "@/server/services/orgs";
import { Badge, cx, Empty, PageHeader, StageBar } from "@/components/ui";
import { WorldMap } from "@/components/game/WorldMap";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore the world" };

const CAT_LABEL: Record<string, string> = { education: "Education", animals: "Animals", nature: "Nature", health: "Health & care", food: "Food", community: "Community" };

export default async function Explore({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const sp = await searchParams;
  const ctx = await defaultCtx();
  const all = await listPublicCauses(ctx);
  const filtered = await listPublicCauses(ctx, { search: sp.q?.slice(0, 80), category: sp.category });
  const cities = all.map((c) => ({
    slug: c.cause.slug,
    name: c.city.name,
    x: c.city.worldX,
    y: c.city.worldY,
    stage: c.stage.index,
    mapType: c.city.mapType,
    helpers: c.stats.helpers,
    sample: c.org.isSample,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader eyebrow="The Hugshire world" title="Find a town to help">
        Each town belongs to one cause run by a verified organisation. Visit a town to meet its helpers and see how far real yield has carried it.
      </PageHeader>

      {cities.length ? <WorldMap cities={cities} className="h-[56vh] min-h-[360px]" /> : <Empty title="No towns yet">Organisations are still being reviewed.</Empty>}

      <form className="mt-8 flex flex-col gap-3 sm:flex-row" action="/explore">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search towns, causes or organisations" className="field sm:max-w-sm" aria-label="Search" />
        <div className="flex flex-wrap gap-2">
          <Link href="/explore" className={cx("rounded-full border px-3.5 py-2 text-sm font-semibold", !sp.category ? "border-orange bg-orange-soft text-orange-deep" : "border-line bg-paper")}>
            All
          </Link>
          {CAUSE_CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/explore?category=${c}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={cx("rounded-full border px-3.5 py-2 text-sm font-semibold", sp.category === c ? "border-orange bg-orange-soft text-orange-deep" : "border-line bg-paper hover:border-orange/40")}
            >
              {CAT_LABEL[c]}
            </Link>
          ))}
        </div>
      </form>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => (
          <Link key={c.cause.id} href={`/city/${c.cause.slug}`} className="card p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="orange">{CAT_LABEL[c.cause.category]}</Badge>
              <Badge tone="sky">{c.stage.name}</Badge>
              {c.org.isSample && <Badge tone="ink">Sample data</Badge>}
            </div>
            <div className="mt-3 text-xl font-extrabold">{c.city.name}</div>
            <div className="text-sm font-semibold text-ink-soft">
              {c.cause.title} · {c.org.name}
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{c.cause.summary}</p>
            <div className="mt-4">
              <StageBar index={c.stage.index} progressBps={c.stage.progressBps} />
            </div>
            <div className="mt-3 flex justify-between text-xs text-ink-soft">
              <span>{c.stats.helpers} helpers</span>
              <span className="num">{formatUsd(c.stats.paidMicro, { precise: true })} delivered</span>
            </div>
          </Link>
        ))}
      </div>
      {!filtered.length && all.length > 0 && <p className="mt-6 text-ink-soft">No towns match that search.</p>}
    </div>
  );
}
