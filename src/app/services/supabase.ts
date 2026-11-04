import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_PASSWORD_ATTEMPTS,
  RoomLimitError,
  type PasswordResult,
  type Room,
  type RoomService,
} from "./rooms";

function getEnv(key: string): string | undefined {
  if (typeof import.meta !== "undefined" && import.meta.env && typeof import.meta.env[key] === "string") {
    return import.meta.env[key] as string;
  }
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
  if (proc?.env && typeof proc.env[key] === "string") {
    return proc.env[key];
  }
  return undefined;
}

export const SUPABASE_URL = getEnv("VITE_SUPABASE_URL");
export const SUPABASE_ANON_KEY = getEnv("VITE_SUPABASE_ANON_KEY");

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.startsWith("https://"));
}

/* ---------- PBKDF2 Password Derivation ---------- */
export function generateSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function derivePasswordHash(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- Supabase Room Service ---------- */
interface PublicRoomRow {
  id: string;
  name: string;
  host: string;
  is_private: boolean;
  viewers: number;
  capacity: number;
  last_seen: string;
  created_at: string;
}

export class SupabaseRoomService implements RoomService {
  private client: SupabaseClient;
  private attempts = new Map<string, { used: number; lockedUntil: number }>();

  constructor(client?: SupabaseClient) {
    if (client) {
      this.client = client;
    } else {
      if (!isSupabaseConfigured()) {
        throw new Error("Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.");
      }
      this.client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    }
  }

  private mapRow(row: PublicRoomRow): Room {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      isPrivate: row.is_private,
      viewers: row.viewers ?? 0,
      capacity: row.capacity ?? 2,
    };
  }

  async list(): Promise<Room[]> {
    const threshold = new Date(Date.now() - 60_000).toISOString();
    const { data, error } = await this.client
      .from("rooms_public")
      .select("*")
      .gt("last_seen", threshold)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[supabase] Erro ao listar salas:", error);
      return [];
    }

    return (data as PublicRoomRow[]).map((r) => this.mapRow(r));
  }

  subscribe(cb: (rooms: Room[]) => void): () => void {
    let localMap = new Map<string, { room: Room; lastSeenMs: number }>();

    const emit = () => {
      const now = Date.now();
      const active: Room[] = [];
      for (const [id, item] of localMap.entries()) {
        if (now - item.lastSeenMs > 60_000) {
          localMap.delete(id);
        } else {
          active.push(item.room);
        }
      }
      cb(active);
    };

    // Carga inicial
    void this.list().then((list) => {
      const now = Date.now();
      list.forEach((r) => localMap.set(r.id, { room: r, lastSeenMs: now }));
      emit();
    });

    // Inscrição em tempo real na tabela espelho
    const channel = this.client
      .channel("ping-lobby-rooms")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms_public" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string })?.id;
            if (oldId) localMap.delete(oldId);
          } else {
            const row = payload.new as PublicRoomRow;
            if (row && row.id) {
              const lastSeenMs = row.last_seen ? new Date(row.last_seen).getTime() : Date.now();
              localMap.set(row.id, {
                room: this.mapRow(row),
                lastSeenMs,
              });
            }
          }
          emit();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Reconciliação imediata pós-conexão
          void this.list().then((fresh) => {
            const now = Date.now();
            fresh.forEach((r) => localMap.set(r.id, { room: r, lastSeenMs: now }));
            emit();
          });
        }
      });

    // Varredura periódica de inatividade a cada 15 segundos
    const sweepInterval = window.setInterval(emit, 15_000);

    return () => {
      window.clearInterval(sweepInterval);
      void this.client.removeChannel(channel);
    };
  }

  async create(input: { name: string; password?: string; host: string; isOwner?: boolean }): Promise<Room> {
    const isPrivate = Boolean(input.password);
    let salt: string | null = null;
    let hash: string | null = null;

    if (isPrivate && input.password) {
      salt = generateSaltHex();
      hash = await derivePasswordHash(input.password, salt);
    }

    const { data, error } = await this.client.rpc("create_room", {
      p_name: input.name,
      p_host: input.host,
      p_is_private: isPrivate,
      p_pw_salt: salt,
      p_pw_hash: hash,
    });

    if (error) {
      if (error.message?.includes("LIMITE_SALAS_ABERTAS")) {
        throw new RoomLimitError();
      }
      throw new Error(error.message || "Não foi possível criar a sala.");
    }

    const payload = data as {
      id: string;
      name: string;
      host: string;
      isPrivate: boolean;
      viewers: number;
      capacity: number;
      hostToken: string;
    };

    if (payload.hostToken) {
      sessionStorage.setItem(`ping:host_token:${payload.id}`, payload.hostToken);
    }

    return {
      id: payload.id,
      name: payload.name,
      host: payload.host,
      isPrivate: payload.isPrivate,
      viewers: payload.viewers ?? 0,
      capacity: payload.capacity ?? 2,
      hostToken: payload.hostToken,
    };
  }

  async verifyPassword(roomId: string, password: string): Promise<PasswordResult> {
    const now = Date.now();
    const entry = this.attempts.get(roomId) ?? { used: 0, lockedUntil: 0 };

    if (entry.lockedUntil > now) {
      return { ok: false, attemptsLeft: 0, lockedMs: entry.lockedUntil - now };
    }

    // 1. Obtém o salt da sala (sem nunca retornar o hash)
    const { data: salt, error: saltErr } = await this.client.rpc("get_room_salt", {
      p_room_id: roomId,
    });

    if (saltErr || !salt) {
      return { ok: false, attemptsLeft: 0 };
    }

    // 2. Deriva o hash e valida no servidor
    const hash = await derivePasswordHash(password, salt as string);
    const { data: isValid } = await this.client.rpc("verify_room_password", {
      p_room_id: roomId,
      p_pw_hash: hash,
    });

    if (isValid === true) {
      this.attempts.delete(roomId);
      return { ok: true, attemptsLeft: MAX_PASSWORD_ATTEMPTS };
    }

    entry.used += 1;
    const attemptsLeft = Math.max(0, MAX_PASSWORD_ATTEMPTS - entry.used);
    let lockedMs: number | undefined;

    if (attemptsLeft === 0) {
      lockedMs = 30_000;
      entry.lockedUntil = now + lockedMs;
      entry.used = 0;
    }

    this.attempts.set(roomId, entry);
    return { ok: false, attemptsLeft, lockedMs };
  }
}

