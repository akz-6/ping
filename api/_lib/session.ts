import crypto from "node:crypto";

export interface SessionData {
  discordId: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  exp: number;
}

export interface TicketData {
  discordId: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  peerId: string;
  exp: number;
}

export function getSessionSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.SECRET ||
    "ping-session-secret-change-in-production-0604"
  );
}

export function signPayload<T extends object>(
  payload: T,
  secret: string = getSessionSecret(),
): string {
  const json = JSON.stringify(payload);
  const dataB64 = Buffer.from(json, "utf8").toString("base64url");
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(dataB64)
    .digest("base64url");
  return `${dataB64}.${hmac}`;
}

export function verifyPayload<T extends object>(
  token: string,
  secret: string = getSessionSecret(),
): T | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [dataB64, signature] = parts;
  if (!dataB64 || !signature) return null;

  const expectedHmac = crypto
    .createHmac("sha256", secret)
    .update(dataB64)
    .digest("base64url");

  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expectedHmac, "utf8");

  if (sigBuf.length !== expBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const json = Buffer.from(dataB64, "base64url").toString("utf8");
    const payload = JSON.parse(json) as T & { exp?: number };
    if (typeof payload !== "object" || payload === null) return null;
    if (typeof payload.exp === "number" && Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function getDiscordAvatarUrl(
  discordId: string,
  avatar?: string | null,
): string {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.webp?size=128`;
  }
  let defaultIdx = 0;
  try {
    defaultIdx = Number((BigInt(discordId) >> 22n) % 6n);
    if (isNaN(defaultIdx) || defaultIdx < 0 || defaultIdx > 5) defaultIdx = 0;
  } catch {
    defaultIdx = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
}

export function parseCookies(
  header?: string | string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const raw = Array.isArray(header) ? header.join("; ") : header;
  const pairs = raw.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

export function getOwnerDiscordIds(): string[] {
  return (process.env.OWNER_DISCORD_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOwnerDiscord(discordId?: string): boolean {
  if (!discordId) return false;
  return getOwnerDiscordIds().includes(discordId);
}
