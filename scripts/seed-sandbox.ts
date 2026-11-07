/**
 * Sandbox-only sample data. Refuses to run in live mode.
 * Sample organisations are flagged is_sample and shown with a "Sample" badge everywhere.
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
    org: "Willowbrook Animal Haven (sample)",
    desc: "A sample shelter used to demonstrate Hugshire in test mode.",
    cause: { title: "Warm beds for winter", summary: "Insulated kennels and bedding so every animal sleeps warm.", category: "animals" as const, cityName: "Pawsbury", goalUsd: 800 },
  },
  {
    org: "Bright Pages Reading Club (sample)",
    desc: "A sample literacy programme used to demonstrate Hugshire in test mode.",
    cause: { title: "A library corner in every classroom", summary: "Books and cozy reading nooks for early readers.", category: "education" as const, cityName: "Inkwell Hollow", goalUsd: 1500 },
  },
  {
    org: "Green Thread Community Gardens (sample)",
    desc: "A sample community garden network used to demonstrate Hugshire in test mode.",
    cause: { title: "Rebuild the riverside garden", summary: "Raised beds, tools and seedlings for a flood-damaged garden.", category: "nature" as const, cityName: "Fernhollow", goalUsd: 1000 },
  },
  {
    org: "Full Plate Kitchen (sample)",
    desc: "A sample food bank used to demonstrate Hugshire in test mode.",
    cause: { title: "Weekend meal kits", summary: "Nutritious weekend meals for families who need them.", category: "food" as const, cityName: "Ladle Lane", goalUsd: 1200 },
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
    const cause = await createCause(ctx, owner.id, org.id, { ...s.cause, description: `${s.cause.summary}\n\nThis is sample content for Hugshire's test mode. It is not a real organisation.` });
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
