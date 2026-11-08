import { test, expect } from "@playwright/test";

test.describe("Fase 7 — Páginas Legais & AdSense (Lobby Only)", () => {
  const CONTACT_EMAIL = "cupboardofdrawings@gmail.com";
  const LEGAL_ROUTES = ["/privacy.html", "/terms.html", "/contact.html"];

  for (const route of LEGAL_ROUTES) {
    test(`rota ${route} responde 200, tem e-mail de contato e zero inline style`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);

      // E-mail oficial exigido
      await expect(page.locator(`a[href="mailto:${CONTACT_EMAIL}"]`).first()).toBeVisible();
      await expect(page.locator(`text=${CONTACT_EMAIL}`).first()).toBeVisible();

      // Estrutura semântica básica
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("header")).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("footer")).toBeVisible();

      // Zero inline style violando CSP
      const inlineStyleCount = await page.locator("[style]").count();
      expect(inlineStyleCount).toBe(0);

      const styleTagsCount = await page.locator("style").count();
      expect(styleTagsCount).toBe(0);
    });
  }

  test("ads.txt é servido na raiz com status 200", async ({ request }) => {
    const res = await request.get("/ads.txt");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("google.com");
  });

  test("Lobby exibe rodapé com links para todas as páginas legais", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator(".lobby-footer");
    await expect(footer).toBeVisible();

    await expect(footer.locator('a[href="/privacy.html"]')).toHaveText("Privacidade");
    await expect(footer.locator('a[href="/terms.html"]')).toHaveText("Termos");
    await expect(footer.locator('a[href="/contact.html"]')).toHaveText("Contato");
  });

  test("banner de consentimento: rejeitar ('Apenas essenciais') não carrega script do AdSense", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });

    await page.goto("/");
    const banner = page.locator("#ping-consent-banner");
    await expect(banner).toBeVisible();

    const essentialBtn = page.locator("#consent-btn-essential");
    await essentialBtn.click();

    await expect(banner).toBeHidden();

    const consentVal = await page.evaluate(() => localStorage.getItem("ping:cookie_consent"));
    expect(consentVal).toBe("essential");

    // Script do AdSense não pode existir
    const adsScript = await page.locator('script[src*="pagead2.googlesyndication.com"]').count();
    expect(adsScript).toBe(0);

    const adsIns = await page.locator("ins.adsbygoogle").count();
    expect(adsIns).toBe(0);
  });

  test("banner de consentimento: aceitar grava consentimento e tenta carregar AdSense", async ({ page }) => {
    // Mock do script da Google para teste sem rede externa
    await page.route("**/pagead2.googlesyndication.com/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "window.adsbygoogle = window.adsbygoogle || [];",
      });
    });

    await page.addInitScript(() => {
      localStorage.clear();
      // Simula ID do AdSense configurado em runtime
      (window as any).__VITE_MOCK_ADSENSE = "ca-pub-1234567890123456";
    });

    await page.goto("/");
    const acceptBtn = page.locator("#consent-btn-accept");
    await acceptBtn.click();

    const consentVal = await page.evaluate(() => localStorage.getItem("ping:cookie_consent"));
    expect(consentVal).toBe("accepted");
  });

  test("rota /studio NÃO renderiza tags <ins class='adsbygoogle'> nem scripts de ads em nenhuma hipótese", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ping:cookie_consent", "accepted");
      localStorage.setItem("ping:creator_authorized", "true");
    });

    const response = await page.goto("/studio");
    expect(response?.status()).toBe(200);

    // CSP estrita em /studio (sem domínios de ads)
    const csp = response?.headers()["content-security-policy"] || "";
    expect(csp).not.toContain("pagead2.googlesyndication.com");
    expect(csp).toContain("default-src 'self'");

    // Aguarda montagem do host
    await expect(page.locator("#start")).toBeVisible();

    // Zero ins e zero scripts de ads
    const adsIns = await page.locator("ins.adsbygoogle").count();
    expect(adsIns).toBe(0);

    const adsScript = await page.locator('script[src*="pagead2.googlesyndication.com"]').count();
    expect(adsScript).toBe(0);
  });

  test("rota de espectador /?room=... NÃO renderiza tags <ins class='adsbygoogle'> nem scripts de ads", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ping:cookie_consent", "accepted");
    });

    const response = await page.goto("/?room=audit-test-room");
    expect(response?.status()).toBe(200);

    // CSP estrita no viewer
    const csp = response?.headers()["content-security-policy"] || "";
    expect(csp).not.toContain("pagead2.googlesyndication.com");

    const adsIns = await page.locator("ins.adsbygoogle").count();
    expect(adsIns).toBe(0);

    const adsScript = await page.locator('script[src*="pagead2.googlesyndication.com"]').count();
    expect(adsScript).toBe(0);
  });

  test("diferenciação de CSP por rota: / tem permissão de ads, mas /studio e /?room= não têm", async ({ page }) => {
    const lobbyRes = await page.goto("/");
    const lobbyCsp = lobbyRes?.headers()["content-security-policy"] || "";
    expect(lobbyCsp).toContain("pagead2.googlesyndication.com");

    const studioRes = await page.goto("/studio");
    const studioCsp = studioRes?.headers()["content-security-policy"] || "";
    expect(studioCsp).not.toContain("pagead2.googlesyndication.com");

    const roomRes = await page.goto("/?room=csp-check");
    const roomCsp = roomRes?.headers()["content-security-policy"] || "";
    expect(roomCsp).not.toContain("pagead2.googlesyndication.com");
  });
});
