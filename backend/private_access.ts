import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";

const cookieName = "andreagpt_access";
const sessionAge = 24 * 60 * 60_000;
const loginPath = "/accesso";

export function accessDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function privateAccess(file: string, settings: {
  isTailscale: (request: express.Request) => boolean;
  allowLocal: boolean;
}) {
  let digest: Buffer;
  try {
    const value = readFileSync(file, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Configurazione accesso AndreaGPT non valida.");
    digest = Buffer.from(value, "hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return express.Router();
  }

  const router = express.Router({ caseSensitive: true, strict: true });
  const sessions = new Map<string, number>();
  const parseLogin = express.urlencoded({ extended: false, limit: "1kb", parameterLimit: 2 });
  let attempts = 0;
  let windowStart = Date.now();

  const cookie = (request: express.Request) => request.headers.cookie?.split(";").map(part => part.trim())
    .find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1) ?? "";
  const localHost = (request: express.Request) => /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(request.headers.host ?? "");
  const internalHealth = (request: express.Request) => request.method === "GET" && request.path === "/api/health"
    && localHost(request) && /^(?:::ffff:)?127\.0\.0\.1$|^::1$/.test(request.socket.remoteAddress ?? "");

  router.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "same-origin");
    if (request.path === loginPath) { next(); return; }
    const expires = sessions.get(cookie(request)) ?? 0;
    if (expires > Date.now()) { next(); return; }
    if (internalHealth(request)) { response.json({ ok: true }); return; }
    if (request.method === "GET" && request.accepts("html") && !request.path.startsWith("/api/") && request.headers["sec-fetch-mode"] === "navigate") {
      response.redirect(303, loginPath);
      return;
    }
    response.status(401).json({ error: "Apri AndreaGPT nel browser ed esegui l’accesso." });
  });

  function showLogin(response: express.Response, status = 200, message = "") {
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.status(status).type("html").send(`<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accedi ad AndreaGPT</title><style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#080a08;color:#f8ede3;font:16px/1.5 system-ui,sans-serif}
main{box-sizing:border-box;width:min(100%,420px);padding:24px}h1{font-size:1.5rem}
form{display:grid;gap:12px}input,button{box-sizing:border-box;width:100%;padding:12px;font:inherit;border-radius:9px}
input{border:1px solid #877968;background:#191b17;color:inherit}button{border:0;background:#f5d6af;color:#241609;cursor:pointer}
p{color:#ffd4b8}</style></head><body><main><h1>Accedi ad AndreaGPT</h1>
${message ? `<p role="alert">${message}</p>` : ""}
<form action="/accesso" method="post"><label for="code">Codice di accesso</label>
<input id="code" name="code" type="password" autocomplete="current-password" autocapitalize="none" required maxlength="100">
<button type="submit">Accedi</button></form></main></body></html>`);
  }

  router.get(loginPath, (request, response) => {
    if (!settings.isTailscale(request) && (!settings.allowLocal || !localHost(request))) {
      showLogin(response, 403, "Apri AndreaGPT tramite Tailscale o dal PC.");
      return;
    }
    showLogin(response);
  });
  router.post(loginPath, parseLogin, (request, response) => {
    const secure = settings.isTailscale(request);
    const host = secure ? request.headers["x-forwarded-host"] : request.headers.host;
    if ((!secure && (!settings.allowLocal || !localHost(request))) || request.headers.origin !== `${secure ? "https" : "http"}://${host}`) {
      showLogin(response, 403, "Apri la pagina di accesso da AndreaGPT.");
      return;
    }
    const now = Date.now();
    if (now - windowStart >= 5 * 60_000) { windowStart = now; attempts = 0; }
    if (attempts >= 10) { showLogin(response, 429, "Troppi tentativi. Riprova tra qualche minuto."); return; }
    const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
    if (!timingSafeEqual(accessDigest(code), digest)) {
      attempts++;
      showLogin(response, 401, "Codice di accesso errato.");
      return;
    }
    attempts = 0;
    for (const [key, expiry] of sessions) if (expiry <= now || key === cookie(request)) sessions.delete(key);
    if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, now + sessionAge);
    response.cookie(cookieName, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: sessionAge });
    response.redirect(303, "/?home=1");
  });

  return router;
}
