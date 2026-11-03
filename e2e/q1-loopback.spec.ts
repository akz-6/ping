import { expect, test } from "@playwright/test";

test("Q1: Loopback com conteúdo em movimento - teto permanece íntegro no valor configurado (modo Fixo)", async ({
  browser,
}) => {
  test.setTimeout(300_000); // 5 minutos de limite total

  const hostContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const viewerContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });

  const hostPage = await hostContext.newPage();
  const viewerPage = await viewerContext.newPage();

  // 1. Host abre e inicia transmissão com 8 Mbps (8000 kbps) no modo padrão Fixo
  await hostPage.goto("/?host=1");
  await hostPage.locator("#start").click();
  await expect(hostPage.locator("#live")).toBeVisible({ timeout: 15_000 });
  const roomLink = await hostPage.locator("#link").inputValue();

  // 2. Viewer conecta
  await viewerPage.goto(roomLink);
  await expect(viewerPage.locator("#bar")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () =>
        viewerPage
          .locator("#v")
          .evaluate((el: HTMLVideoElement) => el.videoWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // 3. Executa em loopback por 3 minutos (180 segundos), verificando que o teto NÃO cai
  const checkIntervals = 6; // 6 x 30s = 180s (3 minutos)
  for (let i = 1; i <= checkIntervals; i++) {
    await viewerPage.waitForTimeout(30_000);
    console.log(`[Q1 loopback] ${i * 30}s decorridos...`);

    // Verifica que o teto exibido não tem "(teto X.X)" reduzido
    const bitrateCellText = await hostPage
      .locator("#stats-body tr td")
      .nth(2)
      .textContent();
    console.log(`[Q1 loopback] Bitrate no host: ${bitrateCellText}`);
    expect(bitrateCellText).not.toContain("teto");

    const vw = await viewerPage
      .locator("#v")
      .evaluate((el: HTMLVideoElement) => el.videoWidth);
    expect(vw).toBeGreaterThan(0);
  }

  // 4. Copia diagnóstico JSON do host e valida integridade (teto mantido em 8000 kbps)
  await hostPage.bringToFront();
  await hostPage.locator("#copy-diag").click({ force: true });
  await expect(hostPage.locator("#toasts")).toContainText("Diagnóstico");

  const hostDiag = await hostPage.evaluate(
    () => (window as any).__pingLastDiag,
  );
  expect(hostDiag).toBeTruthy();
  expect(hostDiag.role).toBe("host");
  expect(hostDiag.settings.bitrateMode).toBe("fixed");
  expect(hostDiag.viewers[0].isReduced).toBe(false);
  expect(hostDiag.viewers[0].currentBitrateCapKbps).toBe(8000);

  // 5. Copia diagnóstico JSON do viewer e valida integridade
  await viewerPage.bringToFront();
  await viewerPage.locator("#copy-diag").click({ force: true });
  await expect(viewerPage.locator("#copy-diag")).toHaveText("Copiado!");

  const viewerDiag = await viewerPage.evaluate(
    () => (window as any).__pingLastDiag,
  );
  expect(viewerDiag).toBeTruthy();
  expect(viewerDiag.role).toBe("viewer");

  await hostContext.close();
  await viewerContext.close();
});
