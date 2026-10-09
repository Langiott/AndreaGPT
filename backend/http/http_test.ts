/** Verifica gli endpoint HTTP, lo streaming e i controlli di accesso. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { localOllamaUrl } from "../utils/local";

test("Ollama rifiuta host remoti, credenziali e redirect via URL", () => {
  for (const url of ["https://example.com", "http://user:pass@localhost", "http://localhost/api", "http://localhost?token=x"]) assert.throws(() => localOllamaUrl(url));
  assert.equal(localOllamaUrl("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
});

test("HTTP: streaming locale, limiti, origini e cronologia Brain bloccata al cloud/web", { timeout: 30000 }, async t => {
  const requests: Record<string, any>[] = [];
  let cancelled = false;
  const mock = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    if (req.url?.startsWith("/search")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ results: [{ title: "Latest technical AI research benchmark", url: "https://example.test/paper", content: "technical AI research method benchmark results", publishedDate: "2026-09-23" }] }));
      return;
    }
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
  const child = spawn(process.execPath, ["--import", "tsx", "backend/index.ts"], {
    env: { ...process.env, PORT: String(port), DOTENV_CONFIG_PATH: "__no_env_for_tests__", NVIDIA_API_KEY: "", OPENROUTER_API_KEY: "", PERPLEXITY_API_KEY: "", FIRECRAWL_API_KEY: "", OLLAMA_DOCKER_HOST: "0", OLLAMA_BASE_URL: `http://127.0.0.1:${(mock.address() as { port: number }).port}`, SEARXNG_URL: `http://127.0.0.1:${(mock.address() as { port: number }).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); });
  await Promise.race([once(child.stdout!, "data"), once(child, "exit").then(() => { throw new Error("Server terminato prima dell'avvio"); })]);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/api/research`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ type: "x" }) })).status, 403, "News deve rifiutare origini estranee");
  assert.equal((await fetch(`${base}/api/research`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ type: "x" }) })).status, 415, "News deve accettare solo JSON");
  const catalog = await fetch(`${base}/api/models`).then((response) => response.json()) as { models: Array<{ id: string }> };
  assert.deepEqual(catalog.models.map((model) => model.id), [
    "openbmb/minicpm5-2b:latest",
    "qwen3:14b",
    "qwen3-coder:30b-a3b-q4_K_M",
    "z-ai/glm-5.2",
    "google/gemma-4-31b-it:free",
    "minimaxai/minimax-m3",
  ]);
  const newsResponse = await fetch(`${base}/api/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "ai" }) });
  assert.equal(newsResponse.status, 200, "News deve ricevere e validare il corpo JSON");
  const news = await newsResponse.json() as { article?: string; sources?: unknown[] };
  assert.ok(news.article);
  assert.doesNotMatch(news.article!, /utente ha richiesto|non ho ricevuto|testo completo delle fonti/i);
  assert.match(news.article!, /^##\s/m);
  assert.equal(news.sources?.length, 1);
  requests.length = 0;
  const payload = { provider: "ollama", model: "openbmb/minicpm5-2b:latest", conversationId: randomUUID(), messages: [{ role: "system", content: "Assistente locale" }, { role: "user", content: "SYNTHETIC_PRIVATE" }], maxTokens: 512, numCtx: 4096, brainPrivate: true };
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
  const qwenResult = await post({ ...payload, model: "qwen3:14b", numCtx: 8192 });
  assert.equal(qwenResult.status, 200);
  await qwenResult.text();
  assert.equal(requests.at(-1)!.model, "qwen3:14b", "il server inoltra Qwen 14B senza sostituirlo con MiniCPM");
  assert.equal(requests.at(-1)!.options.num_ctx, 8192);
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
