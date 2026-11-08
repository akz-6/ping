/**
 * Ping v2: amigos + presença (somente usuários logados no Discord).
 *
 * O scope `identify` do Discord NÃO inclui a lista de amigos do Discord (o scope de relacionamentos é
 * restrito pelo Discord). Por isso o grafo de amigos é do próprio Ping, indexado pelo discordId verificado.
 *
 * Armazenamento: Upstash Redis (Marketplace da Vercel). Envs aceitas:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   ou   KV_REST_API_URL / KV_REST_API_TOKEN
 * Sem Redis configurado, todas as rotas respondem 503 (o cliente trata como indisponível).
 *
 * Dependências de outros arquivos (já criados na Fase 6 do superprompt anterior):
 *   ./_lib/session  -> export function readSession(cookieHeader?: string): SessionUser | null
 *   ./_lib/users    -> registerUser(profile) é chamado pelo callback do Discord (ver superprompt, Fase B)
 *   lookupRoom()    -> ligue ao armazenamento de salas existente (api/rooms.ts) conforme o TODO abaixo.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { readSession } from './_lib/session.js';
import { lookupRoom } from './rooms.js';

interface SessionUser { discordId: string; username: string; displayName: string; avatarUrl: string }
interface PublicProfile extends SessionUser { updatedAt: number }
interface Presence { roomId?: string; role?: 'host' | 'viewer'; at: number }

const MAX_FRIENDS = 200;
const MAX_INCOMING = 50;
const PRESENCE_TTL_S = 75;
const ROOM_ID = /^[A-Za-z0-9_-]{4,64}$/;
const HANDLE = /^[a-z0-9_.]{2,32}$/;

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

/** TODO(Antigravity): trocar pelo acesso real ao store de salas de api/rooms.ts (blob + memória). */
// lookupRoom imported from ./rooms.js

function send(res: VercelResponse, status: number, body: unknown) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(body);
}

async function limit(r: Redis, id: string, action: string, max: number): Promise<boolean> {
  const key = `rl:${id}:${action}:${Math.floor(Date.now() / 60_000)}`;
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, 70);
  return n <= max;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!redis) return send(res, 503, { error: 'invalid' });
  const me = readSession(req.headers.cookie) as SessionUser | null;
  if (!me) return send(res, 401, { error: 'unauthenticated' });

  const action = String(req.query.action ?? '');
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

  try {
    switch (action) {
      case 'list': return req.method === 'GET' ? await list(redis, me, res) : send(res, 405, { error: 'invalid' });
      case 'heartbeat': return await heartbeat(redis, me, body, res);
      case 'request': return await requestFriend(redis, me, body, res);
      case 'accept': return await accept(redis, me, body, res);
      case 'decline': return await decline(redis, me, body, res);
      case 'remove': return await remove(redis, me, body, res);
      case 'settings': return await settings(redis, me, body, res);
      default: return send(res, 400, { error: 'invalid' });
    }
  } catch {
    return send(res, 500, { error: 'invalid' });
  }
}

async function list(r: Redis, me: SessionUser, res: VercelResponse) {
  const [friendIds, incoming, mySettings] = await Promise.all([
    r.smembers(`friends:${me.discordId}`),
    r.hgetall<Record<string, number>>(`req:in:${me.discordId}`),
    r.get<{ showActivity: boolean }>(`settings:${me.discordId}`),
  ]);

  const friends = await Promise.all((friendIds as string[]).map(async (fid) => {
    const [profile, presence, theirs] = await Promise.all([
      r.get<PublicProfile>(`user:${fid}`),
      r.get<Presence>(`presence:${fid}`),
      r.get<{ showActivity: boolean }>(`settings:${fid}`),
    ]);
    if (!profile) return null;
    const base = { discordId: fid, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl };
    const hidden = theirs?.showActivity === false;
    if (!presence || hidden) return { ...base, presence: 'offline' as const };
    if (!presence.roomId) return { ...base, presence: 'online' as const };
    const room = await lookupRoom(presence.roomId);
    const state = presence.role === 'host' ? ('hosting' as const) : ('watching' as const);
    // Privacidade: sala oculta nunca expõe id, nome nem botão de entrada.
    if (!room || !room.visible) return { ...base, presence: state, inPrivateRoom: true };
    return { ...base, presence: state, room: { id: room.id, name: room.name, hasPassword: room.hasPassword } };
  }));

  const incomingList = (await Promise.all(Object.entries(incoming ?? {}).map(async ([fid, at]) => {
    const p = await r.get<PublicProfile>(`user:${fid}`);
    return p ? { from: { discordId: fid, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl }, at: Number(at) } : null;
  }))).filter(Boolean);

  const outgoingCount = await r.scard(`req:out:${me.discordId}`);
  return send(res, 200, {
    friends: friends.filter(Boolean),
    incoming: incomingList,
    outgoingCount,
    settings: { showActivity: mySettings?.showActivity ?? true },
  });
}

