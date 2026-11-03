import { test, expect } from "@playwright/test";

test.describe("Fase L4 — Anúncios, Consentimento LGPD e Qualidade", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ping:creator_authorized", "true");
    });
  });

  test("banner de consentimento LGPD é exibido na primeira visita quando não há preferência", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("#ping-consent-banner");
    await expect(banner).toBeVisible();
    await expect(banner.getByText(/Privacidade & Anúncios Responsáveis/i)).toBeVisible();
    await expect(banner.locator("#consent-btn-accept")).toBeVisible();
    await expect(banner.locator("#consent-btn-essential")).toBeVisible();
  });

  test("aceitar consentimento grava 'accepted', fecha o banner e ativa criativos com rel='sponsored noopener'", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("#ping-consent-banner");
    await expect(banner).toBeVisible();

    await banner.locator("#consent-btn-accept").click();
    await expect(banner).toBeHidden();

    const consentVal = await page.evaluate(() => localStorage.getItem("ping:cookie_consent"));
    expect(consentVal).toBe("accepted");

    // Os slots devem carregar o criativo de patrocinador
    const sponsorLink = page.locator(".ad-creative").first();
    await expect(sponsorLink).toBeVisible();
    await expect(sponsorLink).toHaveAttribute("target", "_blank");
    await expect(sponsorLink).toHaveAttribute("rel", "sponsored noopener");
    await expect(sponsorLink.getByText(/Patrocinado/i).first()).toBeVisible();
  });

  test("recusar anúncios ('Apenas essenciais') grava 'essential' e exibe aviso respeitoso sem rastreadores", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("#ping-consent-banner");
    await expect(banner).toBeVisible();

    await banner.locator("#consent-btn-essential").click();
    await expect(banner).toBeHidden();

    const consentVal = await page.evaluate(() => localStorage.getItem("ping:cookie_consent"));
    expect(consentVal).toBe("essential");

    // Deve exibir card de anúncios pausados
    const optout = page.locator(".ad-optout").first();
    await expect(optout).toBeVisible();
    await expect(optout.getByText(/Anúncio pausado/i)).toBeVisible();

    // Botão de personalizar reabre o banner
    await optout.getByRole("button", { name: /Personalizar/i }).click();
    await expect(page.locator("#ping-consent-banner")).toBeVisible();
  });

  test("perfil permite gerenciar preferências de privacidade e redefinir consentimento", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ping:cookie_consent", "accepted");
    });
    await page.goto("/");

    // Abre o perfil
    await page.locator(".profile-card").click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();

    await expect(dlg.getByText(/Privacidade & Anúncios/i)).toBeVisible();
    await expect(dlg.getByText(/Anúncios permitidos/i)).toBeVisible();

    // Clica em gerenciar preferências
    await dlg.getByRole("button", { name: "Gerenciar preferências" }).click();
    await expect(dlg).toBeHidden();

    // Banner de consentimento reaparece
    const banner = page.locator("#ping-consent-banner");
    await expect(banner).toBeVisible();
  });

  test("slots de anúncio possuem dimensões fixas (CLS = 0)", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ping:cookie_consent", "accepted");
    });
    await page.goto("/");

    const slot250 = page.locator(".ads-right .ad-300x250");
    const box250 = await slot250.boundingBox();
    expect(box250).not.toBeNull();
    expect(Math.round(box250!.width)).toBe(300);
    expect(Math.round(box250!.height)).toBe(250);

    const slot600 = page.locator(".ads-right .ad-300x600");
    const box600 = await slot600.boundingBox();
    expect(box600).not.toBeNull();
    expect(Math.round(box600!.width)).toBe(300);
    expect(Math.round(box600!.height)).toBe(600);
  });

  test("isolamento total: modo visualizador / transmissão (?room=) tem ZERO anúncios e ZERO banners", async ({ page }) => {
    await page.goto("/?room=demo-fechada-teste");

    // Verifica que nenhum elemento de anúncio ou banner existe na tela do visualizador
    await expect(page.locator(".ad-slot")).toHaveCount(0);
    await expect(page.locator(".ad-creative")).toHaveCount(0);
    await expect(page.locator("#ping-consent-banner")).toHaveCount(0);
    await expect(page.locator(".ads-right")).toHaveCount(0);
    await expect(page.locator(".ads-below")).toHaveCount(0);
  });
});
