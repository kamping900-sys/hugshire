/**
 * Sandbox-only sample data. Refuses to run in live mode.
 * Sample organisations are fictional and flagged is_sample (admins see a "Sample" badge).
 * Sample supporters go through the real sandbox deposit flow, so the ledger stays consistent.
 * No yield is invented: it accrues over time from the live RHEA rate like any sandbox deposit.
 */
import { eq } from "drizzle-orm";
import { env } from "../src/server/env";
import { defaultCtx } from "../src/server/services/context";
import { organizations, userProfiles, users } from "../src/server/db/schema";
import { upsertUser } from "../src/server/auth";
import { setSetting } from "../src/server/core";
import { createCause, createOrganization, decideCause, decideOrganization, setPayoutAccount, verifyPayoutAccount } from "../src/server/services/orgs";
import { createDeposit } from "../src/server/services/deposits";
import { completeSandboxCheckout, processDeposits } from "../src/server/services/processor";
import type { AnimalKind } from "../src/lib/animals";

const SAMPLES = [
  {
    org: "Willowbrook Animal Haven",
    desc: "A volunteer-run shelter that rescues, treats and rehomes abandoned dogs and cats.",
    cause: { title: "Keep our rescued animals warm this winter", summary: "Insulated kennels, thick bedding and heat lamps so the 40 dogs and cats in our care stay warm while they wait for a home.", more: "Our old kennels lose heat fast once temperatures drop. Every delivery goes towards insulated kennels, washable bedding and safe heat lamps, starting with the older animals and the newest arrivals.", category: "animals" as const, cityName: "Pawsbury", goalUsd: 800 },
  },
  {
    org: "Bright Pages Reading Club",
    desc: "Volunteers who bring books and reading time to primary schools that have few of their own.",
    cause: { title: "A reading corner in every classroom", summary: "Shelves, cushions and age-right books for local primary classrooms, so children without books at home can read every day.", more: "Each corner costs about the same as a school trip and serves a whole class for years. We choose books with teachers and refresh them each term.", category: "education" as const, cityName: "Inkwell Hollow", goalUsd: 1500 },
  },
  {
    org: "Green Thread Community Gardens",
    desc: "Neighbourhood gardens where families grow fresh food together.",
    cause: { title: "Rebuild our flood-damaged garden", summary: "Spring floods washed away our riverside plots. New raised beds, tools and seedlings will let 60 families grow vegetables again.", more: "We're rebuilding the beds higher off the ground so the next flood does less damage, and replacing the tools and seed stock we lost.", category: "nature" as const, cityName: "Fernhollow", goalUsd: 1000 },
  },
  {
    org: "Full Plate Kitchen",
    desc: "A community kitchen and food bank cooking for families across the neighbourhood.",
    cause: { title: "Weekend meals for school children", summary: "Many children rely on free school lunches during the week. Every Friday we send them home with healthy meals for the weekend.", more: "Each kit holds breakfast, lunch and dinner for two days, packed by volunteers on Thursday nights and handed out quietly at school.", category: "food" as const, cityName: "Ladle Lane", goalUsd: 1200 },
  },
];

const SUPPORTERS: { email: string; animal: AnimalKind; nick: string; usd: number; city: number }[] = [
  { email: "sample-ada@hugshire.test", animal: "otter", nick: "Pebble", usd: 120, city: 0 },
  { email: "sample-ben@hugshire.test", animal: "fox", nick: "Ember", usd: 60, city: 0 },
  { email: "sample-cai@hugshire.test", animal: "bunny", nick: "Clover", usd: 250, city: 0 },
  { email: "sample-dee@hugshire.test", animal: "bear", nick: "Bramble", usd: 40, city: 1 },
  { email: "sample-eli@hugshire.test", animal: "raccoon", nick: "Tinker", usd: 75, city: 1 },
  { email: "sample-fay@hugshire.test", animal: "capybara", nick: "Yuzu", usd: 300, city: 2 },
  { email: "sample-gus@hugshire.test", animal: "dog", nick: "Waffles", usd: 90, city: 2 },
  { email: "sample-hal@hugshire.test", animal: "cat", nick: "Miso", usd: 55, city: 3 },
];

async function main() {
  if (env().HUGSHIRE_MODE !== "sandbox") throw new Error("Refusing to seed: HUGSHIRE_MODE is not sandbox.");
  const ctx = await defaultCtx();
  const existing = await ctx.db.select().from(organizations).where(eq(organizations.isSample, true));
  if (existing.length) {
    console.log("Sample data already present; nothing to do.");
    return;
  }
  // Test-mode pacing so the whole loop is visible within minutes (live keeps the safer defaults).
  await setSetting(ctx.db, "yieldSettlementSeconds", 120);
  await setSetting(ctx.db, "minPayoutMicro", "10000");
  const adminEmail = env().ADMIN_EMAILS.split(",")[0]?.trim() || "admin@hugshire.test";
  const admin = await upsertUser(ctx.db, { email: adminEmail, provider: "dev" });
  await ctx.db.update(users).set({ role: "admin" }).where(eq(users.id, admin.id));
  const owner = await upsertUser(ctx.db, { email: "sample-organiser@hugshire.test", provider: "dev" });

  const causeIds: string[] = [];
  for (const s of SAMPLES) {
    const org = await createOrganization(ctx, owner.id, { name: s.org, description: s.desc, contactEmail: "sample-organiser@hugshire.test" });
    await ctx.db.update(organizations).set({ isSample: true }).where(eq(organizations.id, org.id));
    await decideOrganization(ctx, admin.id, org.id, "approved", "Sample data for test mode");
    await setPayoutAccount(ctx, owner.id, org.id, `${org.slug.slice(0, 40)}.sample.testnet`);
    await verifyPayoutAccount(ctx, admin.id, org.id, "Sample data for test mode");
    const { more, ...causeFields } = s.cause;
    const cause = await createCause(ctx, owner.id, org.id, { ...causeFields, description: `${s.cause.summary}

${more}` });
    await decideCause(ctx, admin.id, cause.id, "approved", "Sample data for test mode");
    causeIds.push(cause.id);
  }

  for (const p of SUPPORTERS) {
    const u = await upsertUser(ctx.db, { email: p.email, provider: "dev" });
    await ctx.db.update(userProfiles).set({ riskAcknowledgedAt: new Date(), displayName: p.nick, favoriteAnimal: p.animal }).where(eq(userProfiles.userId, u.id));
    const r = await createDeposit(ctx, {
      userId: u.id,
      causeId: causeIds[p.city],
      amountMicro: BigInt(p.usd) * 1_000_000n,
      animal: p.animal,
      nickname: p.nick,
      idempotencyKey: `seed-${p.email}`,
      clientIp: "127.0.0.1",
    });
    await completeSandboxCheckout(ctx, r.deposit.id, u.id);
  }
  for (let k = 0; k < 4; k++) await processDeposits(ctx);
  console.log(`Seeded ${SAMPLES.length} sample organisations and ${SUPPORTERS.length} sample supporters (sandbox). Admin: ${adminEmail}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
