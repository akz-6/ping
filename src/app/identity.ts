const KEY = "ping:handle";

function random8(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 100_000_000).padStart(8, "0");
}

/** Identidade anônima: "user" + 8 dígitos, persistida localmente. (Fingerprint/Discord entram na fase L3.) */
export function getHandle(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^user\d{8}$/.test(saved)) return saved;
    const fresh = `user${random8()}`;
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return `user${random8()}`;
  }
}
