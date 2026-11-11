import { z } from "zod";
import { route } from "@/server/http";
import { helperPreferences } from "@/server/db/schema";
import { parseUsd } from "@/lib/money";
import { AppError, audit, getSettings } from "@/server/core";
import { getPreferences, isDeliverable } from "@/server/services/deliveries";

const schema = z.object({
  deliveryRule: z.enum(["last_selected", "default_cause", "split", "favorite"]),
  defaultCauseId: z.string().uuid().nullable(),
  favoriteCauseId: z.string().uuid().nullable(),
  split: z.array(z.object({ causeId: z.string().uuid(), bps: z.number().int().min(0).max(10000) })).max(5),
  /** Explicit authorisation for automatic delivery. Off by default; inactivity alone never grants it. */
  autoEnabled: z.boolean(),
  autoThresholdUsd: z.string().max(12),
  autoSchedule: z.enum(["inactivity", "schedule"]).default("inactivity"),
  autoIntervalDays: z.number().int().min(1).max(90).default(7),
});

export const PUT = route({ auth: "user", schema }, async ({ body, user, ctx }) => {
  if (body.deliveryRule === "split") {
    const total = body.split.reduce((a, s) => a + s.bps, 0);
    if (total !== 10000) throw new AppError("bad_split", "Split percentages must add up to 100%.");
  }
  for (const id of [body.defaultCauseId, body.favoriteCauseId, ...body.split.map((s) => s.causeId)]) {
    if (id && !(await isDeliverable(ctx, id))) throw new AppError("cause_not_deliverable", "One of the chosen causes cannot receive deliveries.");
  }
  let threshold: bigint;
  try {
    threshold = parseUsd(body.autoThresholdUsd || "0");
  } catch {
    throw new AppError("invalid_amount", "Enter a threshold like 1 or 0.50");
  }
  const before = await getPreferences(ctx, user!.id);
  const settings = await getSettings(ctx.db);
  const wasAuthorised = Boolean(before.autoEnabled && before.autoAuthorizedAt);
  const values = {
    userId: user!.id,
    deliveryRule: body.deliveryRule,
    defaultCauseId: body.defaultCauseId,
    favoriteCauseId: body.favoriteCauseId,
    split: body.split,
    autoEnabled: body.autoEnabled,
    autoAuthorizedAt: body.autoEnabled ? (wasAuthorised ? before.autoAuthorizedAt : ctx.now()) : null,
    autoSchedule: body.autoSchedule,
    autoIntervalSeconds: body.autoIntervalDays * 86400,
    autoThresholdMicro: threshold,
    inactivityTimeoutSeconds: settings.defaultInactivitySeconds,
    updatedAt: ctx.now(),
  };
  await ctx.db.insert(helperPreferences).values(values).onConflictDoUpdate({ target: helperPreferences.userId, set: values });
  if (body.autoEnabled !== wasAuthorised) {
    await audit(ctx.db, {
      actorId: user!.id,
      actorType: "user",
      action: body.autoEnabled ? "auto_delivery.authorised" : "auto_delivery.revoked",
      targetType: "user",
      targetId: user!.id,
      data: { schedule: body.autoSchedule, intervalDays: body.autoIntervalDays },
    });
  }
  return { ok: true };
});
