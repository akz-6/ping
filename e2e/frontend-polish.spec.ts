import { expect, test } from "@playwright/test";

test.describe("Polimento Frontend & Pontas Soltas", () => {
  test("título dinâmico da página no lobby, viewer e host", async ({ page }) => {
    // 1. Lobby
    await page.goto("/");
    await expect(page).toHaveTitle("Ping — Salas ao Vivo");

    // 2. Viewer
    await page.goto("/?room=ping-test1234");
    await expect(page).toHaveTitle("Ping — Transmissão (ping-test1234)");

    // 3. Host
    await page.goto("/?host=1&admin=ping-master-2026");
    await expect(page).toHaveTitle("Ping — Compartilhar Tela");
  });

  test("viewer possui botão de saída no bar e link para voltar ao lobby no status", async ({ page }) => {
    await page.goto("/?room=ping-inexistente99");
    const status = page.locator("#status");
    await expect(status).toBeVisible({ timeout: 15_000 });
    const backBtn = status.locator(".btn-back-lobby");
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toHaveText("← Voltar ao Lobby");
    await expect(backBtn).toHaveAttribute("href", "/");

    // Botão de sair no bar
    const leaveBtn = page.locator("#leave");
    await expect(leaveBtn).toHaveAttribute("href", "/");
  });

  test("empty state de busca sem resultados possui botão 'Limpar busca' que restaura o feed", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();

    // Digita busca sem correspondência
    await page.locator(".search-input").fill("xyzinexistente999");
    await expect(page.locator(".empty-title")).toHaveText("Nenhuma sala encontrada");

    // Botão 'Limpar busca'
    const resetBtn = page.locator(".empty .btn-primary");
    await expect(resetBtn).toHaveText("Limpar busca");
    await resetBtn.click();

    // Input limpo e feed restaurado
    await expect(page.locator(".search-input")).toHaveValue("");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();
  });

  test("avatares possuem paleta determinística variada (avatar-c0 até c5)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();

    const avatars = page.locator(".avatar");
    const count = await avatars.count();
    expect(count).toBeGreaterThan(0);

    // Verifica que pelo menos um avatar tem uma classe de cor avatar-c[0-5]
    const classes = await avatars.first().getAttribute("class");
    expect(classes).toMatch(/avatar-c[0-5]/);
  });

  test("modal de perfil atualiza o avatar e o apelido em tempo real ao digitar", async ({ page }) => {
    await page.goto("/");
    await page.locator(".profile-card").click();

    const dlg = page.getByRole("dialog", { name: "Seu perfil" });
    await expect(dlg).toBeVisible();

    const nickInput = dlg.getByLabel("Apelido de exibição");
    await nickInput.fill("EstrelaNinja");

    // Valida que o preview do cabeçalho do perfil mudou imediatamente
    await expect(dlg.locator(".profile-handle")).toHaveText("EstrelaNinja");
    await expect(dlg.locator(".profile-head .avatar")).toHaveText("E");
  });

  test("viewer possui botão de popout (Picture-in-Picture) e elemento OSD", async ({ page }) => {
    await page.goto("/?room=ping-testpip123");
    const pipBtn = page.locator("#pip");
    await expect(pipBtn).toBeAttached();
    await expect(pipBtn).toHaveText("Popout");
    await expect(pipBtn).toHaveAttribute("title", /Popout/);

    // Clica no botão de popout (disparando ação)
    await pipBtn.dispatchEvent("click");
    const osd = page.locator("#osd");
    await expect(osd).toBeVisible();
  });

  test("ferramentas de transmissão do Discord no host (trocar tela, pausar, mutar áudio)", async ({ page }) => {
    await page.goto("/?host=1&admin=ping-master-2026");
    await page.locator("#start").click();
    await expect(page.locator("#live")).toBeVisible({ timeout: 15_000 });

    const changeBtn = page.locator("#change-source");
    const pauseBtn = page.locator("#pause-stream");
    const muteBtn = page.locator("#mute-audio");
    const livePill = page.locator(".discord-live-pill");
    const pausedOverlay = page.locator("#host-paused-overlay");

    await expect(changeBtn).toBeVisible();
    await expect(changeBtn).toHaveText(/Trocar Tela/);

    await expect(pauseBtn).toBeVisible();
    await expect(pauseBtn).toHaveText("⏸️ Pausar Tela");

    await expect(muteBtn).toBeVisible();
    await expect(muteBtn).toHaveText("🔊 Áudio Ativo");

    await expect(livePill).toBeVisible();
    await expect(livePill).toHaveText(/AO VIVO/);
    await expect(livePill.locator(".pulse-dot")).toBeVisible();

    // Testa alternância de mute do áudio da transmissão
    await muteBtn.click();
    await expect(muteBtn).toHaveText("🔇 Áudio Mudo");
    await expect(muteBtn).toHaveClass(/active/);
    await muteBtn.click();
    await expect(muteBtn).toHaveText("🔊 Áudio Ativo");
    await expect(muteBtn).not.toHaveClass(/active/);

    // Testa alternância de pausa de transmissão no host
    await pauseBtn.click();
    await expect(pauseBtn).toHaveText("▶️ Retomar Tela");
    await expect(pauseBtn).toHaveClass(/active/);
    await expect(pausedOverlay).toBeVisible();
    await pauseBtn.click();
    await expect(pauseBtn).toHaveText("⏸️ Pausar Tela");
    await expect(pauseBtn).not.toHaveClass(/active/);
    await expect(pausedOverlay).toBeHidden();
  });

  test("funcionalidades de transmissão do Discord no viewer (Modo Teatro, Badge Ao Vivo, Stats Modal)", async ({ page }) => {
    await page.goto("/?room=ping-testpip123");
    await page.locator("#bar").evaluate((el) => { el.hidden = false; });

    const liveBadge = page.locator("#live-badge");
    const pauseOverlay = page.locator("#pause-overlay");
    const theaterBtn = page.locator("#theater");
    const statsModal = page.locator("#discord-stats-modal");
    const qualityBadge = page.locator("#quality");
    const closeStatsBtn = page.locator("#close-stats");
    const viewer = page.locator(".viewer");

    await expect(liveBadge).toBeAttached();
    await expect(liveBadge).toHaveText(/AO VIVO/);
    await expect(liveBadge.locator(".pulse-dot")).toBeAttached();

    await expect(pauseOverlay).toBeAttached();
    await expect(pauseOverlay.locator(".paused-title")).toHaveText("Transmissão Pausada");

    // Modo Teatro via botão
    await expect(theaterBtn).toBeAttached();
    await expect(theaterBtn).toHaveText("Teatro");
    await theaterBtn.click();
    await expect(viewer).toHaveClass(/theater-mode/);
    await expect(theaterBtn).toHaveClass(/active/);

    // Desativa Modo Teatro via botão
    await theaterBtn.click();
    await expect(viewer).not.toHaveClass(/theater-mode/);
    await expect(theaterBtn).not.toHaveClass(/active/);

    // Modo Teatro via atalho de teclado 't'
    await page.keyboard.press("t");
    await expect(viewer).toHaveClass(/theater-mode/);
    await page.keyboard.press("t");
    await expect(viewer).not.toHaveClass(/theater-mode/);

    // Modal de Estatísticas WebRTC (Discord RTC Stats)
    await expect(statsModal).toBeAttached();
    await expect(statsModal).toHaveAttribute("hidden", "");

    // Abre ao clicar no badge de qualidade
    await qualityBadge.click();
    await expect(statsModal).not.toHaveAttribute("hidden", "");
    await expect(statsModal.locator(".discord-stats-title")).toHaveText(/Estatísticas da Transmissão/);
    await expect(statsModal.locator("#ds-status")).toBeVisible();
    await expect(statsModal.locator("#ds-fps")).toBeVisible();
    await expect(statsModal.locator("#ds-codec")).toBeVisible();

    // Fecha ao clicar no botão fechar (X)
    await closeStatsBtn.click();
    await expect(statsModal).toHaveAttribute("hidden", "");

    // Abre via atalho de teclado 'd' e fecha via Escape
    await page.keyboard.press("d");
    await expect(statsModal).not.toHaveAttribute("hidden", "");
    await page.keyboard.press("Escape");
    await expect(statsModal).toHaveAttribute("hidden", "");
  });
});
