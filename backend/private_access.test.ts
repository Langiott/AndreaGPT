import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { accessDigest, privateAccess } from "./private_access";

test("blocca richieste dirette, file e token preesistenti finché il browser non accede", async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "andrea-access-test-"));
  const file = path.join(scratch, "access.sha256");
  const code = "codice-sintetico-solo-per-il-test";
  writeFileSync(file, accessDigest(code).toString("hex"));
  const app = express();
  app.use(privateAccess(file, { isTailscale: req => req.headers["x-example-tailscale"] === "true", allowLocal: true }));
  app.use((_req, res) => res.json({ private: true }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const direct = await fetch(origin + "/api/chat");
    assert.equal(direct.status, 401);
    assert.equal(direct.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(origin + "/outputs/export.txt")).status, 401);
    assert.equal((await fetch(origin + "/api/candidature/import", { method: "POST", headers: { "x-candidature-token": "token-esistente" } })).status, 401);
    assert.deepEqual(await fetch(origin + "/api/health").then(res => res.json()), { ok: true });
    const redirected = await new Promise<{ status?: number; location?: string }>((resolve, reject) => {
      get(origin, { headers: { accept: "text/html", "sec-fetch-mode": "navigate" } }, res => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location });
      }).on("error", reject);
    });
    assert.deepEqual(redirected, { status: 303, location: "/accesso" });
    assert.doesNotMatch(await fetch(origin + "/accesso").then(res => res.text()), new RegExp(code));

    const login = (secret: string, ref = origin, secure = false) => fetch(origin + "/accesso", {
      method: "POST", redirect: "manual",
      headers: { origin: ref, ...(secure && { "x-example-tailscale": "true", "x-forwarded-host": "test.example.ts.net" }) },
      body: new URLSearchParams({ code: secret }),
    });
    assert.equal((await login(code, "https://other.invalid")).status, 403);
    assert.equal((await login("sbagliato")).status, 401);
    const session = await login(code);
    assert.equal(session.status, 303);
    const token = session.headers.get("set-cookie") ?? "";
    assert.match(token, /HttpOnly/);
    assert.match(token, /SameSite=Lax/);
    const headers = { cookie: token.split(";")[0] };
    assert.deepEqual(await fetch(origin + "/api/chat", { headers }).then(res => res.json()), { private: true });
    assert.equal((await fetch(origin + "/api/chat", { headers: { cookie: "andreagpt_access=falso" } })).status, 401);
    assert.match((await login(code, "https://test.example.ts.net", true)).headers.get("set-cookie") ?? "", /; Secure/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(scratch, { recursive: true, force: true });
  }
});
