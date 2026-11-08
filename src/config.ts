import { Peer } from "peerjs";

type PeerOptions = NonNullable<ConstructorParameters<typeof Peer>[1]>;

export const ROOM_PREFIX = "ping-";
export const ROOM_PATTERN = /^(ping-|demo-)[a-z0-9_-]{4,30}$/;
export const CONNECT_TIMEOUT_MS = 25_000;

const env: Record<string, any> =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env
    : (globalThis as { process?: { env?: Record<string, any> } }).process?.env ?? {};

export function fallbackIceServers(): RTCIceServer[] {
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

let cachedIceServers: RTCIceServer[] | null = null;
let lastIceFetch = 0;

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cachedIceServers && now - lastIceFetch < 300_000) {
    return cachedIceServers;
  }
  try {
    const res = await fetch("/api/turn", {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
        cachedIceServers = data.iceServers;
        lastIceFetch = now;
        return data.iceServers;
      }
    }
  } catch {}
  return fallbackIceServers();
}

export function peerOptions(customIceServers?: RTCIceServer[]): PeerOptions {
  const opts: PeerOptions = {
    debug: env.DEV ? 2 : 0,
    config: { iceServers: customIceServers || cachedIceServers || fallbackIceServers() },
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
  Boolean(
    cachedIceServers?.some((s) =>
      typeof s.urls === "string" ? s.urls.startsWith("turn:") : s.urls.some((u) => u.startsWith("turn:")),
    ) || String(env.VITE_TURN_URLS ?? "").trim().length > 0,
  );
