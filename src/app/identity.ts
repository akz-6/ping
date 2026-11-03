export interface UserProfile {
  handle: string;
  displayName: string;
  fullName: string;
  discordLinked: boolean;
}

const HANDLE_KEY = "ping:handle";
const DISPLAY_NAME_KEY = "ping:display_name";
const FULL_NAME_KEY = "ping:full_name";
const DISCORD_KEY = "ping:discord_linked";

function random8(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 100_000_000).padStart(8, "0");
}

/** Obtém o identificador anônimo base "user" + 8 dígitos */
export function getHandle(): string {
  try {
    const saved = localStorage.getItem(HANDLE_KEY);
    if (saved && /^user\d{8}$/.test(saved)) return saved;
    const fresh = `user${random8()}`;
    localStorage.setItem(HANDLE_KEY, fresh);
    return fresh;
  } catch {
    return `user${random8()}`;
  }
}

/** Obtém o perfil completo do usuário (sem obrigatoriedade de login no Discord) */
export function getProfile(): UserProfile {
  const handle = getHandle();
  let displayName = handle;
  let fullName = "";
  let discordLinked = false;

  try {
    const savedNick = localStorage.getItem(DISPLAY_NAME_KEY);
    if (savedNick && savedNick.trim().length > 0) {
      displayName = savedNick.trim();
    }
    fullName = localStorage.getItem(FULL_NAME_KEY) || "";
    discordLinked = localStorage.getItem(DISCORD_KEY) === "true";
  } catch {
    // fallback
  }

  return { handle, displayName, fullName, discordLinked };
}

/** Atualiza nome de exibição e nome completo localmente */
export function saveProfile(updates: { displayName?: string; fullName?: string }): UserProfile {
  try {
    if (updates.displayName !== undefined) {
      const cleanNick = updates.displayName.trim();
      if (cleanNick.length > 0) {
        localStorage.setItem(DISPLAY_NAME_KEY, cleanNick);
      } else {
        localStorage.removeItem(DISPLAY_NAME_KEY);
      }
    }
    if (updates.fullName !== undefined) {
      localStorage.setItem(FULL_NAME_KEY, updates.fullName.trim());
    }
  } catch {
    // ignore
  }

  const profile = getProfile();
  window.dispatchEvent(new CustomEvent("ping:profile-updated", { detail: profile }));
  return profile;
}

/** Redefine os dados de identidade local (LGPD / Privacidade) */
export function resetIdentity(): UserProfile {
  try {
    localStorage.removeItem(HANDLE_KEY);
    localStorage.removeItem(DISPLAY_NAME_KEY);
    localStorage.removeItem(FULL_NAME_KEY);
    localStorage.removeItem(DISCORD_KEY);
  } catch {
    // ignore
  }
  const fresh = getProfile();
  window.dispatchEvent(new CustomEvent("ping:profile-updated", { detail: fresh }));
  return fresh;
}
