import { put, list } from "@vercel/blob";

export interface StoredRoom {
  id: string;
  name: string;
  host: string;
  isPrivate: boolean;
  viewers: number;
  capacity: number;
  hostToken?: string;
  password?: string;
  createdAt: number;
  updatedAt: number;
}

const BLOB_FILENAME = "rooms-catalog.json";
const MAX_STALE_MS = 120_000; // 2 minutos sem heartbeat considera inativa
const MAX_LIFETIME_MS = 14_400_000; // 4 horas máximo de vida

async function getStoredRooms(): Promise<StoredRoom[]> {
  try {
    const { blobs } = await list({ prefix: BLOB_FILENAME });
    if (!blobs || blobs.length === 0) return [];
    const target = blobs.find((b) => b.pathname === BLOB_FILENAME) ?? blobs[0];
    const res = await fetch(target.url, { cache: "no-store" });
    if (!res.ok) return [];
    const list = (await res.json()) as StoredRoom[];
    const now = Date.now();
    return list.filter((r) => now - r.updatedAt < MAX_STALE_MS && now - r.createdAt < MAX_LIFETIME_MS);
  } catch {
    return [];
  }
}

async function saveStoredRooms(rooms: StoredRoom[]): Promise<void> {
  const clean = rooms.slice(-20);
  await put(BLOB_FILENAME, JSON.stringify(clean), {
    access: "public",
    addRandomSuffix: false,
  });
}

function publicRoom(r: StoredRoom) {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    isPrivate: r.isPrivate,
    viewers: r.viewers ?? 0,
    capacity: r.capacity ?? 2,
    hostToken: r.hostToken,
  };
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (method === "GET") {
      const rooms = await getStoredRooms();
      return new Response(JSON.stringify(rooms.map(publicRoom)), { status: 200, headers });
    }

    if (method === "POST") {
      const body = (await req.json()) as Partial<StoredRoom> & { isOwner?: boolean };
      if (!body.name || !body.id) {
        return new Response(JSON.stringify({ error: "Nome e ID são obrigatórios." }), { status: 400, headers });
      }

      const rooms = await getStoredRooms();
      const openCount = rooms.filter((r) => !r.isPrivate).length;

      // Limite de 2 salas abertas no catálogo global (exceto se criado pelo dono com master key)
      if (!body.isPrivate && !body.isOwner && openCount >= 2) {
        return new Response(JSON.stringify({ error: "LIMITE_SALAS_ABERTAS" }), { status: 403, headers });
      }

      const now = Date.now();
      const newRoom: StoredRoom = {
        id: body.id,
        name: body.name.trim().slice(0, 50),
        host: body.host || "Anônimo",
        isPrivate: Boolean(body.isPrivate),
        viewers: 0,
        capacity: 2,
        hostToken: body.hostToken,
        password: body.password,
        createdAt: now,
        updatedAt: now,
      };

      const updatedList = [...rooms.filter((r) => r.id !== newRoom.id), newRoom];
      await saveStoredRooms(updatedList);

      return new Response(JSON.stringify(publicRoom(newRoom)), { status: 201, headers });
    }

    if (method === "PATCH") {
      const body = (await req.json()) as { id: string; hostToken?: string; viewers?: number };
      if (!body.id) {
        return new Response(JSON.stringify({ error: "ID ausente." }), { status: 400, headers });
      }

      const rooms = await getStoredRooms();
      const target = rooms.find((r) => r.id === body.id);
      if (!target) {
        return new Response(JSON.stringify({ ok: false }), { status: 404, headers });
      }

      target.updatedAt = Date.now();
      if (typeof body.viewers === "number") {
        target.viewers = Math.min(Math.max(0, body.viewers), target.capacity);
      }

      await saveStoredRooms(rooms);
      return new Response(JSON.stringify({ ok: true, room: publicRoom(target) }), { status: 200, headers });
    }

    if (method === "DELETE") {
      const roomId = url.searchParams.get("id");
      if (!roomId) {
        return new Response(JSON.stringify({ error: "ID ausente." }), { status: 400, headers });
      }

      const rooms = await getStoredRooms();
      const filtered = rooms.filter((r) => r.id !== roomId);
      await saveStoredRooms(filtered);

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Método não suportado." }), { status: 405, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
}
