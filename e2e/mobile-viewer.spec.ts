import { test, expect } from "@playwright/test";

test.describe("Mobile Viewer — Reconstrução Mobile Completa", () => {
  test("iPhone (390x844): layout vertical, ações principais, sheets, fallback fullscreen e zero overflow/CSP", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    const cspViolations: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("Content Security Policy")) {
        cspViolations.push(msg.text());
      }
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.addInitScript(() => {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
        configurable: true,
        value: undefined,
      });
    });

    await page.goto("/?room=ping-mobileios1");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("#bar").evaluate((el) => { (el as HTMLElement).hidden = false; });

    // Sem overflow horizontal
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Player compacto em 16:9 (sem caixa preta gigante)
    const stageBox = await page.locator(".palco-stage").boundingBox();
    expect(stageBox).not.toBeNull();
    expect(stageBox!.height).toBeLessThanOrEqual(380);
    expect(stageBox!.height).toBeGreaterThanOrEqual(180);

    // Informações da transmissão & Ações principais visíveis
    await expect(page.locator("#mobile-stream-info")).toBeVisible();
    const audioBtn = page.locator("#mobile-audio-btn");
    const chatBtn = page.locator("#mobile-chat-btn");
    const fsPrimaryBtn = page.locator("#mobile-fs-btn");
    for (const btn of [audioBtn, chatBtn, fsPrimaryBtn]) {
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }

    // Chat toggle pelo botão principal
    await chatBtn.click();
    await expect(page.locator(".chat-panel")).toBeVisible();
    await chatBtn.click();
    await expect(page.locator(".chat-panel")).toBeHidden();

    // Quality Sheet
    await page.locator("#mobile-quality-btn").click();
    const qSheet = page.locator("#mobile-quality-sheet");
    await expect(qSheet).toBeVisible();
    await qSheet.getByRole("radio", { name: /720p/i }).click();
    expect(pageErrors).toEqual([]);
    await expect(qSheet).toBeHidden();
    await expect(page.locator("#mobile-quality-btn")).toContainText("720p");

    // Statistics Sheet
    await page.locator("#mobile-stats-btn").click();
    const sSheet = page.locator("#mobile-stats-sheet");
    await expect(sSheet).toBeVisible();
    await sSheet.locator(".mobile-sheet__close").click();
    await expect(sSheet).toBeHidden();

    // Control bar do vídeo dentro do stage e sem corte lateral
    const bar = page.locator(".vjs-control-bar");
    await bar.evaluate((el) => { (el as HTMLElement).hidden = false; });
    await expect(bar).toBeVisible();
    const barBox = await bar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(390);

    // Zoom/Cover button
    const zoomBtn = page.locator("#zoom-btn");
    await expect(zoomBtn).toBeVisible();
    await zoomBtn.click();
    await expect(page.locator(".video-js.ping-skin")).toHaveClass(/is-cover-mode/);
    await zoomBtn.click();

    // Botão Deitar tela no player (#rotate-btn) e fallback CSS 90deg quando orientation.lock não é suportado
    const rotateBtn = page.locator("#rotate-btn");
    await bar.evaluate((el) => { (el as HTMLElement).hidden = false; });
    await expect(rotateBtn).toBeVisible();
    await rotateBtn.click();
    const viewer = page.locator(".viewer");
    await expect(viewer).toHaveClass(/mobile-landscape-rotated/);
    await expect(rotateBtn).toContainText("Normal");
    await bar.evaluate((el) => { (el as HTMLElement).hidden = false; });
    await rotateBtn.click({ force: true });
    await expect(viewer).not.toHaveClass(/mobile-landscape-rotated/);

    // Fullscreen fallback no iPhone (.mobile-expanded)
    await fsPrimaryBtn.click();
    await expect(viewer).toHaveClass(/mobile-expanded/);
    await expect(page.locator(".viewer-header")).toBeHidden();
    await page.locator("#fs").click();
    await expect(viewer).not.toHaveClass(/mobile-expanded/);

    expect(cspViolations).toEqual([]);
    expect(pageErrors).toEqual([]);
    await context.close();
  });

  test("Android pequeno (320x640) e padrão (360x800): nenhum controle cortado nem scroll horizontal", async ({ browser }) => {
    for (const vp of [{ width: 320, height: 640 }, { width: 360, height: 800 }]) {
      const context = await browser.newContext({
        viewport: vp,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();

      await page.goto("/?room=ping-mobileand1");
      await page.waitForLoadState("domcontentloaded");
      await page.locator("#bar").evaluate((el) => { (el as HTMLElement).hidden = false; });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      for (const sel of ["#mobile-audio-btn", "#mobile-chat-btn", "#mobile-fs-btn", "#mobile-quality-btn", "#mobile-stats-btn", "#mobile-fit-btn", "#mobile-rotate-btn", "#mobile-share-btn", "#zoom-btn", "#rotate-btn", "#fs"]) {
        const el = page.locator(sel);
        await expect(el).toBeVisible();
        const box = await el.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
      }

      await context.close();
    }
  });

  test("Landscape mobile (844x390): maximiza o player e oculta barras secundárias", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    await page.goto("/?room=ping-mobileland1");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("#mobile-stream-info")).toBeHidden();
    await expect(page.locator("#mobile-actions-bar")).toBeHidden();

    const stageBox = await page.locator(".palco-stage").boundingBox();
    expect(stageBox).not.toBeNull();
    expect(stageBox!.height).toBeGreaterThanOrEqual(300);

    await context.close();
  });
});
