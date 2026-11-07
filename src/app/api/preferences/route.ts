import { z } from "zod";
import { route } from "@/server/http";
import { helperPreferences } from "@/server/db/schema";
import { parseUsd } from "@/lib/money";
import { AppError } from "@/server/core";
import { isDeliverable } from "@/server/services/deliveries";

const schema = z.object({
  deliveryRule: z.enum(["last_selected", "default_cause", "split", "favorite"]),
  defaultCauseId: z.string().uuid().nullable(),
  favoriteCauseId: z.string().uuid().nullable(),
  split: z.array(z.object({ causeId: z.string().uuid(), bps: z.number().int().min(0).max(10000) })).max(5),
  autoEnabled: z.boolean(),
  autoThresholdUsd: z.string().max(12),
  inactivityTimeoutMinutes: z.number().int().min(5).max(24 * 60),
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
  const values = {
    userId: user!.id,
    deliveryRule: body.deliveryRule,
    defaultCauseId: body.defaultCauseId,
    favoriteCauseId: body.favoriteCauseId,
    split: body.split,
    autoEnabled: body.autoEnabled,
    autoThresholdMicro: threshold,
    inactivityTimeoutSeconds: body.inactivityTimeoutMinutes * 60,
    updatedAt: ctx.now(),
  };
  await ctx.db.insert(helperPreferences).values(values).onConflictDoUpdate({ target: helperPreferences.userId, set: values });
  return { ok: true };
});
