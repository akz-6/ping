import { defineConfig, type Plugin } from "vite";

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "display-capture=(self)",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' https: wss: http: ws:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

function localApiRoomsPlugin(): Plugin {
  let inMemoryRooms: any[] = [];
  return {
    name: "local-api-rooms",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/api/turn")) {
          res.setHeader("Content-Type", "application/json");
          res.statusCode = 200;
          return res.end(
            JSON.stringify({
              iceServers: [
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
                  ],
                  username: "openrelayproject",
                  credential: "openrelayproject",
                },
              ],
              ttl: 300,
              degraded: true,
            }),
          );
        }

        if (!req.url?.startsWith("/api/rooms")) return next();
        const url = new URL(req.url, "http://localhost");
        const method = (req.method || "GET").toUpperCase();

        res.setHeader("Content-Type", "application/json");

        if (req.url === "/api/rooms/reset" || url.searchParams.get("reset") === "1") {
          inMemoryRooms = [];
          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true }));
        }

        if (method === "GET") {
          const includeHidden = url.searchParams.get("all") === "true";
          const id = url.searchParams.get("id");
          let list = inMemoryRooms;
          if (!includeHidden && !id) list = list.filter((r) => !r.hidden);
          if (id) list = list.filter((r) => r.id === id);
          res.statusCode = 200;
          return res.end(JSON.stringify(list));
        }

        let bodyRaw = "";
        req.on("data", (chunk: any) => {
          bodyRaw += chunk;
        });
        req.on("end", () => {
          let body: any = {};
          try {
            if (bodyRaw) body = JSON.parse(bodyRaw);
          } catch {}

          const action = body.action || url.searchParams.get("action");
          const actionId = body.id || url.searchParams.get("id");
          const ownerKey = (process.env.OWNER_KEY || "ping-test-owner-key").trim();

          if (action === "verify-creator-key") {
            const candidateKey = String(body.key || body.passwordAttempt || body.password || url.searchParams.get("key") || "").trim();
            const matches = Boolean(candidateKey && candidateKey === ownerKey);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: matches }));
          }

          if (action === "delete" && actionId) {
            inMemoryRooms = inMemoryRooms.filter((r) => r.id !== actionId);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true }));
          }

          if (action === "verify" && actionId) {
            const target = inMemoryRooms.find((r) => r.id === actionId);
            const passAttempt = body.passwordAttempt || body.password || url.searchParams.get("password");
            const matches = !target?.password || target.password === passAttempt || passAttempt === ownerKey;
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: matches }));
          }

          if (method === "POST") {
            const newRoom = {
              id: body.id,
              name: body.name || "Sala Local",
              host: body.host || "Anônimo",
              isPrivate: Boolean(body.isPrivate),
              hidden: Boolean(body.hidden),
              viewers: 0,
              capacity: 2,
              hostToken: body.hostToken,
              password: body.password,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            inMemoryRooms = [...inMemoryRooms.filter((r) => r.id !== newRoom.id), newRoom];
            res.statusCode = 201;
            return res.end(JSON.stringify(newRoom));
          }

          if (method === "PATCH") {
            const target = inMemoryRooms.find((r) => r.id === body.id);
            if (target) {
              target.updatedAt = Date.now();
              if (typeof body.viewers === "number") target.viewers = body.viewers;
              if (typeof body.password === "string") {
                target.password = body.password || undefined;
                target.isPrivate = body.password.length > 0;
              } else if (body.password === null) {
                target.password = undefined;
                target.isPrivate = false;
              }
              if (typeof body.isPrivate === "boolean") target.isPrivate = body.isPrivate;
              if (typeof body.hidden === "boolean") target.hidden = body.hidden;
            }
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true }));
          }

          if (method === "DELETE") {
            const delId = url.searchParams.get("id") || body.id;
            if (delId) inMemoryRooms = inMemoryRooms.filter((r) => r.id !== delId);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true }));
          }

          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [localApiRoomsPlugin()],
  build: { target: "es2022", sourcemap: true },
  server: { headers: securityHeaders },
  preview: { headers: securityHeaders },
});
