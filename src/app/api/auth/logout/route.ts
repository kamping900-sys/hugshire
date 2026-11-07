import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { destroySession, SESSION_COOKIE } from "@/server/auth";

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await destroySession(await getDb(), t);
  jar.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/", req.url), 303);
}
