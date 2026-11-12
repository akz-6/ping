import { test, expect } from "@playwright/test";

test.describe("Mobile Viewer — Zoom, Expand & iOS/Android Comfort", () => {
  test("iPhone (390x844): zoom/cover button, fallback mobile-expanded fullscreen e control bar dentro da viewport sem CSP", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    const cspViolations: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("Content Security Policy")) {
        cspViolations.push(msg.text());
      }
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Simular iPhone Safari sem Fullscreen API em div
    await page.addInitScript(() => {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
        configurable: true,
        value: undefined,
      });
    });

    await page.goto("/?room=mobile-ios-test");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("#bar").evaluate((el) => { (el as HTMLElement).hidden = false; });

    const player = page.locator(".video-js.ping-skin");
    await expect(player).toBeAttached();

    const bar = page.locator(".vjs-control-bar");
    await expect(bar).toBeVisible();

    // Control bar deve caber completamente dentro da viewport (sem clipping)
    const barBox = await bar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(844);

    // Botão Expandir / Zoom visível e alternando modo Preenchido
    const zoomBtn = page.locator("#zoom-btn");
    await expect(zoomBtn).toBeVisible();
    await expect(zoomBtn).toContainText("Expandir");

    await zoomBtn.click();
    await expect(player).toHaveClass(/is-cover-mode/);
    await expect(zoomBtn).toContainText("Preenchido");

    await zoomBtn.click();
    await expect(player).not.toHaveClass(/is-cover-mode/);
    await expect(zoomBtn).toContainText("Expandir");

    // Fullscreen fallback no iPhone (.mobile-expanded)
    const fsBtn = page.locator("#fs");
    await expect(fsBtn).toBeVisible();
    await fsBtn.click();

    const viewer = page.locator(".viewer");
    await expect(viewer).toHaveClass(/mobile-expanded/);
    await expect(viewer).toHaveAttribute("data-expanded", "true");
    await expect(page.locator(".viewer-header")).toBeHidden();

    await fsBtn.click();
    await expect(viewer).not.toHaveClass(/mobile-expanded/);
    await expect(viewer).toHaveAttribute("data-expanded", "false");
    await expect(page.locator(".viewer-header")).toBeVisible();

    expect(cspViolations).toEqual([]);
    expect(pageErrors).toEqual([]);
    await context.close();
  });

  test("Android (360x800): control bar visível na viewport com alvos de toque confortáveis", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    await page.goto("/?room=mobile-android-test");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("#bar").evaluate((el) => { (el as HTMLElement).hidden = false; });

    const bar = page.locator(".vjs-control-bar");
    await expect(bar).toBeVisible();

    const barBox = await bar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(800);

    const zoomBtn = page.locator("#zoom-btn");
    await expect(zoomBtn).toBeVisible();
    const zoomBox = await zoomBtn.boundingBox();
    expect(zoomBox).not.toBeNull();
    expect(zoomBox!.height).toBeGreaterThanOrEqual(38);

    const fsBtn = page.locator("#fs");
    await expect(fsBtn).toBeVisible();
    const fsBox = await fsBtn.boundingBox();
    expect(fsBox).not.toBeNull();
    expect(fsBox!.height).toBeGreaterThanOrEqual(38);

    await context.close();
  });
});