async function heartbeat(r: Redis, me: SessionUser, body: Record<string, unknown>, res: VercelResponse) {
  const roomId = typeof body.roomId === 'string' && ROOM_ID.test(body.roomId) ? body.roomId : undefined;
  const role = body.role === 'host' || body.role === 'viewer' ? body.role : undefined;
  if (body.roomId !== undefined && !roomId) return send(res, 400, { error: 'invalid' });
  if (!(await limit(r, me.discordId, 'beat', 12))) return send(res, 429, { error: 'rate_limited' });
  const value: Presence = { roomId, role: roomId ? role ?? 'viewer' : undefined, at: Date.now() };
  await r.set(`presence:${me.discordId}`, value, { ex: PRESENCE_TTL_S });
  return send(res, 200, { ok: true });
}

async function requestFriend(r: Redis, me: SessionUser, body: Record<string, unknown>, res: VercelResponse) {
  if (!(await limit(r, me.discordId, 'request', 10))) return send(res, 429, { error: 'rate_limited' });
  const handle = typeof body.handle === 'string' ? body.handle.toLowerCase().replace(/^@/, '').trim() : '';
  if (!HANDLE.test(handle)) return send(res, 400, { error: 'invalid' });
  const targetId = await r.get<string>(`handle:${handle}`);
  if (!targetId) return send(res, 404, { error: 'not_found' });
  if (targetId === me.discordId) return send(res, 400, { error: 'self' });
  if (await r.sismember(`friends:${me.discordId}`, targetId)) return send(res, 409, { error: 'already_friends' });
  if ((await r.scard(`friends:${me.discordId}`)) >= MAX_FRIENDS) return send(res, 409, { error: 'limit_reached' });

  // Pedido cruzado: se o outro já me pediu, aceitar direto.
  const crossed = await r.hget(`req:in:${me.discordId}`, targetId);
  if (crossed) return makeFriends(r, me.discordId, targetId, res);

  if ((await r.hlen(`req:in:${targetId}`)) >= MAX_INCOMING) return send(res, 409, { error: 'limit_reached' });
  await Promise.all([
    r.hset(`req:in:${targetId}`, { [me.discordId]: Date.now() }),
    r.sadd(`req:out:${me.discordId}`, targetId),
  ]);
  return send(res, 200, { ok: true });
}

async function accept(r: Redis, me: SessionUser, body: Record<string, unknown>, res: VercelResponse) {
  const fid = typeof body.discordId === 'string' ? body.discordId : '';
  if (!/^\d{5,25}$/.test(fid)) return send(res, 400, { error: 'invalid' });
  if (!(await r.hget(`req:in:${me.discordId}`, fid))) return send(res, 404, { error: 'not_found' });
  return makeFriends(r, me.discordId, fid, res);
}

async function makeFriends(r: Redis, a: string, b: string, res: VercelResponse) {
  await Promise.all([
    r.sadd(`friends:${a}`, b), r.sadd(`friends:${b}`, a),
    r.hdel(`req:in:${a}`, b), r.hdel(`req:in:${b}`, a),
    r.srem(`req:out:${a}`, b), r.srem(`req:out:${b}`, a),
  ]);
  return send(res, 200, { ok: true });
}

async function decline(r: Redis, me: SessionUser, body: Record<string, unknown>, res: VercelResponse) {
  const fid = typeof body.discordId === 'string' ? body.discordId : '';
  if (!/^\d{5,25}$/.test(fid)) return send(res, 400, { error: 'invalid' });
  await Promise.all([r.hdel(`req:in:${me.discordId}`, fid), r.srem(`req:out:${fid}`, me.discordId)]);
  return send(res, 200, { ok: true });
}

async function remove(r: Redis, me: SessionUser, body: Record<string, unknown>, res: VercelResponse) {
  const fid = typeof body.discordId === 'string' ? body.discordId : '';
  if (!/^\d{5,25}$/.test(fid)) return send(res, 400, { error: 'invalid' });
  await Promise.all([r.srem(`friends:${me.discordId}`, fid), r.srem(`friends:${fid}`, me.discordId)]);
  return send(res, 200, { ok: true });
}

async function settings(r: Redis, me: SessionUser, body: Record<string, unknown>, res: VercelResponse) {
  if (typeof body.showActivity !== 'boolean') return send(res, 400, { error: 'invalid' });
  await r.set(`settings:${me.discordId}`, { showActivity: body.showActivity });
  return send(res, 200, { ok: true });
}
