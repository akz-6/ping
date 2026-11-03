import { test } from "@playwright/test";

// Capturas para comparar com o Figma. Uso: SHOTS_DIR=<pasta> npx playwright test e2e/ui-shots.spec.ts
const dir = process.env.SHOTS_DIR;
test.skip(!dir, "defina SHOTS_DIR para gerar capturas");

const palettes = ["indigo", "teal", "terracota"] as const;
const themes = ["light", "dark"] as const;

async function prepare(page: import("@playwright/test").Page, palette: string, theme: string) {
  await page.addInitScript(
    ([p, t]) => {
      localStorage.setItem("ping:palette", p);
      localStorage.setItem("ping:theme", t);
    },
    [palette, theme],
  );
  await page.goto("/");
  await page.waitForSelector(".room-card:not(.is-skeleton)");
}

for (const palette of palettes) {
  for (const theme of themes) {
    test(`desktop ${palette} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await prepare(page, palette, theme);
      await page.screenshot({ path: `${dir}/desktop-${palette}-${theme}.png` });
    });
  }
}

for (const theme of themes) {
  test(`tablet ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await prepare(page, "indigo", theme);
    await page.screenshot({ path: `${dir}/tablet-${theme}.png` });
  });
  test(`mobile ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await prepare(page, "indigo", theme);
    await page.screenshot({ path: `${dir}/mobile-${theme}.png` });
  });
  test(`modais ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepare(page, "indigo", theme);
    await page.locator("#sidebar-create").click();
    await page.locator("dialog").screenshot({ path: `${dir}/modal-criar-${theme}.png` });
    await page.keyboard.press("Escape");
    await page.locator('.room-card:has-text("Reunião da equipe")').click();
    await page.locator("dialog").screenshot({ path: `${dir}/modal-senha-${theme}.png` });
    await page.keyboard.press("Escape");
    await page.locator(".profile-card").click();
    await page.locator("dialog").screenshot({ path: `${dir}/modal-perfil-${theme}.png` });
  });
}
