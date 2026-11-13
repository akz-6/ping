import { Redis } from "@upstash/redis";
import {
  getSessionSecret,
  verifyPayload,
  parseCookies,
  isOwnerDiscord,
  type SessionData,
} from "./_lib/session.js";

export interface StoredRoom {
  id: string;
  name: string;
  host: string;
  isPrivate: boolean;
  hidden?: boolean;
  viewers: number;
  capacity: number;
  hostToken?: string;
  password?: string;
  createdAt: number;
  updatedAt: number;
}

const ROOMS_REDIS_KEY = "ping:rooms_catalog_v1";
const MAX_STALE_MS = 30 * 60 * 1000; // 30 minutos sem heartbeat considera inativa
const MAX_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 horas máximo de vida útil da sala
const OWNER_KEY = (process.env.OWNER_KEY || "0604").trim();

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

let memoryRooms: StoredRoom[] = [];

function filterActiveRooms(rooms: StoredRoom[], now = Date.now()): StoredRoom[] {
  return rooms.filter(
    (r) => now - r.updatedAt < MAX_STALE_MS && now - r.createdAt < MAX_LIFETIME_MS,
  );
}

async function getStoredRooms(): Promise<StoredRoom[]> {
  const now = Date.now();
  if (!redis) {
    return filterActiveRooms(memoryRooms, now);
  }

  try {
    const stored = await redis.get<StoredRoom[]>(ROOMS_REDIS_KEY);
    const list = Array.isArray(stored) ? stored : [];
    memoryRooms = list;
    return filterActiveRooms(list, now);
  } catch (err) {
    console.error("Erro ao obter salas do Redis:", err);
    return filterActiveRooms(memoryRooms, now);
  }
}

async function saveStoredRooms(rooms: StoredRoom[]): Promise<void> {
  const clean = filterActiveRooms(rooms).slice(-30);
  memoryRooms = clean;
  if (!redis) return;
  await redis.set(ROOMS_REDIS_KEY, clean, { ex: 4 * 60 * 60 });
}

