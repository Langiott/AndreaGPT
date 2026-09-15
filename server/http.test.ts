import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { localOllamaUrl } from "./local";

test("Ollama rifiuta host remoti, credenziali e redirect via URL", () => {
  for (const url of ["https://example.com", "http://user:pass@localhost", "http://localhost/api", "http://localhost?token=x"]) assert.throws(() => localOllamaUrl(url));
  assert.equal(localOllamaUrl("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
});

test("HTTP: streaming locale, limiti, origini e cronologia Brain bloccata al cloud/web", { timeout: 30000 }, async t => {
  const requests: Record<string, any>[] = [];
  let cancelled = false;
  const mock = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    requests.push({ ...JSON.parse(body), authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/x-ndjson");
    if (body.includes("WAIT_FOR_STOP")) {
      res.on("close", () => { cancelled = true; });
      res.write(JSON.stringify({ message: { content: "Inizio" } }) + "\n");
      return;
    }
    res.end(JSON.stringify({ message: { content: "Risposta locale" }, done: true }) + "\n");
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  t.after(() => { mock.close(); });
  const portProbe = createServer().listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const port = (portProbe.address() as { port: number }).port;
  await new Promise<void>(resolve => portProbe.close(() => resolve()));
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(port), DOTENV_CONFIG_PATH: "__no_env_for_tests__", NVIDIA_API_KEY: "", OPENROUTER_API_KEY: "", OLLAMA_DOCKER_HOST: "0", OLLAMA_BASE_URL: `http://127.0.0.1:${(mock.address() as { port: number }).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); });
  await Promise.race([once(child.stdout!, "data"), once(child, "exit").then(() => { throw new Error("Server terminato prima dell'avvio"); })]);
  const base = `http://127.0.0.1:${port}`;
  const payload = { provider: "ollama", model: "hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", conversationId: randomUUID(), messages: [{ role: "system", content: "Assistente locale" }, { role: "user", content: "SYNTHETIC_PRIVATE" }], maxTokens: 512, numCtx: 4096, brainPrivate: true };
  const post = (body: object, headers = {}) => fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const result = await post(payload);
  assert.equal(result.status, 200);
  assert.match(await result.text(), /Risposta locale[\s\S]*\[DONE\]/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, undefined);
  assert.equal(requests[0].options.num_ctx, 4096);
  for (const changes of [{ provider: "nvidia", brainPrivate: false }, { provider: "openrouter" }, { webSearch: true }, { conversationId: randomUUID(), brainPrivate: false, messages: [{ role: "user", content: "private", brainPrivate: true }], provider: "nvidia" }]) {
    assert.equal((await post({ ...payload, ...changes })).status, 403);
  }
  assert.equal((await post(payload, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post(payload, { Origin: "http://localhost:9999" })).status, 403);
  assert.equal((await post({ ...payload, messages: [{ role: "user", content: "x".repeat(10000) }] })).status, 400);
  assert.equal(requests.length, 1, "richieste rifiutate prima di qualsiasi chiamata upstream");
  const mutation = await fetch(`${base}/api/brain/index`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(mutation.status, 403);
  const controller = new AbortController();
  const running = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, messages: [{ role: "user", content: "WAIT_FOR_STOP" }] }), signal: controller.signal });
  const reader = running.body!.getReader();
  assert.ok((await reader.read()).value?.length);
  controller.abort();
  for (let i = 0; i < 50 && !cancelled; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(cancelled, true, "Stop chiude anche lo stream upstream Ollama");
});
