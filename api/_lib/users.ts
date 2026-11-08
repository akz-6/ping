/**
 * Chamar no callback do Discord (api/discord-auth.ts, action=callback) logo após validar o perfil:
 *   await registerUser({ discordId, username, displayName, avatarUrl });
 * Permite que outros usuários achem este perfil por @username ao adicionar amigos.
 * Falhar aqui nunca deve impedir o login: capture o erro e siga.
 */
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export interface RegisteredProfile {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export async function registerUser(p: RegisteredProfile): Promise<void> {
  if (!redis) return;
  const handle = p.username.toLowerCase();
  const previous = await redis.get<{ username: string }>(`user:${p.discordId}`);
  if (previous && previous.username.toLowerCase() !== handle) {
    await redis.del(`handle:${previous.username.toLowerCase()}`);
  }
  await Promise.all([
    redis.set(`user:${p.discordId}`, { ...p, updatedAt: Date.now() }),
    redis.set(`handle:${handle}`, p.discordId),
  ]);
}
