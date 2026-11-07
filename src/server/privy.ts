import { importSPKI, jwtVerify } from "jose";
import { AppError } from "./core";
import { env } from "./env";

/**
 * Verifies a Privy identity token (same ES256 key, issuer and audience as access tokens) and
 * extracts the verified email from its `linked_accounts` claim. Email login and Google OAuth both
 * yield an email account. Claim shape per Privy docs; re-verify when enabling live mode.
 */
export async function verifyPrivyIdentity(identityToken: string, expectedDid: string): Promise<{ email: string }> {
  const e = env();
  if (!e.PRIVY_APP_ID || !e.PRIVY_VERIFICATION_KEY) throw new AppError("auth_unconfigured", "Privy is not configured.", 503);
  const key = await importSPKI(e.PRIVY_VERIFICATION_KEY.replace(/\\n/g, "\n"), "ES256");
  const { payload } = await jwtVerify(identityToken, key, { issuer: "privy.io", audience: e.PRIVY_APP_ID });
  if (payload.sub !== expectedDid) throw new AppError("auth_invalid", "Sign-in tokens do not match.", 401);
  const raw = payload.linked_accounts;
  const accounts: { type?: string; address?: string; email?: string }[] = typeof raw === "string" ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
  const email = accounts.find((a) => a.type === "email")?.address ?? accounts.find((a) => a.type === "google_oauth")?.email;
  if (!email) throw new AppError("email_required", "Please sign in with email or Google.", 400);
  return { email: email.toLowerCase() };
}
