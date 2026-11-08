export interface UserProfile {
  handle: string;
  displayName: string;
  fullName: string;
  discordLinked: boolean;
  discordUsername?: string;
  discordId?: string;
  avatarUrl?: string;
  isOwner?: boolean;
}

const HANDLE_KEY = "ping:handle";
const DISPLAY_NAME_KEY = "ping:display_name";
const FULL_NAME_KEY = "ping:full_name";
const DISCORD_KEY = "ping:discord_linked";
const DISCORD_USER_KEY = "ping:discord_user";
const DISCORD_ID_KEY = "ping:discord_id";
const DISCORD_AVATAR_KEY = "ping:discord_avatar";
const DISCORD_OWNER_KEY = "ping:discord_owner";

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

/** Obtém o perfil completo do usuário (com suporte a vínculo opcional do Discord) */
export function getProfile(): UserProfile {
  const handle = getHandle();
  let displayName = handle;
  let fullName = "";
  let discordLinked = false;
  let discordUsername = "";
  let discordId = "";
  let avatarUrl = "";
  let isOwner = false;

  try {
    const savedNick = localStorage.getItem(DISPLAY_NAME_KEY);
    if (savedNick && savedNick.trim().length > 0) {
      displayName = savedNick.trim();
    }
    fullName = localStorage.getItem(FULL_NAME_KEY) || "";
    discordLinked = localStorage.getItem(DISCORD_KEY) === "true";
    discordUsername = localStorage.getItem(DISCORD_USER_KEY) || "";
    discordId = localStorage.getItem(DISCORD_ID_KEY) || "";
    avatarUrl = localStorage.getItem(DISCORD_AVATAR_KEY) || "";
    isOwner = localStorage.getItem(DISCORD_OWNER_KEY) === "true";
  } catch {
    // fallback
  }

  return {
    handle,
    displayName,
    fullName,
    discordLinked,
    ...(discordUsername ? { discordUsername } : {}),
    ...(discordId ? { discordId } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(isOwner ? { isOwner } : {}),
  };
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

/** Vincula uma conta do Discord ao perfil via preenchimento manual (não verificado) */
export function linkDiscordAccount(username: string): UserProfile {
  const clean = username.trim().replace(/^@/, "");
  try {
    localStorage.setItem(DISCORD_KEY, "true");
    localStorage.setItem(DISCORD_USER_KEY, clean);
    localStorage.removeItem(DISCORD_ID_KEY);
    localStorage.removeItem(DISCORD_AVATAR_KEY);
    localStorage.removeItem(DISCORD_OWNER_KEY);

    const currentNick = localStorage.getItem(DISPLAY_NAME_KEY);
    if (!currentNick && clean.length > 0) {
      localStorage.setItem(DISPLAY_NAME_KEY, clean);
    }
  } catch {
    // ignore
  }

  const profile = getProfile();
  window.dispatchEvent(new CustomEvent("ping:profile-updated", { detail: profile }));
  return profile;
}

/** Salva uma sessão autenticada com sucesso pelo Discord OAuth2 */
export function saveDiscordSession(data: {
  discordId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  isOwner?: boolean;
}): UserProfile {
  try {
    localStorage.setItem(DISCORD_KEY, "true");
    localStorage.setItem(DISCORD_USER_KEY, data.username);
    localStorage.setItem(DISCORD_ID_KEY, data.discordId);
    if (data.avatarUrl) {
      localStorage.setItem(DISCORD_AVATAR_KEY, data.avatarUrl);
    } else {
      localStorage.removeItem(DISCORD_AVATAR_KEY);
    }
    if (data.isOwner) {
      localStorage.setItem(DISCORD_OWNER_KEY, "true");
    } else {
      localStorage.removeItem(DISCORD_OWNER_KEY);
    }

    const currentNick = localStorage.getItem(DISPLAY_NAME_KEY);
    if (!currentNick && data.displayName) {
      localStorage.setItem(DISPLAY_NAME_KEY, data.displayName);
    }
  } catch {
    // ignore
  }

  const profile = getProfile();
  window.dispatchEvent(new CustomEvent("ping:profile-updated", { detail: profile }));
  return profile;
}

/** Desvincula a conta do Discord */
export function unlinkDiscordAccount(): UserProfile {
  try {
    localStorage.removeItem(DISCORD_KEY);
    localStorage.removeItem(DISCORD_USER_KEY);
    localStorage.removeItem(DISCORD_ID_KEY);
    localStorage.removeItem(DISCORD_AVATAR_KEY);
    localStorage.removeItem(DISCORD_OWNER_KEY);
    if (typeof fetch === "function") {
      fetch("/api/discord-auth?action=logout", { method: "POST" }).catch(() => undefined);
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
    localStorage.removeItem(DISCORD_USER_KEY);
    localStorage.removeItem(DISCORD_ID_KEY);
    localStorage.removeItem(DISCORD_AVATAR_KEY);
    localStorage.removeItem(DISCORD_OWNER_KEY);
  } catch {
    // ignore
  }
  const fresh = getProfile();
  window.dispatchEvent(new CustomEvent("ping:profile-updated", { detail: fresh }));
  return fresh;
}

/** Consulta se a API do Discord OAuth está configurada no servidor */
export async function checkDiscordConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/discord-auth?action=status");
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json.configured);
  } catch {
    return false;
  }
}

/** Sincroniza sessão do Discord com o servidor se cookie estiver ativo */
export async function syncDiscordSession(): Promise<UserProfile> {
  try {
    const res = await fetch("/api/discord-auth?action=me");
    if (res.ok) {
      const data = await res.json();
      if (data && data.discordId) {
        return saveDiscordSession(data);
      }
    } else if (res.status === 401) {
      if (localStorage.getItem(DISCORD_ID_KEY)) {
        return unlinkDiscordAccount();
      }
    }
  } catch {
    // network error
  }
  return getProfile();
}

/** Obtém um ticket de autenticação para conexão WebRTC com o host */
export async function getDiscordTicket(peerId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/discord-auth?action=ticket&peerId=${encodeURIComponent(peerId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ticket || null;
  } catch {
    return null;
  }
}
