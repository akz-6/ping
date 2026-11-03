import { expect, test } from "@playwright/test";

test.describe("Trava de Criação de Sala - Máquina Autorizada", () => {
  test("desbloqueio automático via parâmetro ?admin=ping-master-2026 na URL", async ({ page }) => {
    await page.goto("/?admin=ping-master-2026");
    const isAuthed = await page.evaluate(() => localStorage.getItem("ping:creator_authorized"));
    expect(isAuthed).toBe("true");

    // Parâmetro é limpo da barra de endereços
    expect(page.url()).not.toContain("admin=");

    // Criar sala abre direto
    await page.locator("#sidebar-create").click();
    await expect(page.getByRole("dialog", { name: "Criar Sala" })).toBeVisible();
  });

  test("máquina não autorizada exibe aviso de fase de testes e desbloqueia com chave", async ({ page }) => {
    await page.goto("/");
    // Simula máquina externa (não localhost e sem autorização prévia)
    await page.evaluate(() => {
      localStorage.removeItem("ping:creator_authorized");
      (window as unknown as { __forceNonLocalhost?: boolean }).__forceNonLocalhost = true;
    });

    await page.locator("#sidebar-create").click();

    // Modal de fase de testes deve abrir
    const noticeDlg = page.getByRole("dialog", { name: "Criação Indisponível" });
    await expect(noticeDlg).toBeVisible();
    await expect(noticeDlg).toContainText("fase fechada de testes");

    // Revela campo de chave do desenvolvedor
    await noticeDlg.getByRole("button", { name: "Acesso do desenvolvedor / anfitrião" }).click();
    const passInput = noticeDlg.getByLabel("Chave de acesso");
    await expect(passInput).toBeVisible();

    // Chave incorreta
    await passInput.fill("chave-errada");
    await noticeDlg.getByRole("button", { name: "Desbloquear máquina" }).click();
    await expect(noticeDlg).toContainText("Chave incorreta");

    // Chave correta -> desbloqueia e abre Criar Sala
    await passInput.fill("ping-master-2026");
    await noticeDlg.getByRole("button", { name: "Desbloquear máquina" }).click();

    await expect(noticeDlg).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Criar Sala" })).toBeVisible();

    const isAuthed = await page.evaluate(() => localStorage.getItem("ping:creator_authorized"));
    expect(isAuthed).toBe("true");
  });
});
