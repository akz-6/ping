import { expect, test } from "@playwright/test";
import { BitrateAdapter } from "../src/media";

test.describe("BitrateAdapter - Q1: Fim do laço de bitrate e controle seguro", () => {
  test("modo padrão 'fixed': nunca reduz o teto, mesmo sob qualityLimitationReason = bandwidth", () => {
    const adapter = new BitrateAdapter(8000); // modo fixed por padrão
    expect(adapter.currentMode).toBe("fixed");
    expect(adapter.maxKbps).toBe(8000);

    for (let i = 0; i < 30; i++) {
      const res = adapter.update({
        qualityLimitationReason: "bandwidth",
        availableOutgoingBitrateKbps: 500, // mesmo com estimativa baixa
        rttMs: 300,
        packetLossRatio: 0.15,
      });
      expect(res.changed).toBe(false);
      expect(res.maxKbps).toBe(8000);
      expect(adapter.maxKbps).toBe(8000);
      expect(adapter.isReduced).toBe(false);
    }
  });

  test("(a) motivo 'bandwidth' com estimativa de banda alta NÃO pode gerar redução (regressão do laço H1)", () => {
    // No modo adaptativo, o encoder pode reportar limitationReason = bandwidth internamente.
    // Mas se a rede física for boa (availableOutgoingBitrate alto, RTT baixo, perda zero),
    // o adapter NÃO PODE interpretar isso como congestionamento nem reduzir o teto.
    const adapter = new BitrateAdapter(8000, { mode: "adaptive" });
    expect(adapter.currentMode).toBe("adaptive");

    for (let s = 1; s <= 25; s++) {
      const res = adapter.update({
        qualityLimitationReason: "bandwidth",
        availableOutgoingBitrateKbps: 50_000, // 50 Mbps de banda disponível
        rttMs: 5, // 5 ms de RTT local
        packetLossRatio: 0, // sem perda
      });
      expect(res.changed).toBe(false);
      expect(res.maxKbps).toBe(8000);
    }

    expect(adapter.maxKbps).toBe(8000);
    expect(adapter.isReduced).toBe(false);
  });

  test("(b) rede realmente limitada (estimativa de banda baixa) reduz em passos de até 15% e respeita o piso", () => {
    const baseKbps = 8000;
    const adapter = new BitrateAdapter(baseKbps, { mode: "adaptive" });
    // Piso de 8000: max(1500, 8000 * 0.40) = 3200 kbps
    expect(adapter.configuredFloorKbps).toBe(3200);

    // Condição de rede ruim real: estimativa de banda em 2000 kbps (< 90% do teto)
    const badNetwork = {
      qualityLimitationReason: "bandwidth" as const,
      availableOutgoingBitrateKbps: 2000,
      rttMs: 40,
      packetLossRatio: 0.08,
    };

    // Segundos 1 a 7: ainda acumulando tempo sustentado (< 8 s), não deve mudar
    for (let s = 1; s <= 7; s++) {
      const res = adapter.update(badNetwork, 1000);
      expect(res.changed).toBe(false);
      expect(res.maxKbps).toBe(8000);
    }

    // Segundo 8: sustentado por 8 s -> Primeiro passo de redução (máx 15%)
    // 8000 * 0.85 = 6800 kbps
    const step1 = adapter.update(badNetwork, 1000);
    expect(step1.changed).toBe(true);
    expect(step1.maxKbps).toBe(6800);
    expect(adapter.isReduced).toBe(true);

    // Segundos 9 a 12 (4 segundos decorridos): intervalo mínimo entre passos é 5 s -> não reduz
    for (let s = 9; s <= 12; s++) {
      const res = adapter.update(badNetwork, 1000);
      expect(res.changed).toBe(false);
      expect(res.maxKbps).toBe(6800);
    }

    // Segundo 13 (5 s após o passo 1): segundo passo (6800 * 0.85 = 5780 kbps)
    const step2 = adapter.update(badNetwork, 1000);
    expect(step2.changed).toBe(true);
    expect(step2.maxKbps).toBe(5780);

    // Executa por mais 60 segundos com rede limitada:
    // O teto deve descer progressivamente até atingir o piso de 3200 kbps e NUNCA furar o piso!
    for (let s = 0; s < 60; s++) {
      adapter.update(badNetwork, 1000);
      expect(adapter.maxKbps).toBeGreaterThanOrEqual(3200);
    }

    expect(adapter.maxKbps).toBe(3200);
  });

  test("(c) recuperação cautelosa (+10% a cada 5 s) quando a rede melhora", () => {
    const adapter = new BitrateAdapter(8000, { mode: "adaptive" });

    // Força redução inicial
    const badNetwork = {
      availableOutgoingBitrateKbps: 1500,
      packetLossRatio: 0.1,
      rttMs: 120,
    };
    for (let s = 0; s < 40; s++) {
      adapter.update(badNetwork, 1000);
    }
    expect(adapter.maxKbps).toBe(3200);

    // Rede melhora drasticamente: banda disponível sobe para 30 Mbps, sem perda e RTT normal
    const goodNetwork = {
      availableOutgoingBitrateKbps: 30_000,
      packetLossRatio: 0,
      rttMs: 15,
    };

    // Segundos 1 a 4: avaliando estabilidade (mínimo 5 s de rede boa)
    for (let s = 1; s <= 4; s++) {
      const res = adapter.update(goodNetwork, 1000);
      expect(res.changed).toBe(false);
      expect(res.maxKbps).toBe(3200);
    }

    // Segundo 5: recupera +10% (3200 + 320 = 3520 kbps)
    const rec1 = adapter.update(goodNetwork, 1000);
    expect(rec1.changed).toBe(true);
    expect(rec1.maxKbps).toBe(3520);

    // Mantém rede boa por mais 100 segundos: deve recuperar até o teto base de 8000 e não ultrapassar
    for (let s = 0; s < 100; s++) {
      adapter.update(goodNetwork, 1000);
      expect(adapter.maxKbps).toBeLessThanOrEqual(8000);
    }

    expect(adapter.maxKbps).toBe(8000);
    expect(adapter.isReduced).toBe(false);
  });

  test("motivo 'cpu' nunca reduz o bitrate", () => {
    const adapter = new BitrateAdapter(8000, { mode: "adaptive" });
    for (let s = 0; s < 20; s++) {
      const res = adapter.update({
        qualityLimitationReason: "cpu",
        availableOutgoingBitrateKbps: 12_000,
        rttMs: 8,
        packetLossRatio: 0,
      });
      expect(res.changed).toBe(false);
      expect(res.maxKbps).toBe(8000);
    }
  });

  test("reset() restaura o teto base imediatamente", () => {
    const adapter = new BitrateAdapter(8000, { mode: "adaptive" });
    for (let s = 0; s < 40; s++) {
      adapter.update({ availableOutgoingBitrateKbps: 1500, packetLossRatio: 0.1 });
    }
    expect(adapter.maxKbps).toBe(3200);

    adapter.reset();
    expect(adapter.maxKbps).toBe(8000);
    expect(adapter.isReduced).toBe(false);
  });
});
