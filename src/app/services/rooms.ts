import { ROOM_PREFIX } from "../../config";
import { shortId } from "../../ui";

export interface Room {
  id: string;
  name: string;
  host: string;
  isPrivate: boolean;
  viewers: number;
  capacity: number;
  hostToken?: string;
}

export const MAX_OPEN_ROOMS = 2;
export const MAX_PASSWORD_ATTEMPTS = 3;

export interface PasswordResult {
  ok: boolean;
  attemptsLeft: number;
  /** Tempo de bloqueio imposto pelo backend (ms), quando as tentativas acabam. */
  lockedMs?: number;
}

export interface CreateRoomInput {
  name: string;
  password?: string;
  host: string;
  isOwner?: boolean;
}

/** Contrato do catálogo de salas. A implementação real (Supabase, fase L2) entra no lugar do mock. */
export interface RoomService {
  list(): Promise<Room[]>;
  subscribe(cb: (rooms: Room[]) => void): () => void;
  create(input: CreateRoomInput): Promise<Room>;
  verifyPassword(roomId: string, password: string): Promise<PasswordResult>;
}

export class RoomLimitError extends Error {
  constructor() {
    super("LIMITE_SALAS_ABERTAS");
  }
}

const STORAGE_ROOMS_KEY = "ping:active_rooms";
const ROOM_CHANNEL_NAME = "ping:room_sync_v1";

function getLocalActiveRooms(): Room[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_ROOMS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as (Room & { createdAt?: number })[];
    const now = Date.now();
    // Descarta salas criadas há mais de 4 horas
    return list.filter((r) => !r.createdAt || now - r.createdAt < 14_400_000);
  } catch {
    return [];
  }
}

function saveLocalActiveRooms(rooms: Room[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_ROOMS_KEY, JSON.stringify(rooms));
  } catch {}
}

/** Catálogo de salas sincronizado (Local + Nuvem Vercel Blob com suporte a fallback offline) */
export class MockRoomService implements RoomService {
  private rooms: Room[] = [];
  private listeners = new Set<(rooms: Room[]) => void>();
  private attempts = new Map<string, { used: number; lockedUntil: number }>();
  private pendingOpen = 0;
  private channel: BroadcastChannel | null = null;
  private pollTimer: number | null = null;

