import { sql } from "drizzle-orm";
import { json } from "@/server/http";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";

/** Liveness + database reachability. No secrets, no balances. */
export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return json({ ok: true, mode: env().HUGSHIRE_MODE, dbMs: Date.now() - started });
  } catch {
    return json({ ok: false, mode: env().HUGSHIRE_MODE }, 503);
  }
}
