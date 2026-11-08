import { test, expect } from "@playwright/test";

test.describe("Fase D — Skin Black + Gray Video.js & Atalhos", () => {
  test("controlBar contém componentes necessários e atalhos funcionam sem violação de CSP", async ({ page }) => {
    const cspViolations: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("Content Security Policy")) {
        cspViolations.push(msg.text());
      }
    });

    await page.goto("/?room=skin-test-room");
    await page.waitForLoadState("domcontentloaded");

    const player = page.locator(".video-js");
    await expect(player).toBeAttached();
    await expect(player).toHaveClass(/ping-skin/);

    const bar = page.locator(".vjs-control-bar");
    await expect(bar).toBeAttached();

    // Live badge
    await expect(page.locator(".vjs-live-badge, .ping-live-badge")).toBeAttached();

    // Volume panel
    await expect(page.locator(".vjs-volume-panel")).toBeAttached();

    // Qualidade
    await expect(page.locator(".vjs-quality-control, .ping-quality-menu")).toBeAttached();

    // FPS
    await expect(page.locator(".vjs-fps-control, .ping-fps-menu")).toBeAttached();

    // Atalho S alterna OSD
    const osd = page.locator("#osd, .ping-osd");
    await expect(osd).toBeAttached();
    await page.keyboard.press("s");
    await expect(osd).toHaveAttribute("data-visible", "true");
    await page.keyboard.press("s");
    await expect(osd).toHaveAttribute("data-visible", "false");

    // Zero dynamic style tags with text
    const styleTagsWithText = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll("style.vjs-styles-defaults, style.vjs-styles-dimensions"));
      return styles.filter((s) => (s.textContent || "").trim().length > 0).length;
    });
    expect(styleTagsWithText).toBe(0);
    expect(cspViolations.length).toBe(0);
  });
});
