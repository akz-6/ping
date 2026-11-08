let cachedResponse: { iceServers: any[]; ttl: number; degraded?: boolean } | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

const OPENRELAY_FALLBACK = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun.relay.metered.ca:80",
    ],
  },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "private, max-age=300");

  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return res.status(204).end();
  }

  if (method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const now = Date.now();
  if (cachedResponse && now - lastCacheTime < CACHE_TTL_MS) {
    return res.status(200).json(cachedResponse);
  }

  const appName = process.env.METERED_APP_NAME?.trim();
  const apiKey = process.env.METERED_API_KEY?.trim();

  if (appName && apiKey) {
    try {
      const meteredUrl = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;
      const response = await fetch(meteredUrl, {
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const iceServers = await response.json();
        if (Array.isArray(iceServers) && iceServers.length > 0) {
          cachedResponse = { iceServers, ttl: 300, degraded: false };
          lastCacheTime = now;
          return res.status(200).json(cachedResponse);
        }
      }
    } catch (err) {
      console.warn("Falha ao consultar Metered API, usando OpenRelay fallback:", err);
    }
  }

  // Fallback seguro: OpenRelay público
  cachedResponse = {
    iceServers: OPENRELAY_FALLBACK,
    ttl: 300,
    degraded: true,
  };
  lastCacheTime = now;
  return res.status(200).json(cachedResponse);
}
