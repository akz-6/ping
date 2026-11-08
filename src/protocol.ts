// Mensagens trocadas no canal de dados (DataConnection) entre host e viewer.
import type { ChatMsg } from "./chat/types";
import type { TransportInfo, TransportMode } from "./transport/types";
export type { TransportInfo, TransportMode };

export type QualityPreset = "source" | "720p" | "480p" | "360p";

export type ToHost =
  | {
      t: "hello";
      pwHash?: string;
      ticket?: string;
    }
  | {
      t: "quality-preset";
      preset: QualityPreset;
    }
  | {
      t: "fps-cap";
      fps: number;
    }
  | {
      t: "chat-send";
      text: string;
    }
  | {
      t: "transport-fallback";
      reason: string;
    };

export type DeniedReason =
  | "rejected"
  | "blocked"
  | "full"
  | "wrong-password";

export type ChatRejectedReason = "rate" | "muted" | "invalid";

export type ToViewer =
  | { t: "auth-required"; error?: boolean; remaining?: number }
  | { t: "pending" }
  | { t: "approved"; transport?: TransportInfo }
  | { t: "denied"; reason?: DeniedReason }
  | { t: "welcome"; maxFps?: number }
  | { t: "viewers"; n: number }
  | { t: "kicked" }
  | { t: "ended" }
  | { t: "pause"; paused: boolean }
  | { t: "chat-history"; msgs: ChatMsg[] }
  | { t: "chat-msg"; msg: ChatMsg }
  | { t: "chat-rejected"; reason: ChatRejectedReason }
  | { t: "transport-switch"; mode: "p2p" };

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const CLIENT_ID_RE = /^[a-z0-9]{4,32}$/;
const DENIED_REASONS = new Set<DeniedReason>([
  "rejected",
  "blocked",
  "full",
  "wrong-password",
]);
const CHAT_REJECTED_REASONS = new Set<ChatRejectedReason>([
  "rate",
  "muted",
  "invalid",
]);

export const DISCORD_AVATAR_RE =
  /^https:\/\/cdn\.discordapp\.com\/(avatars\/\d+\/[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9]+)?(?:\?[a-zA-Z0-9_=&]+)?|embed\/avatars\/\d+\.png)$/;

export const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const VALID_PRESETS = new Set<QualityPreset>(["source", "720p", "480p", "360p"]);

export function isValidChatMsg(msg: unknown): msg is ChatMsg {
  if (!isPlainObject(msg)) return false;
  if (typeof msg.id !== "string" || !msg.id || msg.id.length > 64) return false;
  if (typeof msg.ts !== "number" || !Number.isFinite(msg.ts) || msg.ts <= 0) return false;
  if (msg.kind !== "user" && msg.kind !== "system") return false;
  if (msg.kind === "system" && msg.authorId !== null) return false;
  if (msg.authorId !== null && (typeof msg.authorId !== "string" || !msg.authorId || msg.authorId.length > 64)) {
    return false;
  }
  if (typeof msg.name !== "string" || !msg.name.trim() || msg.name.trim().length > 32) return false;
  if (msg.badge !== null && msg.badge !== "host" && msg.badge !== "discord") return false;
  if (msg.avatar !== null) {
    if (typeof msg.avatar !== "string" || !DISCORD_AVATAR_RE.test(msg.avatar)) {
      return false;
    }
  }
  if (
    typeof msg.text !== "string" ||
    msg.text.length < 1 ||
    msg.text.length > 300 ||
    CONTROL_CHARS_RE.test(msg.text)
  ) {
    return false;
  }
  return true;
}

export function isValidTransportInfo(t: unknown): t is TransportInfo {
  if (!isPlainObject(t)) return false;
  if (t.mode !== "sfu" && t.mode !== "p2p") return false;
  if (t.mode === "sfu") {
    if (!isPlainObject(t.sfu)) return false;
    if (typeof t.sfu.hostSessionId !== "string" || !t.sfu.hostSessionId) return false;
    if (!Array.isArray(t.sfu.tracks)) return false;
    for (const track of t.sfu.tracks) {
      if (!isPlainObject(track)) return false;
      if (track.kind !== "video" && track.kind !== "audio") return false;
      if (typeof track.trackName !== "string" || !track.trackName) return false;
    }
  }
  return true;
}

