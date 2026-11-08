import { test, expect } from "@playwright/test";

test.describe("Fase C — Layout Responsivo do Lobby & CLS", () => {
  test("Desktop (1440px): sem scroll horizontal e rail visível", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    const rail = page.locator(".ads-right, .ping-rail");
    await expect(rail).toBeVisible();
  });

  test("Tablet (1024px): rail recolhido, sem scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    const rail = page.locator(".ads-right, .ping-rail");
    await expect(rail).not.toBeVisible();
  });

  test("Mobile (375px): sem scroll horizontal e navegação móvel", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    const sidebar = page.locator(".sidebar, .ping-nav");
    await expect(sidebar).not.toBeVisible();
  });
});
