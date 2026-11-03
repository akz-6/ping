import { expect, test } from "@playwright/test";

test("fluxo ponta a ponta: host inicia, reinicia sem recarregar e transmite para viewer", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const viewerContext = await browser.newContext();

  const hostPage = await hostContext.newPage();
  const viewerPage = await viewerContext.newPage();

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let simulatingOffline = false;

  hostPage.on("pageerror", (err) =>
    pageErrors.push(`host pageerror: ${err.message}`),
  );
  viewerPage.on("pageerror", (err) =>
    pageErrors.push(`viewer pageerror: ${err.message}`),
  );
  hostPage.on("console", (msg) => {
    if (msg.type() === "error" && !simulatingOffline) {
      consoleErrors.push(`host console.error: ${msg.text()}`);
    }
  });
  viewerPage.on("console", (msg) => {
    if (msg.type() === "error" && !simulatingOffline) {
      consoleErrors.push(`viewer console.error: ${msg.text()}`);
    }
  });

  // 1. Host abre e inicia a primeira transmissão
  await hostPage.goto("/?host=1");
  await hostPage.locator("#start").click();

  await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
  const firstLink = await hostPage.locator("#link").inputValue();
  expect(firstLink).toMatch(/\?room=ping-[a-z0-9]{12}$/);

  // 2. Host encerra e inicia novamente sem recarregar a página, configurando upload para testar aviso de capacidade
  await hostPage.locator("#stop").click();
  await expect(hostPage.locator("#setup")).toBeVisible();
  await expect(hostPage.locator("#live")).toBeHidden();

  await hostPage.locator("#advanced summary").click();
  await hostPage.locator("#upload-mbps").fill("5");
  await expect(hostPage.locator("#setup-capacity-warn")).toBeVisible();

  await hostPage.locator("#start").click();
  await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
  const secondLink = await hostPage.locator("#link").inputValue();
  expect(secondLink).toMatch(/\?room=ping-[a-z0-9]{12}$/);
  expect(secondLink).not.toBe(firstLink);

  // 3. Viewer abre o link da segunda sessão e recebe o stream com videoWidth > 0
  await viewerPage.goto(secondLink);

  await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 20_000 });
  await expect(viewerPage.locator("#status")).toBeHidden();

  await expect
    .poll(
      async () =>
        viewerPage
          .locator("#v")
          .evaluate((el: HTMLVideoElement) => el.videoWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // Garante que o vídeo do viewer começa mudo (autoplay seguro) e tem botão "Ativar som"
  const initialMuted = await viewerPage
    .locator("#v")
    .evaluate((el: HTMLVideoElement) => el.muted && !el.paused);
  expect(initialMuted).toBe(true);
  await expect(viewerPage.locator("#sound")).toHaveText("Ativar som");

  // Ativa o som no viewer e testa atalho de teclado "M" e indicador de qualidade (#quality)
  await viewerPage.locator("#sound").click();
  await expect(viewerPage.locator("#sound")).toHaveText("Silenciar");
  await viewerPage.keyboard.press("m");
  await expect(viewerPage.locator("#sound")).toHaveText("Ativar som");
  await viewerPage.keyboard.press("M");
  await expect(viewerPage.locator("#sound")).toHaveText("Silenciar");
  await expect(viewerPage.locator("#quality")).toHaveText(/^(Boa|Média|Ruim)$/);

  // Valida layout em celular (375x667) e controles visíveis sem estouro horizontal
  await viewerPage.setViewportSize({ width: 375, height: 667 });
  await viewerPage.mouse.move(100, 100);
  await expect(viewerPage.locator("#bar")).toHaveClass(/bar-visible/);
  const noHorizontalOverflow = await viewerPage.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noHorizontalOverflow).toBe(true);

  // Valida manifesto PWA e ícone SVG
  const manifestRes = await hostPage.request.get("/manifest.webmanifest");
  expect(manifestRes.status()).toBe(200);
  const iconRes = await hostPage.request.get("/icon.svg");
  expect(iconRes.status()).toBe(200);

  // Verifica contagem de espectadores, aviso de capacidade e tabela de estatísticas (codec, bitrate, fps, limitação) no host
  await expect(hostPage.locator("#count")).toHaveText("1 espectador");
  await expect(hostPage.locator("#capacity-warn")).toBeVisible();
  await expect(hostPage.locator("#capacity-warn")).toContainText(
    "Capacidade de upload excedida",
  );
  await expect(hostPage.locator("#stats-wrap")).toBeVisible();
  await expect(hostPage.locator("#stats-body tr")).toHaveCount(1);
  await expect(hostPage.locator("#stats-body tr td").nth(1)).toHaveText(
    /^(VP9|AV1|H264|VP8)$/,
    { timeout: 10_000 },
  );
  await expect(hostPage.locator("#stats-body tr td").nth(2)).toContainText(
    "Mbps",
  );
  await expect(hostPage.locator("#stats-body tr td").nth(3)).toContainText(
    "fps",
  );
  await expect(hostPage.locator("#stats-body tr td").nth(5)).toHaveText(
    /^(Nenhuma|Banda|CPU|Outro)$/,
  );

  // Q1: Valida que no modo padrão Fixo, o teto permanece íntegro e não sofre redução indevida
  await expect(hostPage.locator("#stats-body tr td").nth(2)).not.toContainText("teto");

  // Q1: Valida botões de exportação de diagnóstico (JSON) no host e no viewer
  await hostPage.locator("#copy-diag").click();
  await expect(hostPage.locator("#toasts")).toContainText("Diagnóstico");

  await viewerPage.locator("#copy-diag").click();
  await expect(viewerPage.locator("#copy-diag")).toHaveText("Copiado!", {
    timeout: 5000,
  });

  // 4. Derruba a rede do viewer por 5 s e restaura: deve reconectar sem recarregar a página
  expect(consoleErrors).toEqual([]);
  simulatingOffline = true;
  await viewerContext.setOffline(true);
  await expect(viewerPage.locator("#status")).toBeVisible({ timeout: 5_000 });
  await expect(viewerPage.locator("#status")).toContainText("tentativa");

  await viewerPage.waitForTimeout(5_000);
  await viewerContext.setOffline(false);
  simulatingOffline = false;

  await expect(viewerPage.locator("#status")).toBeHidden({ timeout: 20_000 });
  await expect(viewerPage.locator("#bar")).toBeVisible();
  await expect
    .poll(
      async () =>
        viewerPage
          .locator("#v")
          .evaluate((el: HTMLVideoElement) => el.videoWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  await expect(hostPage.locator("#count")).toHaveText("1 espectador");

  // 5. Host encerra e viewer exibe mensagem de encerramento
  await hostPage.locator("#stop").click();
  await expect(viewerPage.locator("#status")).toBeVisible();
  await expect(viewerPage.locator("#status")).toContainText(
    "O anfitrião encerrou a transmissão.",
  );

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  await hostContext.close();
  await viewerContext.close();
});

test("diagnóstico distinto quando a sala não existe", async ({ page }) => {
  await page.goto("/?room=ping-999999");
  await expect(page.locator("#status")).toContainText(
    "Sala não existe. Confira o link ou peça um novo ao anfitrião.",
    { timeout: 15_000 },
  );
});

test("controle de acesso, senha, aprovação manual, mensagens malformadas, remoção e CSP", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const viewerContext = await browser.newContext();

  const hostPage = await hostContext.newPage();
  const viewerPage = await viewerContext.newPage();

  const pageErrors: string[] = [];
  hostPage.on("pageerror", (err) => pageErrors.push(`host: ${err.message}`));
  viewerPage.on("pageerror", (err) =>
    pageErrors.push(`viewer: ${err.message}`),
  );

  // 1. Verifica cabeçalhos de segurança (CSP ativa)
  const response = await hostPage.goto("/?host=1");
  expect(response).not.toBeNull();
  const csp = response!.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");

  // 2. Host configura senha e aprovação manual e inicia a sala
  await hostPage.locator("#advanced summary").click();
  await hostPage.locator("#room-password").fill("segredo123");
  await hostPage.locator("#require-approval").check();
  await hostPage.locator("#start").click();

  await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
  const link = await hostPage.locator("#link").inputValue();

  // 3. Viewer abre a sala: deve pedir senha e NÃO receber mídia
  await viewerPage.goto(link);
  await expect(viewerPage.locator("#auth-wrap")).toBeVisible({
    timeout: 15_000,
  });
  const vwBeforeAuth = await viewerPage
    .locator("#v")
    .evaluate((el: HTMLVideoElement) => el.videoWidth);
  expect(vwBeforeAuth).toBe(0);

  // 4. Viewer tenta senha incorreta: host aplica atraso, decrementa tentativas e não envia mídia
  await viewerPage.locator("#auth-pw").fill("errada");
  await viewerPage.locator("#auth-submit").click();
  await expect(viewerPage.locator("#auth-msg")).toContainText(
    "Senha incorreta. Tentativas restantes: 2.",
    { timeout: 10_000 },
  );
  const vwAfterWrongPw = await viewerPage
    .locator("#v")
    .evaluate((el: HTMLVideoElement) => el.videoWidth);
  expect(vwAfterWrongPw).toBe(0);

  // 5. Viewer envia a senha correta: entra em fila de aprovação manual e ainda não recebe mídia
  await viewerPage.locator("#auth-pw").fill("segredo123");
  await viewerPage.locator("#auth-submit").click();
  await expect(viewerPage.locator("#status")).toContainText(
    "Aguardando aprovação do anfitrião…",
    { timeout: 10_000 },
  );
  await expect(viewerPage.locator("#auth-wrap")).toBeHidden();
  const vwWhilePending = await viewerPage
    .locator("#v")
    .evaluate((el: HTMLVideoElement) => el.videoWidth);
  expect(vwWhilePending).toBe(0);

  // 6. Host recebe pedido pendente, aprova e viewer passa a receber mídia
  await expect(hostPage.locator("#pending-wrap")).toBeVisible({
    timeout: 10_000,
  });
  await hostPage.locator("#pending-wrap .approve-btn").click();
  await expect(hostPage.locator("#pending-wrap")).toBeHidden();

  await expect
    .poll(
      async () =>
        viewerPage
          .locator("#v")
          .evaluate((el: HTMLVideoElement) => el.videoWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // 7. Host remove o espectador ("Remover") e viewer exibe mensagem de remoção
  await expect(hostPage.locator("#stats-body .kick-btn")).toBeVisible({
    timeout: 10_000,
  });
  await hostPage.locator("#stats-body .kick-btn").click();

  await expect(viewerPage.locator("#status")).toContainText(
    "Você foi removido da sala.",
    { timeout: 10_000 },
  );
  await expect(hostPage.locator("#count")).toHaveText("0 espectadores");

  expect(pageErrors).toEqual([]);

  await hostContext.close();
  await viewerContext.close();
});

