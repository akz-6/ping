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

/** Dados simulados (flag VITE_MOCK_ROOMS, ligada por padrão até o backend existir). Senha das salas fechadas de demonstração: "demo". */
export class MockRoomService implements RoomService {
  private rooms: Room[] = [
    { id: "demo-publica-lotada", name: "Sala Pública (Demonstração)", host: "Sistema", isPrivate: false, viewers: 2, capacity: 2 },
    { id: "demo-fechada-teste", name: "Sala Fechada (Exemplo)", host: "Moderador", isPrivate: true, viewers: 1, capacity: 2 },
  ];
  private listeners = new Set<(rooms: Room[]) => void>();
  private attempts = new Map<string, { used: number; lockedUntil: number }>();

  constructor(private readonly latencyMs = 350) {}

  private emit(): void {
    const snapshot = this.rooms.map((r) => ({ ...r }));
    this.listeners.forEach((cb) => cb(snapshot));
  }

  async list(): Promise<Room[]> {
    await new Promise((r) => setTimeout(r, this.latencyMs));
    return this.rooms.map((r) => ({ ...r }));
  }

  subscribe(cb: (rooms: Room[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async create(input: CreateRoomInput): Promise<Room> {
    await new Promise((r) => setTimeout(r, this.latencyMs));
    const isPrivate = Boolean(input.password && input.password.length > 0);
    const openRooms = this.rooms.filter((r) => !r.isPrivate).length;

    // Se já tiver 2 salas abertas, somente o dono com a chave mestra (0604) pode criar
    if (!isPrivate && !input.isOwner && openRooms >= MAX_OPEN_ROOMS) {
      throw new RoomLimitError();
    }
    const room: Room = {
      id: `${ROOM_PREFIX}${shortId(12)}`,
      name: input.name,
      host: input.host,
      isPrivate,
      viewers: 0,
      capacity: 2,
    };
    this.rooms = [...this.rooms, room];
    this.emit();
    return room;
  }

  async verifyPassword(roomId: string, password: string): Promise<PasswordResult> {
    await new Promise((r) => setTimeout(r, this.latencyMs));
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
    if (password === "demo" || password === "ping2026" || password === "teste2026" || password === "0604") {
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
  return new MockRoomService();
}
