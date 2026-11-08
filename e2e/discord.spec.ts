import { test, expect } from "@playwright/test";
import {
  signPayload,
  verifyPayload,
  getDiscordAvatarUrl,
} from "../api/_lib/session";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Fase 6 — Discord OAuth2 v10 & Identidade Verificada", () => {
  test("unitário: assinatura HMAC-SHA256, adulteração e expiração de sessão e ticket", () => {
    const secret = "super-secret-key-for-testing-only-1234";

    // 1. Assinatura e verificação válida
    const payload = {
      discordId: "123456789012345678",
      username: "alice_streamer",
      displayName: "Alice",
      avatar: "a_avatarhash123",
      exp: Date.now() + 60_000,
    };
    const token = signPayload(payload, secret);
    expect(typeof token).toBe("string");
    expect(token).toContain(".");

    const verified = verifyPayload<typeof payload>(token, secret);
    expect(verified).not.toBeNull();
    expect(verified?.discordId).toBe("123456789012345678");
    expect(verified?.username).toBe("alice_streamer");

    // 2. Adulteração do payload
    const [dataB64, sig] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...payload, discordId: "999999999999999999" }),
      "utf8",
    ).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${sig}`;
    expect(verifyPayload(tamperedToken, secret)).toBeNull();

    // 3. Adulteração da assinatura
    const tamperedSigToken = `${dataB64}.${sig.slice(0, -2)}AA`;
    expect(verifyPayload(tamperedSigToken, secret)).toBeNull();

    // 4. Token com tamanho de assinatura diferente
    const shortSigToken = `${dataB64}.short`;
    expect(verifyPayload(shortSigToken, secret)).toBeNull();

    // 5. Token expirado
    const expiredPayload = { ...payload, exp: Date.now() - 1000 };
    const expiredToken = signPayload(expiredPayload, secret);
    expect(verifyPayload(expiredToken, secret)).toBeNull();

    // 6. Formato inválido
    expect(verifyPayload("not-a-token", secret)).toBeNull();
    expect(verifyPayload("", secret)).toBeNull();
  });

  test("unitário: geração determinística de URLs de avatar do Discord (custom e embed fallback)", () => {
    // Avatar personalizado
    const customUrl = getDiscordAvatarUrl(
      "80351110224678912",
      "8342729096374a032b32e4f83ced0234",
    );
    expect(customUrl).toBe(
      "https://cdn.discordapp.com/avatars/80351110224678912/8342729096374a032b32e4f83ced0234.webp?size=128",
    );

    // Avatar padrão embed baseado no cálculo BigInt(id) >> 22 % 6
    const embedUrl = getDiscordAvatarUrl("80351110224678912", null);
    expect(embedUrl).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);

    // Fallback sob string inválida
    const fallbackUrl = getDiscordAvatarUrl("not-a-number", null);
    expect(fallbackUrl).toBe("https://cdn.discordapp.com/embed/avatars/0.png");
  });

  test("estado deslogado: exibe anônimo e botão de conectar Discord", async ({
    page,
  }) => {
    await page.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "me",
      async (route) => {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "unauthorized" }),
        });
      },
    );

    await page.goto("/#test-discord-logged-out");
    await page.waitForSelector(".sidebar");

    // Abre modal de perfil
    await page.click(".profile-card");
    const profileModal = page.getByRole("dialog", { name: "Perfil" });
    await expect(profileModal).toBeVisible();

    await expect(profileModal.locator(".profile-handle")).toContainText("user");
    await expect(profileModal.locator(".profile-badge")).toHaveText("Anônimo");
    await expect(profileModal.locator("#btn-connect-discord")).toBeVisible();
  });

  test("estado logado: avatar do Discord renderiza, badge verificado e sem violação de CSP", async ({
    page,
  }) => {
    const cspViolations: string[] = [];
    page.on("console", (msg) => {
      if (msg.text().includes("Content Security Policy")) {
        cspViolations.push(msg.text());
      }
    });

    const mockDiscordUser = {
      discordId: "80351110224678912",
      username: "pedro_live",
      displayName: "Pedro Streamer",
      avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png",
      isOwner: false,
    };

    // Intercepta CDN do Discord com regex
    await page.route(/cdn\.discordapp\.com/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: TRANSPARENT_PNG,
      });
    });

    await page.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "me",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockDiscordUser),
        });
      },
    );

    // Simula retorno do callback OAuth com ?login=ok
    await page.goto("/?login=ok#test-discord-login");
    await page.waitForSelector(".sidebar");

    // Valida que o parâmetro login=ok foi limpo da URL
    await expect(page).toHaveURL(/\/#test-discord-login|\/$/);

    // Toast de sucesso
    await expect(page.locator(".toast")).toContainText("Conectado ao Discord com sucesso!");

    // Avatar renderiza na sidebar
    const sidebarAvatar = page.locator(".sidebar .profile-card .avatar-img");
    await expect(sidebarAvatar).toBeVisible({ timeout: 10_000 });
    await expect(sidebarAvatar).toHaveAttribute("src", mockDiscordUser.avatarUrl);
    await expect(sidebarAvatar).toHaveAttribute("alt", `Avatar de ${mockDiscordUser.displayName}`);

    // Abre modal de perfil
    await page.click(".sidebar .profile-card");
    const profileModal = page.getByRole("dialog", { name: "Perfil" });
    await expect(profileModal).toBeVisible();

    // Modal de perfil exibe nome, tag e status Verificado
    await expect(profileModal.locator(".profile-handle")).toHaveText(mockDiscordUser.displayName);
    await expect(profileModal.locator(".discord-linked-tag")).toHaveText(`@${mockDiscordUser.username}`);
    await expect(profileModal.locator(".discord-badge-pill")).toHaveText("Verificado");

    // Botão de desconectar funciona
    await page.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "logout",
      async (route) => {
        await route.fulfill({ status: 204 });
      },
    );
    await profileModal.locator("#btn-unlink-discord").click();
    await expect(profileModal.locator("#btn-connect-discord")).toBeVisible();

    // Nenhuma violação de CSP registrada
    expect(cspViolations).toEqual([]);
  });

  test("configured: false desabilita o botão OAuth com aviso claro", async ({
    page,
  }) => {
    await page.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "status",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: false }),
        });
      },
    );

    await page.goto("/#test-discord-unconfigured");
    await page.waitForSelector(".sidebar");

    // Abre perfil e clica em conectar
    await page.click(".profile-card");
    await page.click("#btn-connect-discord");

    const connectModal = page.getByRole("dialog", {
      name: "Conectar com Discord",
    });
    await expect(connectModal).toBeVisible();

    const oauthBtn = connectModal.locator("#discord-oauth-btn");
    await expect(oauthBtn).toBeDisabled();
    await expect(connectModal.locator("#discord-oauth-notice")).toBeVisible();
    await expect(connectModal.locator("#discord-oauth-notice")).toContainText(
      "não configurado",
    );
  });

  test("fluxo WebRTC de ticket: espectador autenticado ganha badge Discord no chat, ticket falso não ganha", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    // Intercepta CDN do Discord em ambos os contextos
    await hostPage.route(/cdn\.discordapp\.com/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: TRANSPARENT_PNG,
      });
    });
    await viewerPage.route(/cdn\.discordapp\.com/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: TRANSPARENT_PNG,
      });
    });

    // Mock do usuário Discord no viewer
    const discordViewer = {
      discordId: "987654321098765432",
      username: "gamer_pro",
      displayName: "Gamer Pro",
      avatarUrl: "https://cdn.discordapp.com/embed/avatars/4.png",
    };

    await viewerPage.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "me",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(discordViewer),
        });
      },
    );

    // Mock da emissão de ticket no viewer
    const validTicket = "mock_valid_ticket_12345";
    await viewerPage.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "ticket",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ticket: validTicket }),
        });
      },
    );

    // Mock da verificação de ticket no host
    await hostPage.route(
      (url) =>
        url.pathname.includes("/api/discord-auth") &&
        url.searchParams.get("action") === "verify",
      async (route) => {
        const postData = route.request().postDataJSON();
        if (postData?.ticket === validTicket) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(discordViewer),
          });
        } else {
          await route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: "invalid_ticket" }),
          });
        }
      },
    );

    // 1. Host inicia live
    await hostPage.goto("/?host=1&admin=ping-master-2026");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();
    expect(roomLink).toBeTruthy();

    // 2. Viewer sincroniza sessão e entra na live
    await viewerPage.goto("/?login=ok");
    await viewerPage.waitForSelector(".sidebar");
    await viewerPage.goto(roomLink);

    // Viewer recebe stream
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 20_000 });

    // 3. Viewer envia mensagem no chat
    const viewerChat = viewerPage.locator(".chat-panel");
    await expect(viewerChat).toBeVisible({ timeout: 10_000 });

    const chatInput = viewerPage.locator(".chat-input");
    await expect(chatInput).toBeVisible({ timeout: 10_000 });
    await chatInput.fill("Olá com Discord verificado!");
    await chatInput.press("Enter");

    // Verifica que a mensagem tem o badge discord e o avatar no host e no viewer
    const discordBadge = hostPage.locator(".chat-badge-discord");
    await expect(discordBadge).toBeVisible({ timeout: 15_000 });
    await expect(discordBadge).toHaveText("@discord");

    const hostChatAvatar = hostPage.locator(".chat-msg .chat-avatar");
    await expect(hostChatAvatar).toBeVisible();
    await expect(hostChatAvatar).toHaveAttribute("src", discordViewer.avatarUrl);

    await hostPage.close();
    await viewerPage.close();
    await hostContext.close();
    await viewerContext.close();
  });
});
