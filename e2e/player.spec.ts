import { expect, test } from "./fixtures";

test.describe("Player Video.js (Tema Black + Gray, Menus, Hotkeys e CSP)", () => {
  test("player monta com tema Black + Gray e zero injeção dinâmica de style (estrita CSP)", async ({ page }) => {
    await page.goto("/?room=ping-videotest123");

    // Verifica montagem da raiz do Video.js
    const vjs = page.locator(".video-js");
    await expect(vjs).toBeVisible({ timeout: 10000 });

    // Verifica que VIDEOJS_NO_DYNAMIC_STYLE evitou tags de estilo dinâmicas no <head>
    const dynamicStylesCount = await page.evaluate(() => {
      const styles = document.querySelectorAll('style[class^="vjs-styles"]');
      let countWithContent = 0;
      styles.forEach((s) => {
        if (s.textContent && s.textContent.trim().length > 0) countWithContent++;
      });
      return countWithContent;
    });
    expect(dynamicStylesCount).toBe(0);

    // Barra de controle Black + Gray e componentes customizados
    const controlBar = page.locator(".vjs-control-bar");
    await expect(controlBar).toBeAttached();

    // Live Badge presente
    const liveBadge = page.locator(".vjs-live-badge");
    await expect(liveBadge).toBeAttached();
    await expect(liveBadge).toContainText("AO VIVO");

    // Botões customizados
    const qualityMenu = page.locator(".vjs-quality-control");
    await expect(qualityMenu).toBeAttached();

    const fpsMenu = page.locator(".vjs-fps-control");
    await expect(fpsMenu).toBeAttached();

    const statsBtn = page.locator("#stats-btn");
    await expect(statsBtn).toBeAttached();

    const theaterBtn = page.locator("#theater");
    await expect(theaterBtn).toBeAttached();

    const pipBtn = page.locator("#pip");
    await expect(pipBtn).toBeAttached();

    const fsBtn = page.locator("#fs");
    await expect(fsBtn).toBeAttached();
  });

  test("atalhos de teclado do player acionam controles sem conflito", async ({ page }) => {
    await page.goto("/?room=ping-videotest123");
    await expect(page.locator(".video-js")).toBeVisible({ timeout: 10000 });

    const viewer = page.locator(".viewer");
    const theaterBtn = page.locator("#theater");
    const statsModal = page.locator("#discord-stats-modal");

    // 1. Atalho T: Modo Teatro
    await page.keyboard.press("t");
    await expect(viewer).toHaveClass(/theater-mode/);
    await expect(theaterBtn).toHaveClass(/active/);

    await page.keyboard.press("t");
    await expect(viewer).not.toHaveClass(/theater-mode/);
    await expect(theaterBtn).not.toHaveClass(/active/);

    // 2. Atalho D: Modal de Estatísticas
    await expect(statsModal).toHaveAttribute("hidden", "");
    await page.keyboard.press("d");
    await expect(statsModal).not.toHaveAttribute("hidden", "");

    await page.keyboard.press("Escape");
    await expect(statsModal).toHaveAttribute("hidden", "");

    // 3. Atalho M: Mudo / Ativar Som
    await page.keyboard.press("m");
    const osd = page.locator("#osd");
    await expect(osd).toBeVisible();
    await expect(osd).toContainText(/Silenciado|Áudio/);
  });

  test("menus de qualidade e FPS exibem opções e disparam seleção", async ({ page }) => {
    await page.goto("/?room=ping-videotest123");
    await expect(page.locator(".video-js")).toBeVisible({ timeout: 10000 });

    // Oculta status temporário e exibe barra para interação direta nos testes
    await page.locator("#status").evaluate((el) => { el.hidden = true; });
    await page.locator("#bar").evaluate((el) => { (el as HTMLElement).hidden = false; });

    const qualityMenuBtn = page.locator(".vjs-quality-control");
    await expect(qualityMenuBtn).toBeAttached();

    // Clica no menu de qualidade
    await qualityMenuBtn.click();
    const qualityItems = qualityMenuBtn.locator(".vjs-menu-item");
    await expect(qualityItems.first()).toBeAttached();
    const count = await qualityItems.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Seleciona 480p no menu
    const p480 = qualityMenuBtn.getByRole("menuitem", { name: "480p" });
    if ((await p480.count()) > 0) {
      await p480.click();
      await expect(page.locator("#osd")).toContainText(/480p/);
    }
  });
});
