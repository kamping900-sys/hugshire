import { z } from "zod";
import { route } from "@/server/http";
import { causeInput, postCauseUpdate, submitCause, updateCause, updateInput } from "@/server/services/orgs";

/** Organiser edits a cause (members only, checked in the service). */
export const PATCH = route({ auth: "user", schema: causeInput.partial(), limit: 20 }, async ({ body, user, ctx, params }) => {
  await updateCause(ctx, user!.id, params.id, body);
  return { ok: true };
});

/** Organiser actions: submit for review, or post an update. */
export const POST = route(
  { auth: "user", limit: 20, schema: z.discriminatedUnion("action", [z.object({ action: z.literal("submit") }), updateInput.extend({ action: z.literal("update") })]) },
  async ({ body, user, ctx, params }) => {
    if (body.action === "submit") await submitCause(ctx, user!.id, params.id);
    else await postCauseUpdate(ctx, user!.id, params.id, { title: body.title, body: body.body, category: body.category, mediaUrl: body.mediaUrl, linkUrl: body.linkUrl });
    return { ok: true };
  },
);
