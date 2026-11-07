import { expect, test, type Page } from "@playwright/test";

/** Signs in through the real dev-code UI (sandbox only). */
async function signIn(page: Page, email: string, next = "/portfolio") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = (await page.getByText(/Development code:/).textContent())!.match(/\d{6}/)![0];
  await page.getByLabel(/6-digit code/).fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname === next);
}

test("home explains the product and discloses risk", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Where kindness/ })).toBeVisible();
  await expect(page.getByText(/Test mode — no real money moves/)).toBeVisible();
  await expect(page.getByText(/not a bank/).first()).toBeVisible();
});

test("explore shows the world map and town list", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /Pawsbury/ }).first()).toBeVisible();
});

test("supporter: deposit → helper → city → deliver", async ({ page }, info) => {
  const email = `e2e-${info.project.name}-${Date.now()}@hugshire.test`;
  await signIn(page, email, "/support/pawsbury");

  // pick an animal, amount, accept risk, go to test checkout
  await page.getByRole("button", { name: /Otter/ }).click();
  await page.getByRole("button", { name: "$10", exact: true }).click();
  await page.getByText(/I understand Hugshire is not a bank/).click();
  await page.getByRole("button", { name: "Continue to test checkout" }).click();
  await expect(page.getByText("No money moves here")).toBeVisible();
  await page.getByRole("button", { name: "Complete test payment" }).click();

  // the in-process sandbox scheduler moves the deposit to "Earning on RHEA"
  await page.waitForURL(/\/portfolio/);
  await expect(page.getByText("Earning on RHEA")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("$10.00").first()).toBeVisible();

  // the helper exists and the city knows it
  await page.goto("/helpers");
  await expect(page.getByText(/Otter in/)).toBeVisible();
  await page.goto("/city/pawsbury");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/You're steering|Auto mode/)).toBeVisible();

  // a brand-new deposit has no settled yield yet: delivering is honestly not possible
  await expect(page.getByText(/of earned yield ready to deliver/)).toBeVisible();
});

test("withdrawal request moves through its stages", async ({ page }, info) => {
  const email = `e2e-wd-${info.project.name}-${Date.now()}@hugshire.test`;
  await signIn(page, email, "/support/fernhollow");
  await page.getByRole("button", { name: "$10", exact: true }).click();
  await page.getByText(/I understand Hugshire is not a bank/).click();
  await page.getByRole("button", { name: "Continue to test checkout" }).click();
  await page.getByRole("button", { name: "Complete test payment" }).click();
  await page.waitForURL(/\/portfolio/);
  await expect(page.getByText("Earning on RHEA")).toBeVisible({ timeout: 45_000 });

  page.on("dialog", (d) => d.accept());
  await page.getByLabel("Amount to withdraw").fill("4");
  await page.getByRole("button", { name: "Request withdrawal" }).click();
  await expect(page.getByText(/Requested\./)).toBeVisible();
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Received: \$4\.00/)).toBeVisible();
});

test("organiser can create an organisation and a draft cause; admin pages are protected", async ({ page }, info) => {
  await signIn(page, `e2e-org-${info.project.name}-${Date.now()}@hugshire.test`, "/org");
  await page.getByLabel("Organisation name").fill(`E2E Helpers ${info.project.name}`);
  await page.getByLabel("Contact email").fill("e2e@hugshire.test");
  await page.getByRole("button", { name: "Create organisation" }).click();
  await expect(page.getByText("Awaiting review")).toBeVisible();
  await page.goto("/org/causes/new");
  await page.getByLabel("Town name").fill(`Testwick ${Date.now() % 10000}`);
  await page.getByLabel("Cause title").fill("Testing the test town");
  await page.getByLabel("One-line summary").fill("An end-to-end test cause, safe to delete.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible();

  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
});
