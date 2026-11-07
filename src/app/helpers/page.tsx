import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { causes, cities, helpers } from "@/server/db/schema";
import { currentUser } from "@/server/http";
import { defaultCtx } from "@/server/services/context";
import { effectiveMode, getPreferences } from "@/server/services/deliveries";
import { ButtonLink, Empty, PageHeader } from "@/components/ui";
import { HelperCard } from "./HelperCard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My helpers" };

export default async function Helpers() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/helpers");
  const ctx = await defaultCtx();
  const prefs = await getPreferences(ctx, user.id);
  const rows = await ctx.db
    .select({ h: helpers, cityName: cities.name, slug: causes.slug })
    .from(helpers)
    .innerJoin(causes, eq(causes.id, helpers.causeId))
    .innerJoin(cities, eq(cities.causeId, causes.id))
    .where(eq(helpers.userId, user.id));
  const now = ctx.now();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader eyebrow="My helpers" title="The friends working in your towns" actions={<ButtonLink href="/deliveries" variant="secondary">Auto-delivery rules</ButtonLink>}>
        You get one helper for each deposit. Helpers are your presence in a town; they never change how much your money earns.
      </PageHeader>
      {rows.length === 0 ? (
        <Empty title="No helpers yet" action={<ButtonLink href="/explore">Pick a cause</ButtonLink>}>
          Support a town and your first helper moves in once your deposit is earning.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ h, cityName, slug }) => {
            const c = effectiveMode(h, prefs.inactivityTimeoutSeconds, now);
            return (
              <HelperCard
                key={h.id}
                id={h.id}
                animal={h.animal}
                nickname={h.nickname}
                cityName={cityName}
                citySlug={slug}
                preference={h.controlPreference}
                mode={c.mode}
                reason={c.reason}
                idleMinutes={c.idleSeconds === null ? null : Math.floor(c.idleSeconds / 60)}
                timeoutMinutes={Math.round(prefs.inactivityTimeoutSeconds / 60)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
