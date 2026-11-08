import type { PresenceState } from '../app/avatar';

/** Perfil verificado pelo Discord (vem de /api/discord-auth?action=me). */
export interface PingProfile {
  discordId: string;
  username: string;       // @handle único do Discord
  displayName: string;    // global_name ?? username
  avatarUrl: string;      // CDN do Discord
}

/** Visão de um amigo, já filtrada pelo servidor conforme a privacidade dele. */
export interface Friend {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  presence: PresenceState;
  /** Só presente quando a sala é pública (visível no Lobby). Nunca vaza sala oculta. */
  room?: { id: string; name: string; hasPassword: boolean };
  /** true quando o amigo está numa sala oculta: a UI mostra "em uma sala privada", sem botão de entrada. */
  inPrivateRoom?: boolean;
}

export interface FriendRequest {
  from: Pick<PingProfile, 'discordId' | 'username' | 'displayName' | 'avatarUrl'>;
  at: number;
}

export interface FriendsSnapshot {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoingCount: number;
  settings: { showActivity: boolean };   // "Mostrar o que estou fazendo aos amigos"
}

/** Enviado a cada 30 s e ao entrar/sair de sala. TTL de presença no servidor: 75 s. */
export interface HeartbeatBody {
  roomId?: string;
  role?: 'host' | 'viewer';
}

export type FriendsApiError =
  | 'unauthenticated'
  | 'not_found'
  | 'self'
  | 'already_friends'
  | 'rate_limited'
  | 'limit_reached'
  | 'invalid';
