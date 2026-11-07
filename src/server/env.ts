import { z } from "zod";

/**
 * Environment configuration. Parsed once, validated with zod.
 * Live mode refuses to boot without every credential it needs, and refuses dev sign-in.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HUGSHIRE_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  APP_URL: z.string().url().default("http://localhost:3200"),
  DATABASE_URL: z.string().default("pglite:.data/hugshire"),
  SESSION_SECRET: z.string().min(32).default("dev-only-session-secret-change-me-0123456789"),
  AUTH_PROVIDER: z.enum(["dev", "privy"]).default("dev"),
  ADMIN_EMAILS: z.string().default(""),

  // Privy (live auth + embedded wallets)
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_VERIFICATION_KEY: z.string().optional(),

  // Coinbase Developer Platform (Onramp / Offramp / webhooks)
  CDP_API_KEY_ID: z.string().optional(),
  CDP_API_KEY_SECRET: z.string().optional(),
  CDP_WEBHOOK_SECRET: z.string().optional(),

  // NEAR Intents 1Click
  ONECLICK_BASE_URL: z.string().url().default("https://1click.chaindefuser.com"),
  ONECLICK_API_KEY: z.string().optional(),

  // NEAR
  NEAR_NETWORK: z.enum(["mainnet", "testnet"]).default("mainnet"),
  NEAR_RPC_URL: z.string().url().default("https://rpc.mainnet.near.org"),
  NEAR_VAULT_CONTRACT: z.string().optional(),
  NEAR_OPERATOR_ACCOUNT: z.string().optional(),
  NEAR_OPERATOR_PRIVATE_KEY: z.string().optional(),
  RHEA_LENDING_CONTRACT: z.string().default("contract.main.burrow.near"),
  NEAR_USDC_CONTRACT: z
    .string()
    .default("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"),

  // Storage for uploads: "local" (dev) or "s3" (R2 / S3-compatible)
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),

  // Monitoring
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  WORKER_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export class ConfigError extends Error {}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Blank values (KEY=) mean "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const env = schema.parse(cleaned);
  if (env.HUGSHIRE_MODE === "live") {
    const missing: string[] = [];
    const need: (keyof Env)[] = [
      "PRIVY_APP_ID",
      "PRIVY_VERIFICATION_KEY",
      "CDP_API_KEY_ID",
      "CDP_API_KEY_SECRET",
      "CDP_WEBHOOK_SECRET",
      "ONECLICK_API_KEY",
      "NEAR_VAULT_CONTRACT",
      "NEAR_OPERATOR_ACCOUNT",
      "NEAR_OPERATOR_PRIVATE_KEY",
      "WORKER_SECRET",
    ];
    for (const k of need) if (!env[k]) missing.push(k);
    if (env.AUTH_PROVIDER !== "privy") missing.push("AUTH_PROVIDER=privy (dev sign-in is refused in live mode)");
    if (env.DATABASE_URL.startsWith("pglite:")) missing.push("DATABASE_URL (a real PostgreSQL URL; embedded PGlite is dev-only)");
    if (env.SESSION_SECRET.startsWith("dev-only")) missing.push("SESSION_SECRET (random, 32+ chars)");
    if (env.NEAR_NETWORK !== "mainnet") missing.push("NEAR_NETWORK=mainnet (RHEA lending is mainnet-only)");
    if (missing.length) {
      throw new ConfigError(`HUGSHIRE_MODE=live refused to start. Missing or unsafe: ${missing.join(", ")}`);
    }
  }
  if (env.NODE_ENV === "production" && env.SESSION_SECRET.startsWith("dev-only")) {
    throw new ConfigError("SESSION_SECRET must be set in production builds.");
  }
  return env;
}

let cached: Env | undefined;
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Test hook. */
export function resetEnvForTests(next?: Record<string, string | undefined>) {
  cached = next ? parseEnv(next) : undefined;
}

export const isLive = () => env().HUGSHIRE_MODE === "live";
export const environmentTag = () => (isLive() ? "live" : "sandbox") as "live" | "sandbox";
