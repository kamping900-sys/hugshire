import { route } from "@/server/http";
import { heartTree } from "@/server/services/heartTree";

export const GET = route({ auth: "user", limit: 120 }, async ({ ctx, user }) => heartTree(ctx, user!.id));
