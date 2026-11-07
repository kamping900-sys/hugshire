import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "./core";
import { env } from "./env";

const MAX_BYTES = 2 * 1024 * 1024;

/** Detects the real image type from magic bytes; the client's filename and MIME are ignored. */
export function sniffImage(b: Buffer): "png" | "jpg" | "webp" | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Stores an uploaded image and returns its public URL.
 * local: ./public/uploads (dev only). s3: any S3-compatible bucket such as Cloudflare R2.
 */
export async function storeImage(buf: Buffer): Promise<string> {
  if (buf.length === 0 || buf.length > MAX_BYTES) throw new AppError("file_size", "Images must be under 2 MB.");
  const kind = sniffImage(buf);
  if (!kind) throw new AppError("file_type", "Please upload a PNG, JPEG or WebP image.");
  const name = `${randomBytes(16).toString("hex")}.${kind}`;
  const e = env();
  if (e.STORAGE_DRIVER === "local") {
    const dir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), buf);
    return `/uploads/${name}`;
  }
  if (!e.S3_ENDPOINT || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY || !e.S3_PUBLIC_BASE_URL) {
    throw new AppError("storage_unconfigured", "Image storage is not configured.", 503);
  }
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: "auto", endpoint: e.S3_ENDPOINT, credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } });
  await s3.send(
    new PutObjectCommand({
      Bucket: e.S3_BUCKET,
      Key: `covers/${name}`,
      Body: buf,
      ContentType: kind === "jpg" ? "image/jpeg" : `image/${kind}`,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return `${e.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/covers/${name}`;
}
