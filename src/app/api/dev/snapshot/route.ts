import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";

/** Development only: saves a game frame sent by the browser to .data/snapshot.png for inspection. */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  const { dataUrl, name } = (await req.json()) as { dataUrl: string; name?: string };
  const b64 = dataUrl.split(",")[1] ?? "";
  const file = path.join(process.cwd(), ".data", `${(name ?? "snapshot").replace(/[^\w-]/g, "")}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(b64, "base64"));
  return NextResponse.json({ ok: true, file });
}