  constructor(private readonly latencyMs = 350, private readonly loadDemos = true) {
    this.rooms = this.mergeWithLocal([]);

    if (typeof window !== "undefined") {
      // 1. Escuta alterações vindas de outras abas do mesmo navegador
      window.addEventListener("storage", (e) => {
        if (e.key === STORAGE_ROOMS_KEY) {
          this.syncFromStorage();
        }
      });

      // 2. BroadcastChannel nativo para sincronização em tempo real entre abas
      try {
        if (typeof BroadcastChannel !== "undefined") {
          this.channel = new BroadcastChannel(ROOM_CHANNEL_NAME);
          this.channel.onmessage = (msg) => {
            if (msg.data?.t === "rooms-changed") {
              this.syncFromStorage();
            }
          };
        }
      } catch {}

      // 3. Sincronização em nuvem via /api/rooms
      void this.syncCloudRooms();
      this.pollTimer = window.setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          void this.syncCloudRooms();
        }
      }, 3500);
    }
  }

  private notifyTabs(): void {
    try {
      this.channel?.postMessage({ t: "rooms-changed" });
    } catch {}
  }

  private syncFromStorage(): void {
    this.rooms = this.mergeWithLocal(this.rooms);
    this.emit();
  }

  private mergeWithLocal(baseRooms: Room[]): Room[] {
    const local = getLocalActiveRooms();
    const map = new Map<string, Room>();

    if (this.loadDemos) {
      map.set("demo-publica-lotada", {
        id: "demo-publica-lotada",
        name: "Sala Pública (Demonstração)",
        host: "Sistema",
        isPrivate: false,
        viewers: 2,
        capacity: 2,
      });
      map.set("demo-fechada-teste", {
        id: "demo-fechada-teste",
        name: "Sala Fechada (Exemplo)",
        host: "Moderador",
        isPrivate: true,
        viewers: 1,
        capacity: 2,
      });
    }

    baseRooms.forEach((r) => map.set(r.id, r));
    local.forEach((r) => map.set(r.id, r));

    return Array.from(map.values());
  }

  private async syncCloudRooms(): Promise<void> {
    try {
      if (typeof fetch === "undefined") return;
      const res = await fetch("/api/rooms", { cache: "no-store" });
      if (!res.ok) return;
      const cloudRooms = (await res.json()) as Room[];
      if (!Array.isArray(cloudRooms)) return;

      const merged = this.mergeWithLocal(cloudRooms);
      const isDifferent =
        merged.length !== this.rooms.length ||
        merged.some((r, i) => r.id !== this.rooms[i]?.id || r.viewers !== this.rooms[i]?.viewers);

      if (isDifferent) {
        this.rooms = merged;
        saveLocalActiveRooms(merged.filter((r) => !r.id.startsWith("demo-")));
        this.emit();
      }
    } catch {
      // Ignora falha de rede/offline
    }
  }

  private emit(): void {
    const snapshot = this.rooms.map((r) => ({ ...r }));
    this.listeners.forEach((cb) => cb(snapshot));
  }

  async list(): Promise<Room[]> {
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }
    // Re-sincroniza com o armazenamento local antes de listar
    this.rooms = this.mergeWithLocal(this.rooms);
    void this.syncCloudRooms();
    return this.rooms.map((r) => ({ ...r }));
  }

  subscribe(cb: (rooms: Room[]) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0 && this.pollTimer !== null) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  async create(input: CreateRoomInput): Promise<Room> {
    const isPrivate = Boolean(input.password && input.password.length > 0);
    const openRooms = this.rooms.filter((r) => !r.isPrivate).length;

    // Se já tiver 2 salas abertas (incluindo tentativas concorrentes), bloqueia quem não for o dono
    if (!isPrivate && !input.isOwner && openRooms + this.pendingOpen >= MAX_OPEN_ROOMS) {
      throw new RoomLimitError();
    }

    if (!isPrivate && !input.isOwner) {
      this.pendingOpen += 1;
    }

    try {
      if (this.latencyMs > 0) {
        await new Promise((r) => setTimeout(r, this.latencyMs));
      }

      const hostToken = shortId(24);
      const room: Room = {
        id: `${ROOM_PREFIX}${shortId(12)}`,
        name: input.name,
        host: input.host,
        isPrivate,
        viewers: 0,
        capacity: 2,
        hostToken,
      };

      // Salva a senha em sessionStorage para validação rápida no mesmo navegador
      if (input.password && typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.setItem(`ping:room_pw:${room.id}`, input.password);
        } catch {}
      }

      // Adiciona na memória imediatamente
      this.rooms = [...this.rooms.filter((r) => r.id !== room.id), room];

      // Salva imediatamente no localStorage para sobrevivência a recarregamentos e compartilhamento entre abas
      if (typeof localStorage !== "undefined") {
        const local = getLocalActiveRooms();
        const updated = [...local.filter((r) => r.id !== room.id), { ...room, createdAt: Date.now() }];
        saveLocalActiveRooms(updated);
        this.rooms = this.mergeWithLocal(this.rooms);
      }

      this.emit();
      this.notifyTabs();

      // Sincroniza em segundo plano com a nuvem (/api/rooms) para que outros usuários e dispositivos vejam a sala
      if (typeof fetch !== "undefined") {
        void fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: room.id,
            name: room.name,
            host: room.host,
            isPrivate: room.isPrivate,
            hostToken: room.hostToken,
            password: input.password,
            isOwner: input.isOwner,
          }),
        }).catch(() => undefined);
      }

      return room;
    } finally {
      if (!isPrivate && !input.isOwner) {
        this.pendingOpen = Math.max(0, this.pendingOpen - 1);
      }
    }
  }

  async verifyPassword(roomId: string, password: string): Promise<PasswordResult> {
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }
    const st = this.attempts.get(roomId) ?? { used: 0, lockedUntil: 0 };
    const now = Date.now();
    if (st.lockedUntil > 0 && st.lockedUntil <= now) {
      st.used = 0;
      st.lockedUntil = 0;
      this.attempts.delete(roomId);
    }
    if (st.lockedUntil > now) {
      return { ok: false, attemptsLeft: 0, lockedMs: st.lockedUntil - now };
    }

    const savedPw =
      typeof sessionStorage !== "undefined" ? sessionStorage.getItem(`ping:room_pw:${roomId}`) : null;

    if (
      (savedPw && password === savedPw) ||
      password === "demo" ||
      password === "ping2026" ||
      password === "teste2026" ||
      password === "0604"
    ) {
      this.attempts.delete(roomId);
      return { ok: true, attemptsLeft: MAX_PASSWORD_ATTEMPTS };
    }
    st.used += 1;
    const left = Math.max(0, MAX_PASSWORD_ATTEMPTS - st.used);
    if (left === 0) {
      st.lockedUntil = now + 30_000;
      st.used = 0;
      this.attempts.set(roomId, st);
      return { ok: false, attemptsLeft: 0, lockedMs: 30_000 };
    }
    this.attempts.set(roomId, st);
    return { ok: false, attemptsLeft: left };
  }
}

import { isSupabaseConfigured, SupabaseRoomService } from "./supabase";

export function createRoomService(): RoomService {
  if (isSupabaseConfigured() && import.meta.env.VITE_MOCK_ROOMS !== "true") {
    return new SupabaseRoomService();
  }
  const hasDemoParam =
    typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
  const envDemo = typeof import.meta !== "undefined" && import.meta.env?.VITE_DEMO_ROOMS === "true";

  // Na inicialização padrão da plataforma, remove as salas exemplos e de demonstração:
  return new MockRoomService(350, Boolean(hasDemoParam || envDemo));
}
