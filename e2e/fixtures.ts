import { test as base, expect } from "@playwright/test";

export const test = base.extend<{}>({
  page: async ({ page }, use) => {
    const cspViolations: string[] = [];
    const unexpectedErrors: string[] = [];

    // Captura violações de CSP via evento da spec W3C
    await page.addInitScript(() => {
      window.addEventListener("securitypolicyviolation", (e) => {
        const detail = `CSP Violation: blockedURI=${e.blockedURI}, directive=${e.violatedDirective}, sample=${e.sample}`;
        const w = window as any;
        w.__pingCspViolations = w.__pingCspViolations || [];
        w.__pingCspViolations.push(detail);
        console.error(detail);
      });
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignora ruídos intencionais durante simulações e desconexões de teste
        const isExpected =
          text.includes("favicon") ||
          text.includes("Failed to load resource") ||
          text.includes("404") ||
          text.includes("PeerJS") ||
          text.includes("Lost connection to server") ||
          text.includes("Could not connect to peer") ||
          text.includes("ICE connection to") ||
          text.includes("net::ERR_CONNECTION_REFUSED");
        if (!isExpected) {
          unexpectedErrors.push(text);
        }
      }
    });

    await use(page);

    // Validação estrita nas telas de transmissão (?room= e /studio)
    const currentUrl = page.url();
    const onTransmissionStage = currentUrl.includes("?room=") || currentUrl.includes("/studio");
    if (onTransmissionStage) {
      const violations = await page
        .evaluate(() => (window as any).__pingCspViolations || [])
        .catch(() => []);
      expect(violations, `Violações de CSP detectadas na transmissão: ${violations.join("; ")}`).toHaveLength(0);
      expect(unexpectedErrors, `Erros inesperados de console na transmissão: ${unexpectedErrors.join("; ")}`).toHaveLength(0);
    }
  },
});

export { expect };
