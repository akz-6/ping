import { expect, test } from "./fixtures";
import { fallbackIceServers } from "../src/config";

const TEST_OWNER_KEY = process.env.OWNER_KEY || "ping-test-owner-key";

test.describe("Abstração de Transporte & TURN Relay", () => {
  test("/api/turn stubado com 500 não impede inicialização e usa STUN fallback", async ({ page }) => {
    // Intercepta e simula erro 500 no endpoint de credenciais TURN
    await page.route("**/api/turn", (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal Server Error" }),
      });
    });

    // 1. Host abre com sucesso e usa o fallback STUN
    await page.goto(`/?host=1&admin=${encodeURIComponent(TEST_OWNER_KEY)}`);
    await expect(page.locator("#start")).toBeVisible({ timeout: 10000 });

    // 2. Viewer abre normalmente sem falhas de JavaScript
    await page.goto("/?room=ping-fallback123");
    await expect(page.locator("#status")).toBeVisible({ timeout: 10000 });
  });

  test("fallbackIceServers retorna servidores STUN mesmo sob falha de rede", () => {
    const servers = fallbackIceServers();
    expect(servers.length).toBeGreaterThan(0);
    const hasStun = servers.some((s) =>
      typeof s.urls === "string" ? s.urls.includes("stun") : s.urls.some((u) => u.includes("stun")),
    );
    expect(hasStun).toBe(true);
  });
});
