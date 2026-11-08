import { test, expect } from "@playwright/test";

test.describe("Fase G — Painel Social e Amigos", () => {
  test("usuário não logado visualiza CTA para conectar Discord no rail", async ({ page }) => {
    await page.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "status",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: true }),
        });
      },
    );

    await page.goto("/");
    await page.waitForSelector(".ping-rail");

    const locked = page.locator(".friends__locked");
    await expect(locked).toBeVisible();
    await expect(locked).toContainText("Entre com o Discord");

    const discordBtn = locked.locator(".btn--discord");
    await expect(discordBtn).toBeVisible();
    await expect(discordBtn).toHaveAttribute("href", "/api/discord-auth?action=login");
  });

  test("usuário logado visualiza painel de amigos e formulário de adicionar", async ({ page }) => {
    await page.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "status",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: true }),
        });
      },
    );

    await page.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "me",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            discordId: "998877665544332211",
            username: "gamer_pro",
            displayName: "Gamer Pro",
            avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
          }),
        });
      },
    );

    await page.route(
      (url) =>
        url.pathname.includes("/api/friends") &&
        url.searchParams.get("action") === "list",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            friends: [
              {
                discordId: "111222333444",
                username: "amigo_streamer",
                displayName: "Amigo Streamer",
                avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
                presence: "hosting",
                room: { id: "sala-do-amigo", name: "Live do Amigo", hasPassword: false },
              },
              {
                discordId: "555666777888",
                username: "amigo_online",
                displayName: "Amigo Online",
                avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png",
                presence: "online",
              },
            ],
            incoming: [],
            outgoingCount: 0,
            settings: { showActivity: true },
          }),
        });
      },
    );

    await page.goto("/");
    await page.waitForSelector(".ping-rail");

    // O painel exibe título Amigos e formulário de adicionar
    await expect(page.locator(".friends__title")).toHaveText("Amigos");
    await expect(page.locator(".friends__add input")).toBeVisible();

    // Exibe amigo transmitindo com botão Entrar
    const friendHosting = page.locator('.friend[data-discord-id="111222333444"]');
    await expect(friendHosting).toBeVisible();
    await expect(friendHosting.locator(".friend__name")).toHaveText("Amigo Streamer");
    await expect(friendHosting.locator(".btn--primary")).toHaveText("Entrar");

    // Exibe amigo online
    const friendOnline = page.locator('.friend[data-discord-id="555666777888"]');
    await expect(friendOnline).toBeVisible();
    await expect(friendOnline.locator(".friend__name")).toHaveText("Amigo Online");
  });
});
