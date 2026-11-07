import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { json } from "@/server/http";
import { deposits, onrampTransactions, webhookEvents } from "@/server/db/schema";
import { audit, raiseAlert } from "@/server/core";
import { parseUsd } from "@/lib/money";
import { env } from "@/server/env";
import { verifyCdpWebhook } from "@/server/providers/live";
import { defaultCtx } from "@/server/services/context";
import { setDepositStatus } from "@/server/services/deposits";

/**
 * Coinbase CDP Onramp/Offramp webhooks.
 * 1. Verify X-Webhook-Signature (HMAC-SHA256 over `${t}.${rawBody}`, 5-minute replay window).
 * 2. Store the event once (unique provider + event id), so retries are harmless.
 * 3. Only `onramp.transaction.success` moves a deposit forward, and only to `onramp_completed`.
 *    Nothing is credited here; principal is credited only once the Vault deposit is verified on chain.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = env().CDP_WEBHOOK_SECRET;
  if (!secret || !verifyCdpWebhook(raw, req.headers.get("x-webhook-signature"), secret)) {
    return json({ error: "invalid signature" }, 401);
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const ctx = await defaultCtx();
  const eventType = String(payload.eventType ?? payload.type ?? "unknown");
  const eventId = String(payload.id ?? payload.eventId ?? createHash("sha256").update(raw).digest("hex"));
  const inserted = await ctx.db
    .insert(webhookEvents)
    .values({ provider: "coinbase", eventId, eventType, payload })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (!inserted.length) return json({ ok: true, duplicate: true });

  try {
    if (eventType === "onramp.transaction.success") {
      const ref = String(payload.partnerUserRef ?? payload.partner_user_ref ?? "");
      const userId = ref.startsWith("hs-") ? ref.slice(3) : null;
      if (userId) {
        const pending = await ctx.db
          .select()
          .from(deposits)
          .where(and(eq(deposits.userId, userId), eq(deposits.status, "onramp_pending"), eq(deposits.environment, ctx.environment)))
          .orderBy(asc(deposits.createdAt));
        if (pending.length === 1) {
          // USDC actually delivered (after Coinbase fees) is what gets bridged; never assume the requested amount.
          let purchased: bigint | null = null;
          try {
            purchased = payload.purchaseAmount !== undefined ? parseUsd(String(payload.purchaseAmount)) : null;
          } catch {
            purchased = null;
          }
          await ctx.db
            .update(onrampTransactions)
            .set({ status: "success", providerTxId: String(payload.transactionId ?? payload.id ?? ""), amountMicro: purchased, raw: payload, updatedAt: ctx.now() })
            .where(eq(onrampTransactions.depositId, pending[0].id));
          await setDepositStatus(ctx, pending[0].id, "onramp_completed");
          await audit(ctx.db, { actorType: "webhook", action: "deposit.onramp_completed", targetType: "deposit", targetId: pending[0].id });
        } else {
          // Ambiguous or unknown: never guess which deposit a payment belongs to.
          await raiseAlert(ctx.db, {
            severity: "warning",
            code: "onramp_unmatched",
            message: `Onramp success for ${ref} matched ${pending.length} pending deposits; needs manual review.`,
            dedupeKey: `onramp_unmatched:${eventId}`,
            data: { eventId },
          });
        }
      }
    }
    if (eventType === "onramp.transaction.failed") {
      await audit(ctx.db, { actorType: "webhook", action: "onramp.failed", data: { eventId } });
    }
    await ctx.db.update(webhookEvents).set({ processedAt: ctx.now() }).where(eq(webhookEvents.id, inserted[0].id));
  } catch (e) {
    await ctx.db.update(webhookEvents).set({ error: (e as Error).message.slice(0, 1000) }).where(eq(webhookEvents.id, inserted[0].id));
  }
  return json({ ok: true });
}
