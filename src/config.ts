import { Peer } from "peerjs";

type PeerOptions = NonNullable<ConstructorParameters<typeof Peer>[1]>;

export const ROOM_PREFIX = "ping-";
export const ROOM_PATTERN = /^(ping-|demo-)[a-z0-9_-]{4,30}$/;
export const CONNECT_TIMEOUT_MS = 15_000;

const env = import.meta.env;

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun.relay.metered.ca:80",
      ],
    },
  ];

  const turnUrls = String(env.VITE_TURN_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls,
      username: String(env.VITE_TURN_USERNAME ?? ""),
      credential: String(env.VITE_TURN_CREDENTIAL ?? ""),
    });
  }
  return servers;
}

export function peerOptions(): PeerOptions {
  const opts: PeerOptions = {
    debug: env.DEV ? 2 : 0,
    config: { iceServers: iceServers() },
  };

  const host = String(env.VITE_PEER_HOST ?? "").trim();
  if (host) {
    opts.host = host;
    opts.port = Number(env.VITE_PEER_PORT ?? 443);
    opts.path = String(env.VITE_PEER_PATH ?? "/");
    opts.secure = String(env.VITE_PEER_SECURE ?? "true") !== "false";
  }
  return opts;
}

export const hasTurn = (): boolean =>
  String(env.VITE_TURN_URLS ?? "").trim().length > 0;
