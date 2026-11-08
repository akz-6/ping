import { test, expect } from "@playwright/test";

test.describe("Fase 8 — Cloudflare Calls (SFU) & Failover Automático", () => {
  test("unitário da API: /api/calls retorna ok:false sem credenciais e 503 em actions de mídia", async ({
    request,
  }) => {
    // 1. Health check retorna ok: false sem credenciais
    const healthRes = await request.post("/api/calls", {
      data: { action: "health" },
    });
    expect(healthRes.status()).toBe(200);
    const healthData = await healthRes.json();
    expect(healthData.ok).toBe(false);

    // 2. Outras ações retornam 503 indicando sfu_unavailable
    const sessionRes = await request.post("/api/calls", {
      data: { action: "session.new" },
    });
    expect(sessionRes.status()).toBe(503);
    const sessionData = await sessionRes.json();
    expect(sessionData.error).toBe("sfu_unavailable");
  });

  test("failover inicial para P2P: com /api/calls retornando 503, a sala sobe em P2P e o viewer assiste", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    // Stuba /api/calls em 503 no host e no viewer
    await hostPage.route("**/api/calls**", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "sfu_unavailable" }),
      });
    });

    await viewerPage.route("**/api/calls**", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "sfu_unavailable" }),
      });
    });

    // 1. Host inicia live
    await hostPage.goto("/?host=1&admin=ping-master-2026");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();

    // 2. Viewer acessa a sala e assiste via P2P
    await viewerPage.goto(roomLink);
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 15_000 });
    await expect(viewerPage.locator("#live-badge")).toBeVisible();

    await hostContext.close();
    await viewerContext.close();
  });

  test("fallback por espectador: se SFU pull falhar com 503, viewer envia transport-fallback e recebe via P2P", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    // Stuba /api/calls para simular SFU funcionando no host, mas falhando no viewer
    await hostPage.route("**/api/calls**", async (route) => {
      const postData = route.request().postDataJSON();
      if (postData?.action === "health") {
        return route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
      }
      if (postData?.action === "session.new") {
        return route.fulfill({ status: 200, body: JSON.stringify({ sessionId: "mock-host-session-123" }) });
      }
      if (postData?.action === "tracks.publish") {
        return route.fulfill({
          status: 200,
          body: JSON.stringify({
            sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
            tracks: [{ mid: "0", trackName: "video" }],
          }),
        });
      }
      return route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
    });

    // No viewer, tracks.pull falha com 503
    await viewerPage.route("**/api/calls**", async (route) => {
      const postData = route.request().postDataJSON();
      if (postData?.action === "tracks.pull") {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "sfu_unavailable" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: "mock-viewer-session-456", ok: true }),
      });
    });

    // 1. Host inicia live
    await hostPage.goto("/?host=1&admin=ping-master-2026");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();

    // 2. Viewer entra na sala: pull do SFU falha, emite transport-fallback e conecta via P2P
    await viewerPage.goto(roomLink);
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 15_000 });
    await expect(viewerPage.locator("#live-badge")).toBeVisible();

    await hostContext.close();
    await viewerContext.close();
  });

  test("controle de sala e chat funcionam durante fallback P2P", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    // Stuba /api/calls em 503 (modo fallback P2P)
    await hostPage.route("**/api/calls**", (route) => {
      route.fulfill({ status: 503, body: JSON.stringify({ error: "sfu_unavailable" }) });
    });
    await viewerPage.route("**/api/calls**", (route) => {
      route.fulfill({ status: 503, body: JSON.stringify({ error: "sfu_unavailable" }) });
    });

    // 1. Host inicia live
    await hostPage.goto("/?host=1&admin=ping-master-2026");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();

    // 2. Viewer conecta
    await viewerPage.goto(roomLink);
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 15_000 });

    // 3. Teste de Chat
    const chatInput = viewerPage.locator(".chat-input");
    await chatInput.fill("Olá pelo modo fallback!");
    await viewerPage.locator(".chat-send-btn").click();

    await expect(hostPage.locator(".chat-msg-text").first()).toHaveText("Olá pelo modo fallback!");

    // 4. Teste de Pausa
    await hostPage.locator("#pause-stream").click();
    await expect(viewerPage.locator("#pause-overlay")).toBeVisible({ timeout: 5000 });

    await hostPage.locator("#pause-stream").click();
    await expect(viewerPage.locator("#pause-overlay")).toBeHidden({ timeout: 5000 });

    await hostContext.close();
    await viewerContext.close();
  });
});
