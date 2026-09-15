import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

// Explicit opt-in runtime check: real local index and Ollama, no cloud keys or .env.
const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: { ...process.env, PORT: String(port), DOTENV_CONFIG_PATH: "__no_env_for_smoke__", NVIDIA_API_KEY: "", OPENROUTER_API_KEY: "", OLLAMA_DOCKER_HOST: "0", OLLAMA_BASE_URL: "http://127.0.0.1:11434" },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  await Promise.race([once(child.stdout!, "data"), once(child, "exit").then(() => { throw new Error("Server non avviato"); })]);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base)).status, 200);
  const status = await (await fetch(`${base}/api/brain/status`)).json();
  assert.ok(status.chunks > 0, "Indicizzare Brain prima dello smoke test");
  const response = await fetch(`${base}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "ollama", model: "hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M", conversationId: randomUUID(), brain: true, numCtx: 4096, maxTokens: 512, messages: [{ role: "system", content: "Rispondi in italiano, massimo una frase breve." }, { role: "user", content: "Chi e Nova? Rispondi in massimo 15 parole usando gli estratti." }] }),
    signal: AbortSignal.timeout(900_000),
  });
  assert.equal(response.status, 200, `Chat HTTP ${response.status}`);
  const stream = await response.text();
  assert.match(stream, /\[DONE\]/);
  const events = stream.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  const sources = events.find(event => event.brainSources)?.brainSources;
  assert.ok(sources?.length > 0, "Fonti recuperate realmente incluse nel contesto");
  const text = events.map(event => event.choices?.[0]?.delta?.content ?? "").join("");
  assert.ok(text.trim());
  // Never print private passages or the generated answer into logs.
  console.log(JSON.stringify({ ok: true, files: status.files, chunks: status.chunks, sources: sources.length, responseCharacters: text.length, streamDone: true }));
} finally {
  child.kill();
}
