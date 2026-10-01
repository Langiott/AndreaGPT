import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const label = process.argv[2];
if (!/^[a-z0-9-]+$/.test(label || "")) throw new Error("Indicare etichetta: before / after");
const base = process.env.BENCHMARK_URL || "http://127.0.0.1:3000";
const questions = [
  "Cos’è una Rete di Petri in Automazione e a cosa serve?",
  "Quali esempi vengono descritti nel progetto PIPE sulle reti di Petri?",
  "Chi è Zzzqqq?",
];
const results: object[] = [];
await fs.mkdir("OUTPUT/Benchmark", { recursive: true });
for (const model of ["qwen2.5-coder:7b", "openbmb/minicpm5-2b:latest"]) {
  for (const question of questions) {
    const start = performance.now();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "ollama", model, brain: true, brainPrivate: true,
        conversationId: randomUUID(), numCtx: 4096, maxTokens: 512, temperature: 0.2,
        messages: [{ role: "system", content: "Rispondi in italiano in modo preciso e completo." }, { role: "user", content: question }] }),
      signal: AbortSignal.timeout(300_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body}`);
    const events = body.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const result = { model, question, wallMs: Math.round(performance.now() - start),
      answer: events.map(e => e.choices?.[0]?.delta?.content || "").join(""),
      metrics: events.find(e => e.metrics)?.metrics,
      sources: events.find(e => e.brainSources)?.brainSources,
      diagnostics: [...events].reverse().find(e => e.diagnostics)?.diagnostics };
    results.push(result);
    await fs.writeFile(`OUTPUT/Benchmark/${label}.json`, JSON.stringify({ label, at: new Date().toISOString(), results }, null, 2));
    console.log(JSON.stringify({ model, question, wallMs: result.wallMs, metrics: result.metrics, answer: result.answer }));
  }
}
