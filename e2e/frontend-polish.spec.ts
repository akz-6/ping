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
});
