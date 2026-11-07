import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { causes } from "@/server/db/schema";
import { AppError, audit, notFound } from "@/server/core";
import { currentUser, errorResponse, json, rateLimit, clientIp } from "@/server/http";
import { defaultCtx } from "@/server/services/context";
import { requireOrgMember } from "@/server/services/orgs";
import { storeImage } from "@/server/storage";

/** Cover image upload: members only, PNG/JPEG/WebP checked by magic bytes, 2 MB max, random name. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!rateLimit(`cover:${await clientIp()}`, 10)) throw new AppError("rate_limited", "Too many uploads.", 429);
    const user = await currentUser();
    if (!user) throw new AppError("unauthenticated", "Please sign in first.", 401);
    const ctx = await defaultCtx();
    const [c] = await ctx.db.select().from(causes).where(eq(causes.id, id));
    if (!c) throw notFound();
    await requireOrgMember(ctx, user.id, c.orgId);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("no_file", "Choose an image to upload.");
    const url = await storeImage(Buffer.from(await file.arrayBuffer()));
    await ctx.db.update(causes).set({ coverImageUrl: url, updatedAt: ctx.now() }).where(eq(causes.id, id));
    await audit(ctx.db, { actorId: user.id, actorType: "user", action: "cause.cover_uploaded", targetType: "cause", targetId: id });
    return json({ url });
  } catch (e) {
    return errorResponse(e);
  }
}
