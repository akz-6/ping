import { expect, test } from "@playwright/test";

test.describe("lobby", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();
  });

  test("lista salas abertas e fechadas com contador n / 5", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Salas Abertas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Salas Fechadas" })).toBeVisible();
    await expect(page.locator(".chip")).toHaveText("3 / 5");
    await expect(page.locator(".room-card")).toHaveCount(5);
    await expect(page.getByRole("button", { name: /Sala aberta, 2 de 5 vagas/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sala fechada, 1 de 5 vagas/ })).toBeVisible();
  });

  test("sala lotada fica focável mas desabilitada", async ({ page }) => {
    const full = page.getByRole("button", { name: /lotada/ });
    await expect(full).toHaveAttribute("aria-disabled", "true");
    await full.click({ force: true });
    await expect(page.locator("dialog")).toHaveCount(0);
  });

  test("busca por nome ou anfitrião ignora acentos; / foca e Esc limpa", async ({ page }) => {
    await page.keyboard.press("/");
    const search = page.getByRole("textbox", { name: "Buscar salas" });
    await expect(search).toBeFocused();
    await search.fill("cafe");
    await expect(page.locator(".room-card")).toHaveCount(1);
    await search.fill("rafael");
    await expect(page.locator(".room-card")).toHaveCount(1);
    await search.fill("zzzz");
    await expect(page.getByText("Nenhuma sala encontrada")).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.locator(".room-card")).toHaveCount(5);
  });

  test("modal Criar Sala: nome obrigatório e limite de 5 salas abertas", async ({ page }) => {
    const open = async () => {
      await page.locator("#sidebar-create").click();
      await expect(page.getByRole("dialog")).toBeVisible();
    };

    await open();
    await page.getByRole("button", { name: "Criar Sala" }).last().click();
    await expect(page.getByText("Informe o nome da sala.")).toBeVisible();

    // 3 abertas + 2 criadas = 5
    for (const n of ["Sala A", "Sala B"]) {
      await page.getByLabel("Nome da sala *").fill(n);
      await page.getByRole("button", { name: "Criar Sala" }).last().click();
      await expect(page.locator("#start")).toBeVisible();
      await open();
    }

    const dlg = page.getByRole("dialog");
    await expect(dlg.getByText(/Limite de 5 salas abertas atingido/).first()).toBeVisible();
    await page.getByLabel("Nome da sala *").fill("Sala C");
    await expect(dlg.getByRole("button", { name: "Criar Sala" })).toBeDisabled();
    await page.getByLabel("Senha (opcional)").fill("segredo");
    await expect(dlg.getByRole("button", { name: "Criar Sala" })).toBeEnabled();
    await dlg.getByRole("button", { name: "Criar Sala" }).click();
    await expect(page.locator("#start")).toBeVisible();
    await expect(page.locator("#room-password")).toHaveValue("segredo");
  });

  test("olho alterna visibilidade da senha com aria-pressed", async ({ page }) => {
    await page.locator("#sidebar-create").click();
    const pass = page.getByLabel("Senha (opcional)");
    await expect(pass).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(pass).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Ocultar senha" })).toHaveAttribute("aria-pressed", "true");
  });

  test("sala fechada: senha errada conta tentativas e bloqueia; foco volta ao abrir", async ({ page }) => {
    const card = page.getByRole("button", { name: /Reunião da equipe/ });
    await card.click();
    const dlg = page.getByRole("dialog", { name: "Sala fechada" });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText("Tentativas: 0 / 3")).toBeVisible();

    await dlg.getByRole("textbox", { name: "Senha" }).fill("errada");
    await dlg.getByRole("button", { name: "Entrar" }).click();
    await expect(dlg.getByText("Senha incorreta.")).toBeVisible();
    await expect(dlg.getByText("Tentativas: 1 / 3")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(card).toBeFocused();

    await card.click();
    // 2ª tentativa
    await page.getByRole("dialog").getByRole("textbox", { name: "Senha" }).fill("outra");
    await page.getByRole("dialog").getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("dialog").getByText("Tentativas: 2 / 3")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Entrar" })).toBeEnabled();

    // 3ª tentativa -> bloqueia por 30s
    await page.getByRole("dialog").getByRole("textbox", { name: "Senha" }).fill("mais-uma");
    await page.getByRole("dialog").getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText(/Muitas tentativas/)).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("textbox", { name: "Senha" })).toBeDisabled();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Entrar" })).toBeDisabled();
  });

  test("sala fechada: senha correta fecha o modal", async ({ page }) => {
    await page.getByRole("button", { name: /Só os amigos/ }).click();
    const dlg = page.getByRole("dialog", { name: "Sala fechada" });
    await dlg.getByRole("textbox", { name: "Senha" }).fill("demo");
    await dlg.getByRole("button", { name: "Entrar" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("Senha correta");
  });

  test("tema e paleta mudam sem recarregar, persistem e não piscam", async ({ page }) => {
    const html = page.locator("html");
    await page.locator(".profile-card").click();
    await page.getByText("Escuro", { exact: true }).click();
    await page.getByText("Terracota", { exact: true }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(html).toHaveAttribute("data-palette", "terracota");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(28, 23, 19)");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(html).toHaveAttribute("data-palette", "terracota");
  });

  test("não há rolagem horizontal no desktop", async ({ page }) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});

test.describe("responsivo", () => {
  test("mobile: bottom nav, sem sidebar, anúncio a cada 4 cards", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".ad-inline:visible")).toHaveCount(1);
    await expect(page.locator(".ads-right")).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.locator(".bottom-item", { hasText: "Criar" }).click();
    await expect(page.getByRole("dialog", { name: "Criar sala" })).toBeVisible();
  });

  test("tablet: mini-dock de 72px e anúncio abaixo do feed", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();
    const w = await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().width);
    expect(w).toBe(72);
    await expect(page.locator(".ads-below")).toBeVisible();
    await expect(page.locator(".ads-right")).toBeHidden();
  });
});

test("serviço de salas (mock): limite global e bloqueio por tentativas", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const m = await import("/src/app/services/rooms.ts");
    const s = new m.MockRoomService(0);
    await s.create({ name: "a", password: "", host: "x" });
    await s.create({ name: "b", password: "", host: "x" });
    let limit = "";
    try {
      await s.create({ name: "c", password: "", host: "x" });
    } catch (e) {
      limit = (e as Error).message;
    }
    const closed = await s.create({ name: "d", password: "pw", host: "x" });
    const r1 = await s.verifyPassword("demo-4", "x");
    const r2 = await s.verifyPassword("demo-4", "x");
    const r3 = await s.verifyPassword("demo-4", "x");
    const r4 = await s.verifyPassword("demo-4", "demo");
    return { limit, closedPrivate: closed.isPrivate, r1, r2, r3, r4 };
  });
  expect(result.limit).toBe("LIMITE_SALAS_ABERTAS");
  expect(result.closedPrivate).toBe(true);
  expect(result.r1.attemptsLeft).toBe(2);
  expect(result.r2.attemptsLeft).toBe(1);
  expect(result.r3.lockedMs).toBeGreaterThan(0);
  expect(result.r4.ok).toBe(false);
});
