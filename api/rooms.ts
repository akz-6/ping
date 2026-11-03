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

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (method === "GET") {
      const rooms = await getStoredRooms();
      return res.status(200).json(rooms.map(publicRoom));
    }

    if (method === "POST") {
      const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as Partial<StoredRoom> & {
        isOwner?: boolean;
      };
      if (!body || !body.name || !body.id) {
        return res.status(400).json({ error: "Nome e ID são obrigatórios." });
      }

      const rooms = await getStoredRooms();
      const openCount = rooms.filter((r) => !r.isPrivate).length;

      // Limite de 2 salas abertas no catálogo global (exceto se criado pelo dono com master key)
      if (!body.isPrivate && !body.isOwner && openCount >= 2) {
        return res.status(403).json({ error: "LIMITE_SALAS_ABERTAS" });
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

      return res.status(201).json(publicRoom(newRoom));
    }

    if (method === "PATCH") {
      const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as {
        id: string;
        hostToken?: string;
        viewers?: number;
      };
      if (!body?.id) {
        return res.status(400).json({ error: "ID ausente." });
      }

      const rooms = await getStoredRooms();
      const target = rooms.find((r) => r.id === body.id);
      if (!target) {
        return res.status(404).json({ ok: false });
      }

      target.updatedAt = Date.now();
      if (typeof body.viewers === "number") {
        target.viewers = Math.min(Math.max(0, body.viewers), target.capacity);
      }

      await saveStoredRooms(rooms);
      return res.status(200).json({ ok: true, room: publicRoom(target) });
    }

    if (method === "DELETE") {
      const roomId = req.query?.id || (typeof req.body === "object" ? req.body?.id : null);
      if (!roomId) {
        return res.status(400).json({ error: "ID ausente." });
      }

      const rooms = await getStoredRooms();
      const filtered = rooms.filter((r) => r.id !== roomId);
      await saveStoredRooms(filtered);

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método não suportado." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
