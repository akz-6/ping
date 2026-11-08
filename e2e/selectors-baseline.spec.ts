import { test, expect } from "@playwright/test";

test.describe("Fase A — Contrato de Seletores Baseline", () => {
  test("Lobby renderiza elementos estruturais do baseline", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator("#toasts")).toBeAttached();
    await expect(page.locator(".sidebar, .ping-nav").first()).toBeVisible();
    await expect(page.locator(".brand-name, .ping-brand").first()).toBeVisible();
    await expect(page.locator("#sidebar-create")).toBeVisible();
    await expect(page.locator(".lobby-footer")).toBeAttached();
  });

  test("Studio renderiza controles e palco do anfitrião", async ({ page }) => {
    await page.goto("/studio");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("#setup, .studio").first()).toBeAttached();
    await expect(page.locator("#start").first()).toBeAttached();
    await expect(page.locator("#v, video").first()).toBeAttached();
  });

  test("Viewer renderiza elementos do player Video.js", async ({ page }) => {
    await page.goto("/?room=baseline-check");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("#v").first()).toBeAttached();
    await expect(page.locator(".chat-panel")).toBeAttached();
  });
});
