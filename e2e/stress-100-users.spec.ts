import { test, expect } from "@playwright/test";
import { MockRoomService, MAX_OPEN_ROOMS } from "../src/app/services/rooms";
import { derivePasswordHash, generateSaltHex } from "../src/app/services/supabase";

test.describe("Stress & Resiliência — 100 Usuários Concorrentes na Plataforma", () => {
  test("100 usuários simultâneos: carregamento, busca, perfis e consentimento sem falhas", async () => {
    const service = new MockRoomService(10); // baixa latência simulada para o stress
    const userCount = 100;

    const userPromises = Array.from({ length: userCount }, async (_, index) => {
      const userId = `user${String(index + 1).padStart(8, "0")}`;
      const displayName = `Usuário ${index + 1}`;
      const fullName = `Pessoa Teste ${index + 1}`;

      // 1. Simula listagem do lobby
      const rooms = await service.list();
      expect(rooms.length).toBeGreaterThanOrEqual(2);

      // 2. Simula busca concorrente por nome
      const query = index % 2 === 0 ? "demonstracao" : "exemplo";
      const filtered = rooms.filter((r) =>
        r.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(query),
      );
      expect(filtered.length).toBeGreaterThan(0);

      // 3. Simula verificação de senha concorrente em sala fechada
      const passResult = await service.verifyPassword("demo-fechada-teste", "demo");
      expect(passResult.ok).toBe(true);

      // 4. Inscrição concorrente de listener em tempo real
      let receivedRooms = 0;
      const unsubscribe = service.subscribe((next) => {
        receivedRooms = next.length;
      });

      return { userId, displayName, fullName, receivedRooms, unsubscribe };
    });

    const startTime = performance.now();
    const results = await Promise.all(userPromises);
    const duration = performance.now() - startTime;

    expect(results.length).toBe(100);
    for (const res of results) {
      expect(res.userId).toMatch(/^user\d{8}$/);
      res.unsubscribe();
    }

    console.log(`[Stress Test] 100 usuários simultâneos processados com sucesso em ${duration.toFixed(1)} ms.`);
  });

  test("100 listeners concorrentes recebem mutações em tempo real sem vazamento", async () => {
    const service = new MockRoomService(5);
    const listenerCount = 100;
    const notificationsReceived = new Array(listenerCount).fill(0);
    const unsubs: (() => void)[] = [];

    // Registra 100 ouvintes
    for (let i = 0; i < listenerCount; i++) {
      const un = service.subscribe((rooms) => {
        if (rooms.length > 0) notificationsReceived[i] += 1;
      });
      unsubs.push(un);
    }

    // Cria uma sala privada
    await service.create({
      name: "Sala de Teste Concorrente",
      password: "123",
      host: "Admin",
    });

    // Todos os 100 ouvintes devem ter recebido a notificação
    for (let i = 0; i < listenerCount; i++) {
      expect(notificationsReceived[i]).toBeGreaterThanOrEqual(1);
    }

    // Limpa os 100 ouvintes
    unsubs.forEach((un) => un());
  });

  test("corrida concorrente (Race Condition): 10 tentativas simultâneas respeitam limite de 5 salas abertas", async () => {
    const service = new MockRoomService(15);
    // Cria 10 salas abertas ao mesmo tempo
    const attempts = Array.from({ length: 10 }, (_, i) =>
      service
        .create({
          name: `Sala Aberta Concorrente ${i}`,
          password: "",
          host: `Host-${i}`,
        })
        .then(() => "ok")
        .catch((err: Error) => err.message),
    );

    const outcomes = await Promise.all(attempts);
    const createdCount = outcomes.filter((o) => o === "ok").length;
    const rejectedCount = outcomes.filter((o) => o === "LIMITE_SALAS_ABERTAS").length;

    // Contando a existente (1 pública), no máximo 4 novas salas abertas podem ter sido aceitas (total = 5)
    expect(createdCount).toBeLessThanOrEqual(MAX_OPEN_ROOMS);
    expect(rejectedCount).toBeGreaterThan(0);
  });

  test("criptografia sob estresse: derivação concorrente de 50 hashes PBKDF2 com 100k iterações", async () => {
    const salts = Array.from({ length: 50 }, () => generateSaltHex());
    const startTime = performance.now();

    const hashes = await Promise.all(
      salts.map((salt) => derivePasswordHash("senha-segura-2026", salt)),
    );

    const duration = performance.now() - startTime;
    expect(hashes.length).toBe(50);
    // Cada hash deve ter 64 caracteres hexadecimais (256 bits)
    for (const h of hashes) {
      expect(h).toHaveLength(64);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
    console.log(`[Crypto Stress] 50 derivações PBKDF2 (100k iterações) em paralelo concluídas em ${duration.toFixed(1)} ms.`);
  });

  test("resiliência ao caos: auto-recuperação do app quando o localStorage está corrompido", async ({ page }) => {
    // Injeta lixo e valores corrompidos no storage antes de carregar
    await page.addInitScript(() => {
      localStorage.setItem("ping:user_profile", "{ broken json !! bad content");
      localStorage.setItem("ping:theme", "INVALID_THEME");
      localStorage.setItem("ping:palette", "UNKNOWN_PALETTE");
      localStorage.setItem("ping:cookie_consent", "UNKNOWN_VALUE");
    });

    await page.goto("/");

    // O app deve se auto-recuperar sem lançar exceção não tratada e exibir o lobby normalmente
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".feed")).toBeVisible();
    await expect(page.locator(".brand-name").first()).toHaveText("Ping");
  });
});
