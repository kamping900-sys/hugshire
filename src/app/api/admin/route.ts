import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/server/http";
import { systemAlerts, users } from "@/server/db/schema";
import { DEFAULT_SETTINGS, audit, setSetting, type PlatformSettings } from "@/server/core";
import { JOBS, runJob, type JobName } from "@/server/jobs";
import { decideCause, decideOrganization, verifyCauseUpdate, verifyPayoutAccount } from "@/server/services/orgs";
import { releasePayout } from "@/server/services/payouts";

const reason = z.string().trim().max(500).optional();
const uuid = z.string().uuid();

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("org.decide"), id: uuid, decision: z.enum(["approved", "rejected", "suspended"]), reason }),
  z.object({ action: z.literal("org.verify_payout"), id: uuid, reason, confirmAllowlisted: z.literal(true) }),
  z.object({ action: z.literal("cause.decide"), id: uuid, decision: z.enum(["approved", "rejected", "suspended"]), reason }),
  z.object({ action: z.literal("update.verify"), id: uuid }),
  z.object({ action: z.literal("payout.release"), id: uuid }),
  z.object({ action: z.literal("alert.resolve"), id: uuid }),
  z.object({ action: z.literal("user.status"), id: uuid, status: z.enum(["active", "suspended"]), reason }),
  z.object({ action: z.literal("job.run"), name: z.enum(Object.keys(JOBS) as [JobName, ...JobName[]]) }),
  z.object({ action: z.literal("setting"), key: z.enum(Object.keys(DEFAULT_SETTINGS) as [keyof PlatformSettings, ...(keyof PlatformSettings)[]]), value: z.union([z.boolean(), z.number(), z.string()]) }),
]);

/** Every admin action goes through here: validated, role-checked, audited. */
export const POST = route({ auth: "admin", schema: action, limit: 60 }, async ({ body, user, ctx }) => {
  const adminId = user!.id;
  switch (body.action) {
    case "org.decide":
      await decideOrganization(ctx, adminId, body.id, body.decision, body.reason);
      break;
    case "org.verify_payout":
      await verifyPayoutAccount(ctx, adminId, body.id, body.reason);
      break;
    case "cause.decide":
      await decideCause(ctx, adminId, body.id, body.decision, body.reason);
      break;
    case "update.verify":
      await verifyCauseUpdate(ctx, adminId, body.id);
      break;
    case "payout.release":
      await releasePayout(ctx, body.id, adminId);
      break;
    case "alert.resolve":
      await ctx.db.update(systemAlerts).set({ resolvedAt: ctx.now() }).where(eq(systemAlerts.id, body.id));
      await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "alert.resolved", targetType: "alert", targetId: body.id });
      break;
    case "user.status":
      if (body.id === adminId) throw new Error("You cannot change your own status");
      await ctx.db.update(users).set({ status: body.status }).where(eq(users.id, body.id));
      await audit(ctx.db, { actorId: adminId, actorType: "admin", action: `user.${body.status}`, targetType: "user", targetId: body.id, data: { reason: body.reason } });
      break;
    case "job.run": {
      const r = await runJob(ctx, body.name, { force: true });
      await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "job.run", data: { name: body.name } });
      return { ok: true, result: r };
    }
    case "setting": {
      const def = DEFAULT_SETTINGS[body.key];
      if (typeof def !== typeof body.value) throw new Error(`Setting ${body.key} expects a ${typeof def}`);
      await setSetting(ctx.db, body.key, body.value as never, adminId);
      await audit(ctx.db, { actorId: adminId, actorType: "admin", action: "setting.changed", data: { key: body.key, value: body.value } });
      break;
    }
  }
  return { ok: true };
});
