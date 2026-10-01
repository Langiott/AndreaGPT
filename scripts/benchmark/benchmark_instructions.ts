import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const base = process.env.BENCHMARK_URL || "http://127.0.0.1:3000";
const model = process.env.BENCHMARK_MODEL || "openbmb/minicpm5-2b:latest";
const instructions = `Istruzioni personalizzate attive:
- Generali: Rispondi in italiano. Sii chiaro, concreto e accurato. Niente parolacce o frasi volgari non richieste.
- Codice: Produci codice completo, sicuro e leggibile. Spiega le decisioni importanti. Includi test e comandi quando servono.`;
const questions = [
  { level: "1 · semplice", question: "Spiega in 4 righe perché il cielo appare blu." },
  { level: "2 · pratico", question: "Scrivi una funzione TypeScript che rimuove i duplicati da un array di numeri e indica la complessità." },
  { level: "3 · analitico", question: "Confronta REST e GraphQL per una piccola app mobile: dammi vantaggi, svantaggi e una raccomandazione motivata." },
  { level: "4 · ragionamento", question: "Un processo passa da 120 ms a 150 ms e le richieste al secondo calano da 800 a 640. Calcola le variazioni percentuali e interpreta il risultato." },
  { level: "5 · complesso", question: "Progetta un piano concreto per diagnosticare un'app locale che completa un job GPU ma non mostra il risultato in chat. Includi ipotesi, controlli, log da raccogliere e criterio di successo." },
];

async function ask(question: string, system: string) {
  const started = performance.now(); let firstToken: number | undefined; let buffer = ""; let answer = "";
  const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model, conversationId: randomUUID(), brain: false, brainPrivate: false, numCtx: 4096, maxTokens: 512, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: question }] }), signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) if (line.startsWith("data: {")) { const event = JSON.parse(line.slice(6)); const text = event.choices?.[0]?.delta?.content ?? ""; if (text && firstToken === undefined) firstToken = performance.now() - started; answer += text; }
    if (done) break;
  }
  return { answer, firstTokenMs: Math.round(firstToken ?? performance.now() - started), totalMs: Math.round(performance.now() - started) };
}

const results = [];
for (const item of questions) {
  const without = await ask(item.question, "Rispondi in italiano in modo utile e preciso.");
  const withInstructions = await ask(item.question, instructions);
  results.push({ ...item, without, withInstructions });
  console.log(JSON.stringify({ level: item.level, without: without.totalMs, withInstructions: withInstructions.totalMs }));
}
await fs.mkdir("OUTPUT/Benchmark", { recursive: true });
await fs.writeFile("OUTPUT/Benchmark/instructions-ab.json", JSON.stringify({ model, generatedAt: new Date().toISOString(), results }, null, 2));
