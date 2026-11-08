import { test, expect } from "./fixtures";
import { ChatHub } from "../src/chat/chat-hub";

test.describe("Fase 5 — Palco + Chat em Tempo Real", () => {
  test("ChatHub (host authority): token bucket 1 msg/1,2s, rajada 3, e silêncio de 30s após 5 violações", () => {
    let broadcasted: any[] = [];
    let peerSent: { peerId: string; msg: any }[] = [];

    const hub = new ChatHub({
      hostUser: {
        peerId: "host-1",
        name: "Anfitrião",
        badge: "host",
        avatar: null,
      },
      onBroadcast: (m) => broadcasted.push(m),
      onSendToPeer: (p, m) => peerSent.push({ peerId: p, msg: m }),
    });

    hub.registerViewer({
      peerId: "viewer-1",
      name: "Amigo",
      badge: null,
      avatar: null,
    });

    let now = 100_000;

    // 1. Rajada de 3 mensagens permitida (tokens: 3 -> 2 -> 1 -> 0)
    expect(hub.handleViewerSend("viewer-1", "Msg 1", now).success).toBe(true);
    expect(hub.handleViewerSend("viewer-1", "Msg 2", now).success).toBe(true);
    expect(hub.handleViewerSend("viewer-1", "Msg 3", now).success).toBe(true);

    // 4ª mensagem imediata (tokens < 1) -> violação 1 ('rate')
    const r4 = hub.handleViewerSend("viewer-1", "Msg 4", now);
    expect(r4.success).toBe(false);
    expect(r4.rejected).toBe("rate");

    // Mais 3 tentativas imediatas -> violações 2, 3, 4 ('rate')
    expect(hub.handleViewerSend("viewer-1", "Spam 1", now).rejected).toBe("rate");
    expect(hub.handleViewerSend("viewer-1", "Spam 2", now).rejected).toBe("rate");
    expect(hub.handleViewerSend("viewer-1", "Spam 3", now).rejected).toBe("rate");

    // 5ª violação -> silenciado por 30s ('muted')
    const r8 = hub.handleViewerSend("viewer-1", "Spam 4", now);
    expect(r8.success).toBe(false);
    expect(r8.rejected).toBe("muted");

    // Durante os 30s continua mutado
    now += 15_000;
    expect(hub.handleViewerSend("viewer-1", "Ainda mudo", now).rejected).toBe("muted");

    // Passados 30s, o silêncio acaba e tokens recarregam
    now += 16_000;
    expect(hub.handleViewerSend("viewer-1", "Livre do mute", now).success).toBe(true);
  });

  test("ChatHub: buffer circular de 50 mensagens descarta mais antigas", () => {
    const hub = new ChatHub({
      hostUser: {
        peerId: "host-1",
        name: "Anfitrião",
        badge: "host",
        avatar: null,
      },
      onBroadcast: () => {},
      onSendToPeer: () => {},
    });

    for (let i = 1; i <= 60; i++) {
      hub.postHostMessage(`Mensagem ${i}`);
    }

    const history = hub.getHistory();
    expect(history.length).toBe(50);
    expect(history[0].text).toBe("Mensagem 11");
    expect(history[49].text).toBe("Mensagem 60");
  });

  test("fluxo ponta a ponta: viewer envia mensagem, host recebe; host responde com badge HOST", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    // 1. Host inicia live
    await hostPage.goto("/?host=1&admin=ping-master-2026");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();

    // 2. Viewer entra na live
    await viewerPage.goto(roomLink);
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 20_000 });

    // 3. Viewer envia mensagem no chat
    const viewerChat = viewerPage.locator(".chat-panel");
    await expect(viewerChat).toBeVisible();

    const viewerInput = viewerPage.locator(".chat-input");
    await viewerInput.fill("Salve anfitrião! Live tá voando");
    await viewerPage.locator(".chat-send-btn").click();

    // Verifica que mensagem aparece na lista do viewer e do host
    await expect(viewerPage.locator(".chat-msg-text").first()).toHaveText(
      "Salve anfitrião! Live tá voando",
    );
    await expect(hostPage.locator(".chat-msg-text").first()).toHaveText(
      "Salve anfitrião! Live tá voando",
    );

    // 4. Host responde no chat
    const hostInput = hostPage.locator(".chat-input");
    await hostInput.fill("Bem-vindo! Tamo junto");
    await hostPage.locator(".chat-send-btn").click();

    // Verifica que a resposta aparece no viewer com badge HOST
    const hostMsgOnViewer = viewerPage.locator(".chat-msg").last();
    await expect(hostMsgOnViewer.locator(".chat-msg-text")).toHaveText(
      "Bem-vindo! Tamo junto",
    );
    await expect(hostMsgOnViewer.locator(".chat-badge-host")).toHaveText("HOST");

    // 5. Novo viewer entra e recebe histórico (chat-history)
    const viewer2Context = await browser.newContext();
    const viewer2Page = await viewer2Context.newPage();
    await viewer2Page.goto(roomLink);
    await expect(viewer2Page.locator("#bar")).toBeVisible({ timeout: 20_000 });

    const viewer2Messages = viewer2Page.locator(".chat-msg-text");
    await expect(viewer2Messages.first()).toHaveText("Salve anfitrião! Live tá voando");
    await expect(viewer2Messages.last()).toHaveText("Bem-vindo! Tamo junto");

    await viewer2Context.close();
    await viewerContext.close();
    await hostContext.close();
  });

  test("segurança XSS: caracteres HTML e scripts são renderizados estritamente como texto plano", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    let alertFired = false;
    viewerPage.on("dialog", () => {
      alertFired = true;
    });

    await hostPage.goto("/?host=1&admin=ping-master-2026");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();

    await viewerPage.goto(roomLink);
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 20_000 });

    const xssPayload = '<img src=x onerror="alert(1)"> <script>alert(2)</script>';
    await viewerPage.locator(".chat-input").fill(xssPayload);
    await viewerPage.locator(".chat-send-btn").click();

    const msgText = viewerPage.locator(".chat-msg-text").first();
    await expect(msgText).toHaveText(xssPayload);
    expect(alertFired).toBe(false);

    // Confirma no DOM que nenhuma tag <img> foi injetada no texto
    const imgInsideText = await msgText.locator("img").count();
    expect(imgInsideText).toBe(0);

    await viewerContext.close();
    await hostContext.close();
  });

  test("ocultar/mostrar chat com atalho C e contador de não lidas quando recolhido", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const viewerContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    await hostPage.goto("/?host=1&admin=ping-master-2026");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();

    await viewerPage.goto(roomLink);
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 20_000 });
    await expect(hostPage.locator(".chat-msg-system")).toBeVisible({ timeout: 10_000 });

    const chatPanel = viewerPage.locator(".chat-panel");
    await expect(chatPanel).toBeVisible();

    // 1. Fecha o chat via botão fechar (X)
    await viewerPage.locator(".chat-close-btn").click();
    await expect(chatPanel).toBeHidden();

    // 2. Host envia mensagem enquanto o chat do viewer está fechado
    await hostPage.locator(".chat-input").fill("Alô, alguém aí?");
    await hostPage.locator(".chat-send-btn").click();

    // 3. Viewer visualiza contador de não lidas (1) no botão do chat
    const unreadBadge = viewerPage.locator(".chat-unread-badge");
    await expect(unreadBadge).toBeVisible();
    await expect(unreadBadge).toHaveText("1");

    // 4. Viewer reabre o chat via atalho 'c'
    await viewerPage.keyboard.press("c");
    await expect(chatPanel).toBeVisible();
    await expect(unreadBadge).toBeHidden();

    await viewerContext.close();
    await hostContext.close();
  });

  test("layout empilha palco e chat em coluna no viewport mobile de 375px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/?room=ping-testmobile123");
    await expect(page.locator(".palco-layout")).toBeVisible({ timeout: 10_000 });

    // Em mobile (<900px), abre o chat via atalho 'c'
    await page.keyboard.press("c");
    const chatPanel = page.locator(".chat-panel");
    await expect(chatPanel).toBeVisible({ timeout: 10_000 });

    const palcoBox = await page.locator(".palco-layout").boundingBox();
    const stageBox = await page.locator(".palco-stage").boundingBox();
    const chatBox = await chatPanel.boundingBox();

    expect(palcoBox).toBeTruthy();
    expect(stageBox).toBeTruthy();
    expect(chatBox).toBeTruthy();

    // No layout mobile empilhado, o stage fica no topo e o chat fica embaixo (chatBox.y >= stageBox.y)
    expect(chatBox!.y).toBeGreaterThanOrEqual(stageBox!.y + stageBox!.height - 5);
  });
});
