import { expect, test } from "./fixtures";

test.describe("Design System Black + Gray & Tema", () => {
  test("tema escuro é o padrão e aplica tokens Black + Gray", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(9, 9, 11)");
  });

  test("alternar o tema muda data-theme e persiste após reload sem violação de CSP", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");

    // Abre modal de perfil e alterna para tema Claro
    await page.locator(".profile-card").click();
    await page.getByText("Claro", { exact: true }).click();

    await expect(html).toHaveAttribute("data-theme", "light");
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(lightBg).toBe("rgb(250, 250, 250)");

    // Persistência após reload
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(html).toHaveAttribute("data-theme", "light");

    // Alterna de volta para Escuro
    await page.locator(".profile-card").click();
    await page.getByText("Escuro", { exact: true }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("palco da transmissão no viewer preserva sempre fundo preto stage (--bg-stage: #000000)", async ({ page }) => {
    await page.goto("/?room=ping-themestage");
    const viewer = page.locator(".viewer");
    await expect(viewer).toBeAttached();

    const viewerBg = await viewer.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(viewerBg).toBe("rgb(0, 0, 0)");
  });
});
