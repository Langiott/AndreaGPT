import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

// Local-only, bounded benchmark. No document passages are printed.
const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const start = performance.now();
const child = spawn(process.execPath, ["--import", "tsx", "backend/index.ts"], {
  env: { ...process.env, PORT: String(port), DOTENV_CONFIG_PATH: "__benchmark_no_env__", NVIDIA_API_KEY: "", OPENROUTER_API_KEY: "", OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_DOCKER_HOST: "0" },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
const watchdog = setTimeout(() => child.kill(), 180_000);
try {
  await Promise.race([once(child.stdout!, "data"), once(child, "exit").then(() => { throw new Error("Server terminato"); })]);
  console.log(JSON.stringify({ serverStartMs: Math.round(performance.now() - start) }));
  for (const question of process.argv.slice(2).length ? process.argv.slice(2) : ["Chi è Nova?"]) {
    const began = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "ollama", model: "qwen2.5-coder:7b", conversationId: randomUUID(), brain: true, numCtx: 4096, maxTokens: 256, temperature: 0,
        messages: [{ role: "system", content: "Rispondi in italiano, in massimo tre frasi." }, { role: "user", content: question }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const events = (await response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const answer = events.map(event => event.choices?.[0]?.delta?.content ?? "").join("");
    console.log(JSON.stringify({ question, totalMs: Math.round(performance.now() - began), sources: events.find(event => event.brainSources)?.brainSources?.map((s: { source: string }) => s.source), metrics: events.find(event => event.metrics)?.metrics, answer }));
  }
} finally { clearTimeout(watchdog); child.kill(); }
