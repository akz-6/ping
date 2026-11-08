import crypto from "node:crypto";
import {
  getSessionSecret,
  signPayload,
  verifyPayload,
  getDiscordAvatarUrl,
  parseCookies,
  serializeCookie,
  isOwnerDiscord,
  type SessionData,
  type TicketData,
} from "./_lib/session";

function sendJson(res: any, status: number, data: any) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(status).json(data);
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function redirect(res: any, status: number, location: string) {
  if (typeof res.redirect === "function") {
    return res.redirect(status, location);
  }
  res.statusCode = status;
  res.setHeader("Location", location);
  res.end();
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", req.headers?.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    if (typeof res.status === "function") return res.status(204).end();
    res.statusCode = 204;
    return res.end();
  }

  const urlParams =
    req.url && req.url.includes("?")
      ? new URLSearchParams(req.url.split("?")[1])
      : null;
  const action = req.query?.action || urlParams?.get("action");

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const configured = Boolean(clientId && clientSecret);

  if (action === "status") {
    return sendJson(res, 200, { configured });
  }

  if (action === "login") {
    if (!configured) {
      return sendJson(res, 400, { error: "discord_not_configured" });
    }
    let redirectUri = process.env.DISCORD_REDIRECT_URI;
    if (!redirectUri) {
      const host =
        req.headers?.["x-forwarded-host"] || req.headers?.host || "localhost:3000";
      const proto = req.headers?.["x-forwarded-proto"] || "http";
      redirectUri = `${proto}://${host}/api/discord-auth?action=callback`;
    }
    const state = crypto.randomBytes(32).toString("hex");
    const isSecure =
      process.env.NODE_ENV === "production" ||
      req.headers?.["x-forwarded-proto"] === "https";

    res.setHeader(
      "Set-Cookie",
      serializeCookie("ping_oauth_state", state, {
        path: "/api",
        maxAge: 600,
        httpOnly: true,
        secure: isSecure,
        sameSite: "Lax",
      }),
    );

    const authUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(
      clientId!,
    )}&redirect_uri=${encodeURIComponent(
      redirectUri,
    )}&response_type=code&scope=identify&state=${encodeURIComponent(state)}`;

    return redirect(res, 302, authUrl);
  }

  if (action === "callback") {
    const code = req.query?.code || urlParams?.get("code");
    const state = req.query?.state || urlParams?.get("state");
    const cookies = parseCookies(req.headers?.cookie);
    const savedState = cookies.ping_oauth_state;

    if (!state || !savedState || state !== savedState) {
      return redirect(res, 302, "/?login=error&reason=csrf");
    }
    if (!code) {
      return redirect(res, 302, "/?login=error&reason=no_code");
    }

    let redirectUri = process.env.DISCORD_REDIRECT_URI;
    if (!redirectUri) {
      const host =
        req.headers?.["x-forwarded-host"] || req.headers?.host || "localhost:3000";
      const proto = req.headers?.["x-forwarded-proto"] || "http";
      redirectUri = `${proto}://${host}/api/discord-auth?action=callback`;
    }

    try {
      const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          grant_type: "authorization_code",
          code: String(code),
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        return redirect(res, 302, "/?login=error&reason=token_exchange");
      }
      const tokenData = (await tokenRes.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        return redirect(res, 302, "/?login=error&reason=no_token");
      }

      const userRes = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) {
        return redirect(res, 302, "/?login=error&reason=user_me");
      }
      const user = (await userRes.json()) as {
        id: string;
        username: string;
        global_name?: string | null;
        avatar?: string | null;
      };

      const sessionPayload: SessionData = {
        discordId: user.id,
        username: user.username,
        displayName: user.global_name || user.username,
        avatar: user.avatar || null,
        exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
      };

      const sessionToken = signPayload(sessionPayload, getSessionSecret());
      const isSecure =
        process.env.NODE_ENV === "production" ||
        req.headers?.["x-forwarded-proto"] === "https";

      res.setHeader("Set-Cookie", [
        serializeCookie("ping_session", sessionToken, {
          path: "/",
          maxAge: 30 * 24 * 60 * 60,
          httpOnly: true,
          secure: isSecure,
          sameSite: "Lax",
        }),
        serializeCookie("ping_oauth_state", "", {
          path: "/api",
          maxAge: 0,
          httpOnly: true,
          secure: isSecure,
          sameSite: "Lax",
        }),
      ]);

      return redirect(res, 302, "/?login=ok");
    } catch {
      return redirect(res, 302, "/?login=error&reason=server_error");
    }
  }

  if (action === "me") {
    const cookies = parseCookies(req.headers?.cookie);
    const token = cookies.ping_session;
    if (!token) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    const session = verifyPayload<SessionData>(token, getSessionSecret());
    if (!session) {
      return sendJson(res, 401, { error: "invalid_or_expired_session" });
    }
    const avatarUrl = getDiscordAvatarUrl(session.discordId, session.avatar);
    return sendJson(res, 200, {
      discordId: session.discordId,
      username: session.username,
      displayName: session.displayName,
      avatarUrl,
      isOwner: isOwnerDiscord(session.discordId),
    });
  }

  if (action === "logout") {
    const isSecure =
      process.env.NODE_ENV === "production" ||
      req.headers?.["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      serializeCookie("ping_session", "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        secure: isSecure,
        sameSite: "Lax",
      }),
    );
    if (typeof res.status === "function") {
      return res.status(204).end();
    }
    res.statusCode = 204;
    return res.end();
  }

  if (action === "ticket") {
    const cookies = parseCookies(req.headers?.cookie);
    const token = cookies.ping_session;
    if (!token) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    const session = verifyPayload<SessionData>(token, getSessionSecret());
    if (!session) {
      return sendJson(res, 401, { error: "invalid_or_expired_session" });
    }
    const peerId = req.query?.peerId || urlParams?.get("peerId");
    if (
      !peerId ||
      typeof peerId !== "string" ||
      peerId.length < 4 ||
      peerId.length > 64
    ) {
      return sendJson(res, 400, { error: "invalid_peer_id" });
    }
    const ticketPayload: TicketData = {
      discordId: session.discordId,
      username: session.username,
      displayName: session.displayName,
      avatar: session.avatar || null,
      peerId,
      exp: Date.now() + 5 * 60 * 1000,
    };
    const ticket = signPayload(ticketPayload, getSessionSecret());
    return sendJson(res, 200, { ticket });
  }

  if (action === "verify") {
    const raw =
      typeof req.body === "string"
        ? req.body
          ? JSON.parse(req.body)
          : {}
        : req.body;
    const { ticket, peerId } = (raw || {}) as {
      ticket?: string;
      peerId?: string;
    };
    if (
      !ticket ||
      !peerId ||
      typeof ticket !== "string" ||
      typeof peerId !== "string"
    ) {
      return sendJson(res, 401, { error: "invalid_request" });
    }
    const payload = verifyPayload<TicketData>(ticket, getSessionSecret());
    if (!payload || payload.peerId !== peerId) {
      return sendJson(res, 401, { error: "invalid_ticket" });
    }
    const avatarUrl = getDiscordAvatarUrl(payload.discordId, payload.avatar);
    return sendJson(res, 200, {
      discordId: payload.discordId,
      username: payload.username,
      displayName: payload.displayName,
      avatarUrl,
    });
  }

  return sendJson(res, 400, { error: "invalid_action" });
}
