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
    await page.goto("/?demo=1");
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
    await page.goto("/?demo=1");
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

  test("conectar e desconectar conta do Discord no perfil atualiza a identidade", async ({ page }) => {
    await page.goto("/");
    await page.locator(".profile-card").click();

    const dlg = page.getByRole("dialog", { name: "Seu perfil" });
    await expect(dlg).toBeVisible();

    // Clica no botão de conectar Discord
    const connectBtn = dlg.locator("#btn-connect-discord");
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    // Modal de conexão do Discord abre
    const discordModal = page.getByRole("dialog", { name: "Conectar com Discord" });
    await expect(discordModal).toBeVisible();

    const usernameInput = discordModal.locator("#discord-username-input");
    await usernameInput.fill("pedro_streamer#1234");

    // Confirma vínculo
    await discordModal.locator("#discord-connect-confirm").click();

    // Toast de sucesso
    await expect(page.locator(".toast").last()).toContainText("vinculada com sucesso");

    // Modal de perfil agora exibe a caixa de conta conectada
    await expect(dlg.locator(".discord-linked-box")).toBeVisible();
    await expect(dlg.locator(".discord-linked-tag")).toHaveText("@pedro_streamer#1234");
    await expect(dlg.locator(".profile-badge")).toContainText("Discord");

    // Desconecta a conta do Discord
    const unlinkBtn = dlg.locator("#btn-unlink-discord");
    await expect(unlinkBtn).toBeVisible();
    await unlinkBtn.click();

    await expect(page.locator(".toast").last()).toContainText("desconectada");
    await expect(dlg.locator("#btn-connect-discord")).toBeVisible();
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

  test("host possui botão de pausar e parar live, mantendo o mesmo link permanente da sala", async ({ page }) => {
    await page.goto("/?host=1&admin=ping-master-2026");
    await page.locator("#start").click();
    await expect(page.locator("#live")).toBeVisible({ timeout: 15_000 });

    const linkInput = page.locator("#link");
    const initialLink = await linkInput.inputValue();
    expect(initialLink).toContain("?room=");

    const stopStreamBtn = page.locator("#stop-stream");
    const stoppedOverlay = page.locator("#host-stopped-overlay");
    const resumeBtn = page.locator("#btn-resume-live");

    await expect(stopStreamBtn).toBeVisible();
    await expect(stopStreamBtn).toHaveText("⏹️ Parar Live");

    // 1. Clica em Parar Live: o stream para, mas a sala e o link continuam os mesmos
    await stopStreamBtn.click();
    await expect(stopStreamBtn).toHaveText("▶️ Iniciar Live");
    await expect(stopStreamBtn).toHaveClass(/active/);
    await expect(stoppedOverlay).toBeVisible();

    const linkAfterStop = await linkInput.inputValue();
    expect(linkAfterStop).toBe(initialLink);

    // 2. Retoma a live clicando em Iniciar Transmissão: o link continua o mesmo
    await resumeBtn.click();
    await expect(stoppedOverlay).toBeHidden();
    await expect(stopStreamBtn).toHaveText("⏹️ Parar Live");
    await expect(stopStreamBtn).not.toHaveClass(/active/);

    const linkAfterResume = await linkInput.inputValue();
    expect(linkAfterResume).toBe(initialLink);
  });

  test("host pode alterar senha, tirar senha e alternar visibilidade no lobby em tempo real", async ({ page }) => {
    await page.goto("/?host=1&admin=ping-master-2026");
    await page.locator("#start").click();
    await expect(page.locator("#live")).toBeVisible({ timeout: 15_000 });

    const toggleVisBtn = page.locator("#btn-toggle-visibility");
    const changePwBtn = page.locator("#btn-change-password");
    const removePwBtn = page.locator("#btn-remove-password");

    await expect(toggleVisBtn).toBeVisible();
    await expect(toggleVisBtn).toHaveText("👁️ Sala Visível no Lobby");

    // 1. Alterna visibilidade no lobby para oculta
    await toggleVisBtn.click();
    await expect(toggleVisBtn).toHaveText("🙈 Sala Oculta (Apenas Link)");
    await expect(toggleVisBtn).toHaveClass(/btn-hidden-active/);

    // Alterna de volta para visível
    await toggleVisBtn.click();
    await expect(toggleVisBtn).toHaveText("👁️ Sala Visível no Lobby");
    await expect(toggleVisBtn).not.toHaveClass(/btn-hidden-active/);

    // 2. Define nova senha via prompt
    page.once("dialog", async (dialog) => {
      await dialog.accept("segredo123");
    });
    await changePwBtn.click();
    await expect(changePwBtn).toHaveText("🔑 Senha: segredo123");
    await expect(removePwBtn).toBeVisible();

    // 3. Remove a senha clicando em Tirar Senha
    await removePwBtn.click();
    await expect(changePwBtn).toHaveText("🔑 Colocar Senha");
    await expect(removePwBtn).toBeHidden();
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

  test("espectador pode diminuir qualidade do vídeo (seletor 720p/480p/360p e atalho Q) para aumentar velocidade e economizar internet", async ({ page }) => {
    await page.goto("/?room=ping-testquality123");
    await page.locator("#bar").evaluate((el) => { el.hidden = false; });

    const qualitySelect = page.locator("#quality-preset");
    const osd = page.locator("#osd");
    const dsPreset = page.locator("#ds-preset");

    await expect(qualitySelect).toBeVisible();
    await expect(qualitySelect).toHaveValue("source");

    // 1. Altera qualidade para 480p pelo select
    await qualitySelect.selectOption("480p");
    await expect(qualitySelect).toHaveValue("480p");
    await expect(osd).toBeVisible();
    await expect(osd).toHaveText(/480p \(Mais Rápido\)/);
    await expect(dsPreset).toHaveText(/480p \(Mais Rápido\)/);

    // 2. Valida persistência no localStorage
    const saved = await page.evaluate(() => localStorage.getItem("ping_viewer_quality"));
    expect(saved).toBe("480p");

    // 3. Cicla para 360p via atalho de teclado 'q'
    await page.keyboard.press("q");
    await expect(qualitySelect).toHaveValue("360p");
    await expect(osd).toBeVisible();
    await expect(osd).toHaveText(/360p \(Super Leve\)/);

    // 4. Recarrega a página e valida restauração automática da preferência do usuário
    await page.reload();
    await page.locator("#bar").evaluate((el) => { el.hidden = false; });
    await expect(qualitySelect).toHaveValue("360p");
  });

  test("transmissão ponta a ponta: visualizador reduz qualidade e host adapta parâmetros de envio de vídeo", async ({ browser }) => {
    const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const viewerContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    await hostPage.goto("/?host=1&admin=ping-master-2026");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();

    await viewerPage.goto(roomLink);
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 20_000 });

    const qualitySelect = viewerPage.locator("#quality-preset");
    await expect(qualitySelect).toBeVisible();

    // Visualizador muda qualidade para 360p
    await qualitySelect.selectOption("360p");
    await expect(viewerPage.locator("#osd")).toHaveText(/360p/);

    // Host verifica que a qualidade personalizada do viewer foi registrada no diagnóstico
    await hostPage.bringToFront();
    await hostPage.locator("#copy-diag").click({ force: true });
    const hostDiag = await hostPage.evaluate(() => (window as any).__pingLastDiag);

    expect(hostDiag).toBeTruthy();
    expect(hostDiag.viewers.length).toBeGreaterThan(0);
    expect(hostDiag.viewers[0].qualityPreset).toBe("360p");

    await hostContext.close();
    await viewerContext.close();
  });

  test("anfitrião possui opções ampliadas de FPS (até 240) e espectador escolhe FPS limitado ao que o anfitrião liberou", async ({ browser }) => {
    const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const viewerContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });

    const hostPage = await hostContext.newPage();
    const viewerPage = await viewerContext.newPage();

    // 1. Host abre e verifica opções ampliadas de FPS (30, 60, 120, 144, 240)
    await hostPage.goto("/?host=1&admin=ping-master-2026");
    const fpsHostSelect = hostPage.locator("#fps");
    await expect(fpsHostSelect).toBeVisible();

    const fpsOptions = await fpsHostSelect.locator("option").allTextContents();
    expect(fpsOptions).toEqual(expect.arrayContaining(["30 FPS", "60 FPS (Padrão)", "120 FPS (Ultra Gamer)", "144 FPS (Competitivo)", "240 FPS (Extremo)"]));

    // Seleciona 120 FPS e inicia live
    await fpsHostSelect.selectOption("120");
    await hostPage.locator("#start").click();
    await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
    const roomLink = await hostPage.locator("#link").inputValue();

    // 2. Viewer conecta na sala
    await viewerPage.goto(roomLink);
    await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 20_000 });

    const fpsViewerSelect = viewerPage.locator("#fps-selector");
    await expect(fpsViewerSelect).toBeVisible();

    // Verifica que o viewer recebeu as opções limitadas ao teto liberado pelo anfitrião (120)
    const viewerOptions = await fpsViewerSelect.locator("option").allTextContents();
    expect(viewerOptions).toContain("FPS: Auto (120)");
    expect(viewerOptions).toContain("120 FPS");
    expect(viewerOptions).toContain("60 FPS");
    expect(viewerOptions).toContain("30 FPS");
    expect(viewerOptions).toContain("15 FPS");
    // Não deve conter 144 nem 240 pois o host só liberou 120
    expect(viewerOptions).not.toContain("144 FPS");
    expect(viewerOptions).not.toContain("240 FPS");

    // 3. Visualizador escolhe 30 FPS para economizar hardware/rede
    await fpsViewerSelect.selectOption("30");
    await expect(viewerPage.locator("#osd")).toHaveText(/FPS limitado a: 30 FPS/);

    // Valida no Discord Stats Modal
    await viewerPage.locator("#quality").click();
    await expect(viewerPage.locator("#discord-stats-modal")).toBeVisible();
    await expect(viewerPage.locator("#ds-chosen-fps")).toHaveText("30 FPS");

    // 4. Host verifica que o limite personalizado de FPS do visualizador foi aplicado
    await hostPage.bringToFront();
    await hostPage.locator("#copy-diag").click({ force: true });
    const hostDiag = await hostPage.evaluate(() => (window as any).__pingLastDiag);

    expect(hostDiag).toBeTruthy();
    expect(hostDiag.settings.fps).toBe(120);
    expect(hostDiag.viewers.length).toBeGreaterThan(0);
    expect(hostDiag.viewers[0].customFps).toBe(30);

    await hostContext.close();
    await viewerContext.close();
  });
});
