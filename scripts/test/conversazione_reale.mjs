// Conversazione reale con un modello Ollama sulla chat principale (/api/chat): azioni + domande vere.
// Stampa le risposte per giudicarne l'utilità. Uso: node scripts/test/conversazione_reale.mjs [porta] [modello] [file-turni.json]
import fs from "node:fs";
const base = `http://localhost:${process.argv[2] || 3000}`;
const model = process.argv[3] || "qwen3:8b";
const turns = process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], "utf8")) : ["ciao, chi sei?"];
const conversationId = crypto.randomUUID();
const history = [];
for (const text of turns) {
  history.push({ role: "user", content: text });
  const started = performance.now();
  const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "ollama", conversationId, model, maxTokens: 1024, messages: history }) });
  const body = await response.text();
  const action = body.includes('"officeAction":true');
  const content = [...body.matchAll(/^data: (\{.*\})$/gm)].map(match => { try { return JSON.parse(match[1])?.choices?.[0]?.delta?.content ?? ""; } catch { return ""; } }).join("") || body.slice(0, 300);
  console.log(`\n### «${text}» — ${action ? "AZIONE" : "CHAT"} · HTTP ${response.status} · ${((performance.now() - started) / 1000).toFixed(1)}s\n${content.trim().slice(0, 1400)}`);
  history.push({ role: "assistant", content: content || "-" });
}
