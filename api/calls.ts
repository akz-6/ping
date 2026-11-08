import type { IncomingMessage, ServerResponse } from "node:http";

interface CallsBody {
  action?: string;
  sessionId?: string;
  sdp?: string;
  tracks?: Array<{ mid?: string; trackName?: string }>;
  remote?: {
    sessionId: string;
    trackNames: string[];
  };
  mids?: string[];
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 120) {
    return false;
  }
  entry.count += 1;
  return true;
}

export default async function handler(
  req: IncomingMessage & { body?: any },
  res: ServerResponse,
): Promise<void> {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  if (!checkRateLimit(clientIp)) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "sfu_unavailable", message: "Rate limit exceeded" }));
    return;
  }

  // Parse body
  let body: CallsBody = {};
  if (req.body && typeof req.body === "object") {
    body = req.body;
  } else {
    try {
      const raw = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => {
          data += chunk;
        });
        req.on("end", () => resolve(data));
      });
      if (raw) body = JSON.parse(raw);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }
  }

  const appId = (process.env.CF_CALLS_APP_ID || "").trim();
  const appSecret = (process.env.CF_CALLS_APP_SECRET || "").trim();
  const action = body.action;

  res.setHeader("Content-Type", "application/json");

  // Health check
  if (action === "health") {
    if (!appId || !appSecret) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false }));
      return;
    }

    try {
      // Test basic connection/auth with Cloudflare Calls
      const cfRes = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}/sessions/new`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${appSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      if (cfRes.ok) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false }));
      return;
    } catch {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false }));
      return;
    }
  }

  // Se faltar configuração para qualquer outra ação, retorna 503 para ativar failover automático
  if (!appId || !appSecret) {
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        error: "sfu_unavailable",
        message: "Cloudflare Calls credentials not configured",
      }),
    );
    return;
  }

  const baseUrl = `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}`;
  const headers = {
    Authorization: `Bearer ${appSecret}`,
    "Content-Type": "application/json",
  };

  try {
    switch (action) {
      case "session.new": {
        const cfRes = await fetch(`${baseUrl}/sessions/new`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        });
        if (!cfRes.ok) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "sfu_unavailable", status: cfRes.status }));
          return;
        }
        const data = (await cfRes.json()) as { sessionId?: string };
        res.statusCode = 200;
        res.end(JSON.stringify({ sessionId: data.sessionId }));
        return;
      }

      case "tracks.publish": {
        const { sessionId, sdp, tracks } = body;
        if (!sessionId || !sdp || !tracks) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing sessionId, sdp or tracks" }));
          return;
        }

        const cfRes = await fetch(
          `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              sessionDescription: { type: "offer", sdp },
              tracks: tracks.map((t) => ({
                location: "local",
                mid: t.mid,
                trackName: t.trackName,
              })),
            }),
          },
        );

        if (!cfRes.ok) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "sfu_unavailable", status: cfRes.status }));
          return;
        }

        const data = (await cfRes.json()) as any;
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            sdp: data.sessionDescription?.sdp,
            tracks: data.tracks,
          }),
        );
        return;
      }

      case "tracks.pull": {
        const { sessionId, remote } = body;
        if (!sessionId || !remote?.sessionId || !remote?.trackNames) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing sessionId or remote info" }));
          return;
        }

        const cfRes = await fetch(
          `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              tracks: remote.trackNames.map((name) => ({
                location: "remote",
                sessionId: remote.sessionId,
                trackName: name,
              })),
            }),
          },
        );

        if (!cfRes.ok) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "sfu_unavailable", status: cfRes.status }));
          return;
        }

        const data = (await cfRes.json()) as any;
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            sdp: data.sessionDescription?.sdp,
            requiresImmediateRenegotiation: data.requiresImmediateRenegotiation,
            tracks: data.tracks,
          }),
        );
        return;
      }

      case "renegotiate": {
        const { sessionId, sdp } = body;
        if (!sessionId || !sdp) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing sessionId or sdp" }));
          return;
        }

        const cfRes = await fetch(
          `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/renegotiate`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({
              sessionDescription: { type: "answer", sdp },
            }),
          },
        );

        if (!cfRes.ok) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "sfu_unavailable", status: cfRes.status }));
          return;
        }

        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      case "tracks.close": {
        const { sessionId, mids } = body;
        if (!sessionId || !mids) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Missing sessionId or mids" }));
          return;
        }

        const cfRes = await fetch(
          `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/tracks/close`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({
              tracks: mids.map((mid) => ({ mid })),
            }),
          },
        );

        if (!cfRes.ok) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "sfu_unavailable", status: cfRes.status }));
          return;
        }

        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      default: {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Unknown action" }));
        return;
      }
    }
  } catch (err: any) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "sfu_unavailable", message: err?.message }));
  }
}
