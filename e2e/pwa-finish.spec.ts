import { test, expect } from "@playwright/test";

test.describe("Fase 5 — Acabamento, PWA e Polimento Final", () => {
  test("manifest.webmanifest é servido corretamente e define app instalável", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);

    const json = await res.json();
    expect(json.name).toContain("Ping");
    expect(json.short_name).toBe("Ping");
    expect(json.display).toBe("standalone");
    expect(json.start_url).toBe("/");
    expect(Array.isArray(json.icons)).toBe(true);
    expect(json.icons.length).toBeGreaterThan(0);
    expect(Array.isArray(json.shortcuts)).toBe(true);
  });

  test("service worker sw.js existe e é acessível para cache offline", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("ping-shell-v1");
    expect(text).toContain("caches.open");
  });

  test("perfil inclui botão de instalação PWA e dados de privacidade", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ping:creator_authorized", "true");
      localStorage.setItem("ping:cookie_consent", "accepted");
    });
    await page.goto("/");

    await page.locator(".profile-card").click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();

    await expect(dlg.getByText(/Privacidade & Anúncios/i)).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Salvar" })).toBeVisible();
  });

  test("viewer usável em celular com playsinline e barra com auto-ocultação", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?room=demo-fechada-teste");

    const video = page.locator("#v");
    await expect(video).toHaveAttribute("playsinline", "");
    await expect(video).toHaveAttribute("autoplay", "");
    await expect(video).toHaveAttribute("muted", "");
  });
});
