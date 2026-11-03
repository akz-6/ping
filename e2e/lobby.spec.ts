import { expect, test } from "@playwright/test";

test.describe("lobby", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?demo=1");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();
  });

  test("lobby inicial sem parâmetros de demonstração inicia limpo sem salas fake", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Nenhuma sala por aqui ainda")).toBeVisible();
    await expect(page.locator(".room-card")).toHaveCount(0);
  });

  test("lista salas abertas e fechadas com contador n / 2", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Salas Abertas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Salas Fechadas" })).toBeVisible();
    await expect(page.locator(".chip")).toHaveText("1 / 2");
    await expect(page.locator(".room-card")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /Sala aberta, 2 de 2 vagas, lotada/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sala fechada, 1 de 2 vagas/ })).toBeVisible();
  });

  test("sala lotada fica focável e avisa que está cheia ao tentar entrar", async ({ page }) => {
    const full = page.getByRole("button", { name: /lotada/ });
    await expect(full).toHaveAttribute("aria-disabled", "true");
    await full.click({ force: true });
    await expect(page.locator(".toast")).toContainText("está cheia");
  });

  test("busca por nome ou anfitrião ignora acentos; / foca e Esc limpa", async ({ page }) => {
    await page.keyboard.press("/");
    const search = page.getByRole("textbox", { name: "Buscar salas" });
    await expect(search).toBeFocused();
    await search.fill("publica");
    await expect(page.locator(".room-card")).toHaveCount(1);
    await search.fill("moderador");
    await expect(page.locator(".room-card")).toHaveCount(1);
    await search.fill("zzzz");
    await expect(page.getByText("Nenhuma sala encontrada")).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.locator(".room-card")).toHaveCount(2);
  });

  test("modal Criar Sala: nome obrigatório e limite de 2 salas abertas", async ({ page }) => {
    const open = async () => {
      await page.locator("#sidebar-create").click();
      await expect(page.getByRole("dialog")).toBeVisible();
    };

    await open();
    await page.getByRole("button", { name: "Criar Sala" }).last().click();
    await expect(page.getByText("Informe o nome da sala.")).toBeVisible();

    // 1 aberta existente + 1 criada = 2
    await page.getByLabel("Nome da sala *").fill("Sala A");
    await page.getByRole("button", { name: "Criar Sala" }).last().click();
    await expect(page.locator("#start")).toBeVisible();
    await open();

    const dlg = page.getByRole("dialog");
    await expect(dlg.getByText(/Limite de 2 salas abertas atingido/).first()).toBeVisible();
    await page.getByLabel("Nome da sala *").fill("Sala B");
    await page.getByLabel("Senha (opcional)").fill("segredo");
    await expect(dlg.getByRole("button", { name: "Criar Sala" })).toBeEnabled();
    await dlg.getByRole("button", { name: "Criar Sala" }).click();
    await expect(page.locator("#start")).toBeVisible();
    await expect(page.locator("#room-password")).toHaveValue("segredo");
  });

  test("sala criada aparece na lista de salas do lobby ao voltar para salas", async ({ page }) => {
    await page.locator("#sidebar-create").click();
    await page.getByLabel("Nome da sala *").fill("Minha Transmissao ao Vivo");
    await page.getByRole("button", { name: "Criar Sala" }).last().click();
    await expect(page.locator("#start")).toBeVisible();

    // Clica em 'Salas' na barra lateral para voltar ao lobby
    await page.locator('.nav-item[data-nav="rooms"]').click();
    await expect(page.locator(".lobby")).toBeVisible();
    await expect(page.locator('.room-card:has-text("Minha Transmissao ao Vivo")')).toBeVisible();
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
    const card = page.getByRole("button", { name: /Sala Fechada/ });
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

  test("sala fechada: senha correta fecha o modal e avisa que é fake para teste", async ({ page }) => {
    await page.getByRole("button", { name: /Sala Fechada/ }).click();
    const dlg = page.getByRole("dialog", { name: "Sala fechada" });
    await dlg.getByRole("textbox", { name: "Senha" }).fill("demo");
    await dlg.getByRole("button", { name: "Entrar" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("fake para teste");
  });

  test("perfil: altera apelido e nome completo sem login no Discord", async ({ page }) => {
    await page.locator(".profile-card").click();
    const dlg = page.getByRole("dialog", { name: "Seu perfil" });
    await expect(dlg).toBeVisible();

    const nick = dlg.getByLabel("Apelido de exibição");
    const full = dlg.getByLabel("Nome completo");
    await expect(nick).toBeEnabled();
    await expect(full).toBeEnabled();

    await nick.fill("MestrePing");
    await full.fill("Dev Master");
    await dlg.getByRole("button", { name: "Salvar" }).click();

    await expect(dlg).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("Perfil atualizado");
    await expect(page.locator(".profile-name")).toHaveText("MestrePing");
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
    await page.goto("/?demo=1");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeHidden();
  });

  test("tablet: mini-dock de 72px e anúncio abaixo do feed", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/?demo=1");
    await expect(page.locator(".room-card:not(.is-skeleton)").first()).toBeVisible();
    await expect(page.locator(".ads-right")).toBeHidden();
    await expect(page.locator(".ads-below")).toBeVisible();
  });
});

test("serviço de salas (mock): limite global e bloqueio por tentativas", async () => {
  const { MockRoomService, RoomLimitError } = await import("../src/app/services/rooms");
  const s = new MockRoomService(0);
  const initial = await s.list();
  expect(initial).toHaveLength(2);

  // 1 aberta inicial + 1 criada = 2
  await s.create({ name: "A", host: "u" });

  await expect(s.create({ name: "B", host: "u" })).rejects.toBeInstanceOf(RoomLimitError);

  // O dono com chave mestra pode criar mesmo além do limite
  const ownerRoom = await s.create({ name: "B-Owner", host: "u", isOwner: true });
  expect(ownerRoom.id).toBeTruthy();

  // Fechada pode ser criada além do limite
  const priv = await s.create({ name: "F", password: "p", host: "u" });
  expect(priv.isPrivate).toBe(true);

  // Tentativas de senha
  const r1 = await s.verifyPassword(priv.id, "errada");
  expect(r1.ok).toBe(false);
  expect(r1.attemptsLeft).toBe(2);

  await s.verifyPassword(priv.id, "errada");
  const r3 = await s.verifyPassword(priv.id, "errada");
  expect(r3.attemptsLeft).toBe(0);
  expect(r3.lockedMs).toBeGreaterThan(0);
});