/** Valida estritamente mensagens vindas do viewer para o host. */
export function parseToHost(data: unknown): ToHost | null {
  if (!isPlainObject(data)) return null;

  if (data.t === "hello") {
    const out: ToHost = { t: "hello" };
    if (data.pwHash !== undefined) {
      if (typeof data.pwHash !== "string" || !SHA256_HEX_RE.test(data.pwHash)) {
        return null;
      }
      out.pwHash = data.pwHash;
    }
    if (data.ticket !== undefined) {
      if (typeof data.ticket !== "string" || !data.ticket || data.ticket.length > 1024) {
        return null;
      }
      out.ticket = data.ticket;
    }
    return out;
  }

  if (data.t === "quality-preset") {
    if (
      typeof data.preset === "string" &&
      VALID_PRESETS.has(data.preset as QualityPreset)
    ) {
      return { t: "quality-preset", preset: data.preset as QualityPreset };
    }
    return null;
  }

  if (data.t === "fps-cap") {
    if (
      typeof data.fps === "number" &&
      Number.isFinite(data.fps) &&
      data.fps >= 5 &&
      data.fps <= 360
    ) {
      return { t: "fps-cap", fps: Math.round(data.fps) };
    }
    return null;
  }

  if (data.t === "chat-send") {
    if (
      typeof data.text === "string" &&
      data.text.length >= 1 &&
      data.text.length <= 300 &&
      !CONTROL_CHARS_RE.test(data.text)
    ) {
      return { t: "chat-send", text: data.text };
    }
    return null;
  }

  if (data.t === "transport-fallback") {
    if (
      typeof data.reason === "string" &&
      data.reason.length >= 1 &&
      data.reason.length <= 120
    ) {
      return { t: "transport-fallback", reason: data.reason };
    }
    return null;
  }

  return null;
}

/** Valida estritamente mensagens vindas do host para o viewer. */
export function parseToViewer(data: unknown): ToViewer | null {
  if (!isPlainObject(data) || typeof data.t !== "string") return null;

  switch (data.t) {
    case "welcome": {
      const out: ToViewer = { t: "welcome" };
      if (
        typeof data.maxFps === "number" &&
        Number.isFinite(data.maxFps) &&
        data.maxFps > 0 &&
        data.maxFps <= 360
      ) {
        out.maxFps = Math.round(data.maxFps);
      }
      return out;
    }

    case "pending":
    case "kicked":
    case "ended":
      return { t: data.t };

    case "approved": {
      const out: ToViewer = { t: "approved" };
      if (data.transport !== undefined) {
        if (!isValidTransportInfo(data.transport)) return null;
        out.transport = data.transport;
      }
      return out;
    }

    case "viewers": {
      if (
        typeof data.n !== "number" ||
        !Number.isInteger(data.n) ||
        data.n < 0 ||
        data.n > 10_000
      ) {
        return null;
      }
      return { t: "viewers", n: data.n };
    }

    case "auth-required": {
      const out: ToViewer = { t: "auth-required" };
      if (data.error !== undefined) {
        if (typeof data.error !== "boolean") return null;
        out.error = data.error;
      }
      if (data.remaining !== undefined) {
        if (
          typeof data.remaining !== "number" ||
          !Number.isInteger(data.remaining) ||
          data.remaining < 0 ||
          data.remaining > 100
        ) {
          return null;
        }
        out.remaining = data.remaining;
      }
      return out;
    }

    case "denied": {
      if (data.reason !== undefined) {
        if (
          typeof data.reason !== "string" ||
          !DENIED_REASONS.has(data.reason as DeniedReason)
        ) {
          return null;
        }
        return { t: "denied", reason: data.reason as DeniedReason };
      }
      return { t: "denied" };
    }

    case "pause": {
      if (typeof data.paused !== "boolean") return null;
      return { t: "pause", paused: data.paused };
    }

    case "chat-history": {
      if (!Array.isArray(data.msgs) || data.msgs.length > 50) return null;
      for (const m of data.msgs) {
        if (!isValidChatMsg(m)) return null;
      }
      return { t: "chat-history", msgs: data.msgs as ChatMsg[] };
    }

    case "chat-msg": {
      if (!isValidChatMsg(data.msg)) return null;
      return { t: "chat-msg", msg: data.msg as ChatMsg };
    }

    case "chat-rejected": {
      if (
        typeof data.reason !== "string" ||
        !CHAT_REJECTED_REASONS.has(data.reason as ChatRejectedReason)
      ) {
        return null;
      }
      return { t: "chat-rejected", reason: data.reason as ChatRejectedReason };
    }

    case "transport-switch": {
      if (data.mode !== "p2p") return null;
      return { t: "transport-switch", mode: "p2p" };
    }

    default:
      return null;
  }
}

/** Valida metadados opcionais do DataConnection. */
export function parseConnectionMetadata(meta: unknown): { clientId?: string; name?: string } {
  if (!isPlainObject(meta)) return {};
  const out: { clientId?: string; name?: string } = {};
  if (typeof meta.clientId === "string" && CLIENT_ID_RE.test(meta.clientId)) {
    out.clientId = meta.clientId;
  }
  if (
    typeof meta.name === "string" &&
    meta.name.trim().length > 0 &&
    meta.name.trim().length <= 32 &&
    !CONTROL_CHARS_RE.test(meta.name)
  ) {
    out.name = meta.name.trim();
  }
  return out;
}

/** Gera hash SHA-256 hex (64 chars) da senha com sal do ID da sala via Web Crypto API. */
export async function hashPassword(
  room: string,
  password: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${room.toLowerCase()}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
