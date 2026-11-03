// Mensagens trocadas no canal de dados (DataConnection) entre host e viewer.

export type QualityPreset = "source" | "720p" | "480p" | "360p";

export type ToHost =
  | {
      t: "hello";
      pwHash?: string;
    }
  | {
      t: "quality-preset";
      preset: QualityPreset;
    }
  | {
      t: "fps-cap";
      fps: number;
    };

export type DeniedReason =
  | "rejected"
  | "blocked"
  | "full"
  | "wrong-password";

export type ToViewer =
  | { t: "auth-required"; error?: boolean; remaining?: number }
  | { t: "pending" }
  | { t: "approved" }
  | { t: "denied"; reason?: DeniedReason }
  | { t: "welcome"; maxFps?: number }
  | { t: "viewers"; n: number }
  | { t: "kicked" }
  | { t: "ended" }
  | { t: "pause"; paused: boolean };

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const CLIENT_ID_RE = /^[a-z0-9]{4,32}$/;
const DENIED_REASONS = new Set<DeniedReason>([
  "rejected",
  "blocked",
  "full",
  "wrong-password",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const VALID_PRESETS = new Set<QualityPreset>(["source", "720p", "480p", "360p"]);

/** Valida estritamente mensagens vindas do viewer para o host. */
export function parseToHost(data: unknown): ToHost | null {
  if (!isPlainObject(data)) return null;

  if (data.t === "hello") {
    if (data.pwHash !== undefined) {
      if (typeof data.pwHash !== "string" || !SHA256_HEX_RE.test(data.pwHash)) {
        return null;
      }
      return { t: "hello", pwHash: data.pwHash };
    }
    return { t: "hello" };
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
    case "approved":
    case "kicked":
    case "ended":
      return { t: data.t };

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

    default:
      return null;
  }
}

/** Valida metadados opcionais do DataConnection. */
export function parseConnectionMetadata(meta: unknown): { clientId?: string } {
  if (!isPlainObject(meta)) return {};
  if (typeof meta.clientId === "string" && CLIENT_ID_RE.test(meta.clientId)) {
    return { clientId: meta.clientId };
  }
  return {};
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
