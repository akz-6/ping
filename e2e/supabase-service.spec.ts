import { expect, test } from "@playwright/test";
import { derivePasswordHash, generateSaltHex } from "../src/app/services/supabase";

test.describe("Supabase & Criptografia - Fase L2", () => {
  test("geração de salt e derivação PBKDF2 SHA-256", async () => {
    const salt1 = generateSaltHex();
    const salt2 = generateSaltHex();

    expect(salt1).toHaveLength(32);
    expect(salt2).toHaveLength(32);
    expect(salt1).not.toBe(salt2);

    // Derivação determinística
    const hashA1 = await derivePasswordHash("segredo123", salt1);
    const hashA2 = await derivePasswordHash("segredo123", salt1);
    expect(hashA1).toHaveLength(64);
    expect(hashA1).toBe(hashA2);

    // Senha diferente gera hash diferente
    const hashB = await derivePasswordHash("outrasenha", salt1);
    expect(hashB).not.toBe(hashA1);

    // Salt diferente gera hash diferente
    const hashC = await derivePasswordHash("segredo123", salt2);
    expect(hashC).not.toBe(hashA1);
  });
});
