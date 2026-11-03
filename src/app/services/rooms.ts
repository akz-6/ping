export interface Room {
  id: string;
  name: string;
  host: string;
  isPrivate: boolean;
  viewers: number;
  capacity: number;
  hostToken?: string;
}

export const MAX_OPEN_ROOMS = 5;
export const MAX_PASSWORD_ATTEMPTS = 3;

export interface PasswordResult {
  ok: boolean;
  attemptsLeft: number;
  /** Tempo de bloqueio imposto pelo backend (ms), quando as tentativas acabam. */
  lockedMs?: number;
}

/** Contrato do catálogo de salas. A implementação real (Supabase, fase L2) entra no lugar do mock. */
export interface RoomService {
  list(): Promise<Room[]>;
  subscribe(cb: (rooms: Room[]) => void): () => void;
  create(input: { name: string; password: string; host: string }): Promise<Room>;
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
    { id: "demo-1", name: "Café da manhã", host: "Marina", isPrivate: false, viewers: 2, capacity: 5 },
    { id: "demo-2", name: "Jogatina de sexta", host: "João", isPrivate: false, viewers: 3, capacity: 5 },
    { id: "demo-3", name: "Estudo de cálculo", host: "Ana", isPrivate: false, viewers: 5, capacity: 5 },
    { id: "demo-4", name: "Reunião da equipe", host: "Rafael", isPrivate: true, viewers: 1, capacity: 5 },
    { id: "demo-5", name: "Só os amigos", host: "Lia", isPrivate: true, viewers: 0, capacity: 5 },
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

  async create(input: { name: string; password: string; host: string }): Promise<Room> {
    await new Promise((r) => setTimeout(r, this.latencyMs));
    const isPrivate = input.password.length > 0;
    if (!isPrivate && this.rooms.filter((r) => !r.isPrivate).length >= MAX_OPEN_ROOMS) {
      throw new RoomLimitError();
    }
    const room: Room = {
      id: `demo-${Date.now().toString(36)}`,
      name: input.name,
      host: input.host,
      isPrivate,
      viewers: 0,
      capacity: 5,
    };
    this.rooms = [...this.rooms, room];
    this.emit();
    return room;
  }

  async verifyPassword(roomId: string, password: string): Promise<PasswordResult> {
    await new Promise((r) => setTimeout(r, this.latencyMs));
    const st = this.attempts.get(roomId) ?? { used: 0, lockedUntil: 0 };
    const now = Date.now();
    if (st.lockedUntil > now) {
      return { ok: false, attemptsLeft: 0, lockedMs: st.lockedUntil - now };
    }
    if (password === "demo") {
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
