import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ConfigError, parseEnv, resetEnvForTests } from "@/server/env";
import { verifyCdpWebhook } from "@/server/providers/live";
import { sniffImage } from "@/server/storage";
import { openDb } from "@/server/db/client";
import { loginCodes, users } from "@/server/db/schema";
import { createSession, destroySession, requestDevCode, userFromSessionToken, verifyDevCode } from "@/server/auth";

afterEach(() => resetEnvForTests(undefined));

describe("environment safety", () => {
  it("live mode refuses to boot without credentials, dev auth, or a real database", () => {
    expect(() => parseEnv({ HUGSHIRE_MODE: "live" })).toThrow(ConfigError);
    try {
      parseEnv({ HUGSHIRE_MODE: "live" });
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toMatch(/CDP_API_KEY_ID/);
      expect(m).toMatch(/AUTH_PROVIDER=privy/);
      expect(m).toMatch(/DATABASE_URL/);
      expect(m).toMatch(/NEAR_OPERATOR_PRIVATE_KEY/);
    }
  });
  it("sandbox defaults are safe and blank values count as unset", () => {
    const e = parseEnv({ ALERT_WEBHOOK_URL: "", CDP_API_KEY_ID: "  " });
    expect(e.HUGSHIRE_MODE).toBe("sandbox");
    expect(e.CDP_API_KEY_ID).toBeUndefined();
  });
  it("production builds need a real session secret", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });
});

describe("Coinbase webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ eventType: "onramp.transaction.success", partnerUserRef: "hs-x" });
  const sign = (t: number, b = body) => `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${b}`).digest("hex")}`;
  const now = 1_800_000_000;
  it("accepts a valid signature", () => expect(verifyCdpWebhook(body, sign(now), secret, now)).toBe(true));
  it("rejects a tampered body", () => expect(verifyCdpWebhook(body + " ", sign(now), secret, now)).toBe(false));
  it("rejects replays outside 5 minutes", () => expect(verifyCdpWebhook(body, sign(now - 301), secret, now)).toBe(false));
  it("rejects missing or garbage headers", () => {
    expect(verifyCdpWebhook(body, null, secret, now)).toBe(false);
    expect(verifyCdpWebhook(body, "nonsense", secret, now)).toBe(false);
    expect(verifyCdpWebhook(body, sign(now), "", now)).toBe(false);
  });
});

describe("upload sniffing", () => {
  it("trusts magic bytes, not names", () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(Buffer.from("RIFF0000WEBPVP8 "))).toBe("webp");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a....."))).toBeNull();
  });
});

describe("authentication", () => {
  it("dev codes: wrong code counts attempts, right code signs in once, sessions expire on logout", async () => {
    resetEnvForTests({ HUGSHIRE_MODE: "sandbox", AUTH_PROVIDER: "dev", NODE_ENV: "test", ADMIN_EMAILS: "boss@x.test" });
    const { db, close } = await openDb("pglite:memory");
    const { devCode } = await requestDevCode(db, "Boss@X.test");
    expect(devCode).toMatch(/^\d{6}$/);
    const wrong = devCode === "000000" ? "111111" : "000000";
    await expect(verifyDevCode(db, "boss@x.test", wrong)).rejects.toMatchObject({ code: "code_invalid" });
    expect((await db.select().from(loginCodes))[0].attempts).toBe(1);
    const u = await verifyDevCode(db, "boss@x.test", devCode!);
    expect(u.email).toBe("boss@x.test");
    expect((await db.select().from(users).where(eq(users.id, u.id)))[0].role).toBe("admin"); // bootstrap admin
    await expect(verifyDevCode(db, "boss@x.test", devCode!)).rejects.toMatchObject({ code: "code_invalid" }); // single use
    const s = await createSession(db, u.id, {});
    expect((await userFromSessionToken(db, s.token))?.id).toBe(u.id);
    await destroySession(db, s.token);
    expect(await userFromSessionToken(db, s.token)).toBeNull();
    await close();
  });
  it("dev codes are refused in live mode", async () => {
    resetEnvForTests({ HUGSHIRE_MODE: "sandbox", AUTH_PROVIDER: "privy", NODE_ENV: "test" });
    const { db, close } = await openDb("pglite:memory");
    await expect(requestDevCode(db, "a@b.test")).rejects.toMatchObject({ code: "auth_disabled" });
    await close();
  });
});