/* ---------- Host Heartbeat & Lifecycle Helpers ---------- */
export interface HostLifecycleHandle {
  stop: () => void;
  syncViewers: (count: number) => void;
}

export function startHostLifecycle(opts: {
  roomId: string;
  hostToken: string;
  client?: SupabaseClient;
}): HostLifecycleHandle {
  const client = opts.client ?? (isSupabaseConfigured() ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null);

  let lastSentViewers = 0;
  let viewerThrottleTimer: number | null = null;

  // Heartbeat a cada 20 segundos para manter a sala ativa
  const heartbeatTimer = window.setInterval(() => {
    if (client) {
      void client.rpc("heartbeat_room", {
        p_room_id: opts.roomId,
        p_host_token: opts.hostToken,
      });
    }
    if (typeof fetch !== "undefined") {
      void fetch("/api/rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: opts.roomId, hostToken: opts.hostToken }),
      }).catch(() => undefined);
    }
  }, 20_000);

  const doSyncViewers = (count: number) => {
    lastSentViewers = count;
    if (client) {
      void client.rpc("update_viewers", {
        p_room_id: opts.roomId,
        p_host_token: opts.hostToken,
        p_viewers: count,
      });
    }
    if (typeof fetch !== "undefined") {
      void fetch("/api/rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: opts.roomId, hostToken: opts.hostToken, viewers: count }),
      }).catch(() => undefined);
    }
    try {
      const raw = localStorage.getItem("ping:active_rooms");
      if (raw) {
        const list = JSON.parse(raw) as (Room & { createdAt?: number })[];
        const target = list.find((r) => r.id === opts.roomId);
        if (target) {
          target.viewers = count;
          localStorage.setItem("ping:active_rooms", JSON.stringify(list));
        }
      }
    } catch {}
  };

  const syncViewers = (count: number) => {
    if (count === lastSentViewers) return;
    if (viewerThrottleTimer !== null) return;
    viewerThrottleTimer = window.setTimeout(() => {
      viewerThrottleTimer = null;
      doSyncViewers(count);
    }, 1000);
  };

  // Encerramento ao sair da página (sendBeacon / RPC)
  const closeRoom = () => {
    if (client && SUPABASE_URL && SUPABASE_ANON_KEY) {
      const endpoint = `${SUPABASE_URL}/rest/v1/rpc/close_room`;
      const body = JSON.stringify({ p_room_id: opts.roomId, p_host_token: opts.hostToken });
      try {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(endpoint, blob);
      } catch {
        // Fallback síncrono ou ignorar se browser bloquear
      }
      void client.rpc("close_room", {
        p_room_id: opts.roomId,
        p_host_token: opts.hostToken,
      });
    }

    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(`/api/rooms?action=delete&id=${encodeURIComponent(opts.roomId)}`);
      }
      if (typeof fetch !== "undefined") {
        void fetch(`/api/rooms?id=${encodeURIComponent(opts.roomId)}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined);
      }
    } catch {}

    try {
      const raw = localStorage.getItem("ping:active_rooms");
      if (raw) {
        const list = JSON.parse(raw) as { id: string }[];
        localStorage.setItem("ping:active_rooms", JSON.stringify(list.filter((r) => r.id !== opts.roomId)));
      }
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("ping:room_sync_v1");
        bc.postMessage({ t: "rooms-changed" });
        bc.close();
      }
    } catch {}
  };

  window.addEventListener("beforeunload", closeRoom);
  window.addEventListener("pagehide", closeRoom);

  return {
    syncViewers,
    stop: () => {
      window.clearInterval(heartbeatTimer);
      if (viewerThrottleTimer !== null) window.clearTimeout(viewerThrottleTimer);
      window.removeEventListener("beforeunload", closeRoom);
      window.removeEventListener("pagehide", closeRoom);
      closeRoom();
    },
  };
}