function publicRoom(r: StoredRoom) {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    isPrivate: r.isPrivate,
    hidden: Boolean(r.hidden),
    viewers: r.viewers ?? 0,
    capacity: r.capacity ?? 3,
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
    const urlParams = req.url && req.url.includes("?") ? new URLSearchParams(req.url.split("?")[1]) : null;

    if (method === "GET") {
      const rooms = await getStoredRooms();
      const includeHidden = req.query?.all === "true" || urlParams?.get("all") === "true";
      const targetId = req.query?.id || urlParams?.get("id");

      let filtered = rooms;
      if (!includeHidden && !targetId) {
        filtered = filtered.filter((r) => !r.hidden);
      }
      if (targetId) {
        filtered = filtered.filter((r) => r.id === targetId);
      }

      return res.status(200).json(filtered.map(publicRoom));
    }

    if (method === "POST") {
      const raw = typeof req.body === "string" ? (req.body ? JSON.parse(req.body) : {}) : req.body;
      const body = (raw?.room || raw || {}) as Partial<StoredRoom> & {
        isOwner?: boolean;
        action?: string;
        passwordAttempt?: string;
      };

      const action = body.action || req.query?.action || urlParams?.get("action");
      const actionId = body.id || req.query?.id || urlParams?.get("id");

      // Validação segura da chave do desenvolvedor / anfitrião no servidor
      if (action === "verify-creator-key") {
        const candidateKey = String((body as any).key ?? body.passwordAttempt ?? body.password ?? req.query?.key ?? urlParams?.get("key") ?? "").trim();
        const matches = Boolean(candidateKey && candidateKey === OWNER_KEY);
        return res.status(200).json({ ok: matches });
      }

      // Suporte a exclusão rápida via sendBeacon (POST com action=delete)
      if (action === "delete" && actionId) {
        const rooms = await getStoredRooms();
        const filtered = rooms.filter((r) => r.id !== actionId);
        await saveStoredRooms(filtered);
        return res.status(200).json({ ok: true });
      }

      // Verificação de senha de sala
      if (action === "verify" && actionId) {
        const rooms = await getStoredRooms();
        const target = rooms.find((r) => r.id === actionId);
        if (!target) return res.status(404).json({ ok: false, error: "Sala não encontrada" });
        const passAttempt = body.passwordAttempt ?? body.password ?? req.query?.password ?? urlParams?.get("password");
        const matches = !target.password || target.password === passAttempt || passAttempt === OWNER_KEY;
        return res.status(200).json({ ok: matches });
      }

      if (!body || !body.name || !body.id) {
        return res.status(400).json({ error: "Nome e ID são obrigatórios." });
      }

      const rooms = await getStoredRooms();
      const openCount = rooms.filter((r) => !r.isPrivate && !r.hidden).length;

      const cookies = parseCookies(req.headers?.cookie);
      const sessionToken = cookies.ping_session;
      const session = sessionToken
        ? verifyPayload<SessionData>(sessionToken, getSessionSecret())
        : null;
      const isDiscordOwner = Boolean(session && isOwnerDiscord(session.discordId));

      const isOwner =
        body.isOwner ||
        isDiscordOwner ||
        ((body as any).creatorKey && (body as any).creatorKey === OWNER_KEY);

      if (!body.isPrivate && !body.hidden && !isOwner && openCount >= 10) {
        return res.status(403).json({ error: "LIMITE_SALAS_ABERTAS" });
      }

      const now = Date.now();
      const newRoom: StoredRoom = {
        id: body.id,
        name: body.name.trim().slice(0, 50),
        host: body.host || "Anônimo",
        isPrivate: Boolean(body.isPrivate),
        hidden: Boolean(body.hidden),
        viewers: 0,
        capacity: typeof body.capacity === "number" && body.capacity > 0 ? body.capacity : 3,
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
        name?: string;
        host?: string;
        hostToken?: string;
        viewers?: number;
        capacity?: number;
        password?: string | null;
        isPrivate?: boolean;
        hidden?: boolean;
      };
      if (!body?.id) {
        return res.status(400).json({ error: "ID ausente." });
      }

      const rooms = await getStoredRooms();
      let target = rooms.find((r) => r.id === body.id);
      if (!target) {
        const now = Date.now();
        const rawPassword = typeof body.password === "string" && body.password.trim() ? body.password.trim() : undefined;
        target = {
          id: String(body.id).slice(0, 64),
          name: String(body.name || "Sala ao Vivo").trim().slice(0, 50) || "Sala ao Vivo",
          host: String(body.host || "Anfitrião").slice(0, 40),
          isPrivate: Boolean(body.isPrivate || rawPassword),
          hidden: Boolean(body.hidden),
          viewers: typeof body.viewers === "number" && body.viewers >= 0 ? Math.min(body.viewers, 999) : 0,
          capacity: typeof body.capacity === "number" && body.capacity > 0 ? Math.min(body.capacity, 50) : 3,
          hostToken: body.hostToken ? String(body.hostToken).slice(0, 128) : undefined,
          password: rawPassword ? rawPassword.slice(0, 64) : undefined,
          createdAt: now,
          updatedAt: now,
        };
        rooms.unshift(target);
        await saveStoredRooms(rooms);
        return res.status(200).json({ ok: true, room: publicRoom(target) });
      }

      target.updatedAt = Date.now();
      if (typeof body.capacity === "number" && body.capacity > 0) {
        target.capacity = body.capacity;
      }
      if (typeof body.viewers === "number") {
        target.viewers = Math.min(Math.max(0, body.viewers), target.capacity);
      }
      if (typeof body.password === "string") {
        target.password = body.password || undefined;
        target.isPrivate = body.password.length > 0;
      } else if (body.password === null) {
        target.password = undefined;
        target.isPrivate = false;
      }
      if (typeof body.isPrivate === "boolean") {
        target.isPrivate = body.isPrivate;
      }
      if (typeof body.hidden === "boolean") {
        target.hidden = body.hidden;
      }

      await saveStoredRooms(rooms);
      return res.status(200).json({ ok: true, room: publicRoom(target) });
    }

    if (method === "DELETE") {
      let roomId = req.query?.id as string | undefined;
      if (!roomId && urlParams) {
        roomId = urlParams.get("id") ?? undefined;
      }
      if (!roomId && typeof req.body === "object") {
        roomId = req.body?.id;
      }
      if (!roomId && typeof req.body === "string" && req.body.length > 0) {
        try {
          const parsed = JSON.parse(req.body);
          roomId = parsed?.id;
        } catch {}
      }
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

export async function lookupRoom(roomId: string): Promise<{ id: string; name: string; visible: boolean; hasPassword: boolean } | null> {
  const rooms = await getStoredRooms();
  const found = rooms.find((r) => r.id === roomId);
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    visible: !found.hidden,
    hasPassword: Boolean(found.password || found.isPrivate),
  };
}
