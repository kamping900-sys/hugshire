import { z } from "zod";
import { route } from "@/server/http";
import { parseUsd } from "@/lib/money";
import { AppError } from "@/server/core";
import { requestWithdrawal } from "@/server/services/withdrawals";

export const POST = route(
  { auth: "user", limit: 10, schema: z.object({ amountUsd: z.string().max(20), idempotencyKey: z.string().min(8).max(80) }) },
  async ({ body, user, ctx }) => {
    let amountMicro: bigint;
    try {
      amountMicro = parseUsd(body.amountUsd);
    } catch {
      throw new AppError("invalid_amount", "Enter an amount like 25 or 25.50");
    }
    const r = await requestWithdrawal(ctx, { userId: user!.id, amountMicro, idempotencyKey: body.idempotencyKey });
    return { withdrawal: r.withdrawal };
  },
);
