import { expect, test, type Page } from "@playwright/test";

/** Signs in through the real dev-code UI (sandbox only). */
async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = (await page.getByText(/Development code:/).textContent())!.match(/\d{6}/)![0];
  await page.getByLabel(/6-digit code/).fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname === next);
}

test("overworld lists real towns and opens a detailed town", async ({ page }) => {
  await page.goto("/worldmap");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "Towns" }).click();
  await expect(page.getByText(/real towns/)).toBeVisible();
  await page.goto("/worldmap/town/pawsbury");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("Visiting as a guest")).toBeVisible();
});

test("supporter: deposit, start a building, server picks the mini-game, quit commits once, forged rewards ignored", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "covered on desktop; the flow is identical");
  const email = `e2e-v4-${Date.now()}@hugshire.test`;
  await signIn(page, email, "/support/inkwell-hollow");
  await page.getByRole("button", { name: /Otter/ }).click();
  await page.getByRole("button", { name: "$10", exact: true }).click();
  await page.getByText(/I understand Hugshire is not a bank/).click();
  await page.getByRole("button", { name: "Continue to test checkout" }).click();
  await page.getByRole("button", { name: "Complete test payment" }).click();
  await page.waitForURL(/\/portfolio/);
  await expect(page.getByText("Earning on RHEA")).toBeVisible({ timeout: 45_000 });

  // pick a free plot through the API the UI uses, then play through the UI
  await page.goto("/worldmap/town/inkwell-hollow");
  await expect(page.getByText(/Active deposit \$10\.00/)).toBeVisible({ timeout: 25_000 });
  const started = await page.evaluate(async () => {
    const t = await fetch("/api/town/inkwell-hollow").then((r) => r.json());
    const taken = new Set(t.projects.map((p: { plotKey: string }) => p.plotKey));
    const plot = ["p5", "p6", "p8", "p10"].find((k) => !taken.has(k));
    const r = await fetch("/api/construction", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ causeId: t.town.id, plotKey: plot, blueprintKey: "cottage" }) });
    const s = await fetch("/api/minigame/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: (await r.json()).project.id }) });
    return s.json();
  });
  expect(started.kind).toBe("play");
  expect(["wood", "stone"]).toContain(started.session.resource);
  expect(started.session.baseRewardMicro).toBe("10000"); // $10 → 0.01 per Hit
  const q = await page.evaluate(async (id) => (await fetch(`/api/minigame/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "quit" }) })).json(), started.session.id);
  expect(q.session.status).toBe("ended");
  // client-sent rewards are ignored: a forged round is refused (session closed) and nothing is minted
  const forged = await page.evaluate(async (id) => (await fetch(`/api/minigame/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "round", round: 0, swings: [1, 2, 3], earnedMicro: "999999999" }) })).json(), started.session.id);
  expect(forged.session.earnedMicro).toBe("0");
});

test("community pool page discloses the rules", async ({ page }) => {
  await page.goto("/pool");
  await expect(page.getByRole("heading", { name: "Community Heart Pool" })).toBeVisible();
  await expect(page.getByText(/floor\(\(charity budget \+ carry-in\)/)).toBeVisible();
  await expect(page.getByText(/same no matter your deposit size/)).toBeVisible();
});
