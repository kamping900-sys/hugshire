import { route } from "@/server/http";
import { parseUsd } from "@/lib/money";
import { AppError } from "@/server/core";
import { createDeposit, createDepositInput } from "@/server/services/deposits";

export const POST = route({ auth: "user", schema: createDepositInput, limit: 10 }, async ({ body, user, ctx, ip }) => {
  let amountMicro: bigint;
  try {
    amountMicro = parseUsd(body.amountUsd);
  } catch {
    throw new AppError("invalid_amount", "Enter an amount like 25 or 25.50");
  }
  const r = await createDeposit(ctx, {
    userId: user!.id,
    causeId: body.causeId,
    amountMicro,
    animal: body.animal,
    nickname: body.nickname,
    idempotencyKey: body.idempotencyKey,
    clientIp: ip,
  });
  return { depositId: r.deposit.id, status: r.deposit.status, checkoutUrl: r.checkoutUrl };
});
