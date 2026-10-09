/**
 * Smoke test end-to-end dell'Agente sull'app già avviata (Docker, 127.0.0.1:3000) con Ollama reale.
 * Ripristina i file fake/, chiede all'agente di trovare e correggere i bug, approva ogni modifica,
 * poi valuta i file finali con la chiave scripts/test/agent_fake_key.json.
 * Uso: npx tsx scripts/test/smoke_agent.ts [--model qwen3:14b] [--base http://127.0.0.1:3000]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AgentCheckName, AgentEvent } from "../../frontend/types/agent";
import { AgentWorkspace } from "../../backend/agent/agent_workspace";
import { runCheck } from "../../backend/agent/agent_checks";

const radice = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const base = arg("base", "http://127.0.0.1:3000");
const model = arg("model", "qwen3:14b");
const domanda = arg("domanda", "Trova e correggi gli errori nei file della cartella fake. Verifica ogni correzione.");
const json = { "Content-Type": "application/json" };
type Voce = { file: string; line: number; kind: string; description: string; fix: string };
const chiave = JSON.parse(readFileSync(join(radice, "scripts", "test", "agent_fake_key.json"), "utf8")) as Voce[];

// 1. Ripristino dei file con i bug.
execFileSync(process.execPath, ["--import", "tsx", join(radice, "scripts", "test", "agent_fake_reset.ts")], { cwd: radice, stdio: "ignore" });
const originali = new Map(chiave.map(v => [v.file, readFileSync(join(radice, v.file), "utf8")]));

// 2. Configurazione.
const put = await fetch(`${base}/api/agent/config`, { method: "PUT", headers: json, body: JSON.stringify({ model, writable: ["fake"] }) });
if (!put.ok) throw new Error(`Config HTTP ${put.status}: ${await put.text()}`);

// 3. Esecuzione con approvazione automatica.
const inizio = Date.now();
const eventi: Array<{ t: number; event: AgentEvent }> = [];
const errori: string[] = [];
let runId = "", fine: Extract<AgentEvent, { type: "done" }> | undefined, risposta = "";
const sec = () => `${((Date.now() - inizio) / 1000).toFixed(0).padStart(4)}s`;
const risposta_ = await fetch(`${base}/api/agent/run`, {
  method: "POST", headers: json, signal: AbortSignal.timeout(25 * 60_000),
  body: JSON.stringify({ conversationId: randomUUID(), messages: [{ role: "user", content: domanda }], numCtx: 8192, maxTokens: 1024 }),
});
if (!risposta_.ok || !risposta_.body) throw new Error(`Run HTTP ${risposta_.status}: ${await risposta_.text()}`);
const decoder = new TextDecoder();
let buffer = "", chiuso = false;
for await (const chunk of risposta_.body as unknown as AsyncIterable<Uint8Array>) {
  buffer += decoder.decode(chunk, { stream: true });
  let sep: number;
  while ((sep = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, sep); buffer = buffer.slice(sep + 2);
    if (!frame.startsWith("data: ")) { errori.push(`frame SSE inatteso: ${frame.slice(0, 80)}`); continue; }
    const data = frame.slice(6);
    if (data === "[DONE]") { chiuso = true; continue; }
    let event: AgentEvent;
    try { event = JSON.parse(data); } catch { errori.push(`JSON SSE non valido: ${data.slice(0, 80)}`); continue; }
    eventi.push({ t: Date.now() - inizio, event });
    switch (event.type) {
      case "start": runId = event.runId; console.log(`${sec()} avvio ${event.model} scrivibili=${event.writable.join(",")}`); break;
      case "plan": console.log(`${sec()} piano:\n${event.steps.map(s => `        ${s.id}. ${s.text}`).join("\n")}`); break;
      case "plan_update": console.log(`${sec()} passo ${event.stepId} -> ${event.status}`); break;
      case "step": if (event.step.status !== "running") console.log(`${sec()} [${event.step.status}] ${event.step.label} (${event.step.ms} ms)${event.step.status === "error" ? ` :: ${event.step.detail?.slice(0, 160)}` : ""}`); break;
      case "approval": {
        const righe = event.approval.diff.split("\n").filter(r => /^[-+]/.test(r)).slice(0, 6);
        console.log(`${sec()} APPROVAZIONE ${event.approval.file} (${event.approval.reason.slice(0, 100)})\n${righe.map(r => `        ${r.slice(0, 120)}`).join("\n")}`);
        const r = await fetch(`${base}/api/agent/approve`, { method: "POST", headers: json, body: JSON.stringify({ runId, approvalId: event.approval.id, decision: "approve" }) });
        if (!r.ok) errori.push(`approve HTTP ${r.status}: ${await r.text()}`);
        break;
      }
      case "approval_result": console.log(`${sec()} esito approvazione: ${event.status}${event.backupId ? ` backup ${event.backupId}` : ""}${event.error ? ` ERRORE ${event.error}` : ""}`); break;
      case "answer": risposta = event.content; console.log(`${sec()} REPORT:\n${event.content.split("\n").map(r => `        ${r}`).join("\n")}`); break;
      case "done": fine = event; console.log(`${sec()} fine completed=${event.completed}${event.reason ? ` (${event.reason})` : ""} strumenti=${event.toolCalls}`); break;
      case "error": errori.push(`evento error: ${event.message}`); console.log(`${sec()} ERRORE ${event.message}`); break;
    }
  }
}
if (!chiuso) errori.push("stream chiuso senza [DONE]");
if (!fine) errori.push("nessun evento done");

// 4. Valutazione sui file finali.
const workspace = new AgentWorkspace(radice, { toolsRoot: join(radice, "runtime", "agent-smoke"), writable: [] });
const testo = (file: string) => readFileSync(join(radice, file), "utf8");
const riga = (file: string, n: number) => testo(file).replace(/\r\n/g, "\n").split("\n")[n - 1] ?? "";
async function controllo(check: AgentCheckName, file: string) {
  const r = await runCheck(workspace, check, file);
  if (r.output !== "Python non disponibile sul server.") return r;
  const d = spawnSync("docker", ["exec", "andreagpt", "python3", "-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", `/workspace/${file}`], { encoding: "utf8" });
  return { ok: d.status === 0, output: `${d.stderr}${d.stdout}` };
}
function esegui(file: string) {
  const comando = file.endsWith(".py") ? ["python", ["-I", join(radice, file)]] as const
    : file.endsWith(".ts") ? [process.execPath, ["--import", "tsx", join(radice, file)]] as const : [process.execPath, [join(radice, file)]] as const;
  const r = spawnSync(comando[0], [...comando[1]], { cwd: radice, encoding: "utf8", timeout: 20_000 });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const out3 = esegui("fake/fake_error_3.py"), out5 = esegui("fake/fake_error_5.ts");
const totale5 = out5.output.match(/Totale da pagare: ([\d.]+)/)?.[1];
const corretto: Record<string, () => Promise<boolean>> = {
  "fake/fake_error_1.py:18": async () => (await controllo("python_syntax", "fake/fake_error_1.py")).ok && /SOGLIA_RIORDINO\s*:/.test(testo("fake/fake_error_1.py")),
  "fake/fake_error_2.ts:37": async () => (await controllo("typescript", "fake/fake_error_2.ts")).ok && /nome: "Bianchi", ral: 35000\b/.test(testo("fake/fake_error_2.ts")),
  // Logica: esecuzione reale (Anna 7+8+9+6 = 30) più controllo dell'espressione.
  "fake/fake_error_3.py:18": async () => /Anna: totale 30\b/.test(out3.output) || (/range\(len\(voti\)\)|sum\(voti\)/.test(testo("fake/fake_error_3.py")) && !/len\(voti\)\s*-\s*1/.test(testo("fake/fake_error_3.py"))),
  "fake/fake_error_3.py:44": async () => !/\{medie\}/.test(testo("fake/fake_error_3.py")) && !/NameError/.test(out3.output) && (await controllo("python_syntax", "fake/fake_error_3.py")).ok,
  "fake/fake_error_4.js:44": async () => (await controllo("javascript_syntax", "fake/fake_error_4.js")).ok && esegui("fake/fake_error_4.js").ok,
  // Carrello 120: 113 = entrambi corretti, 108 = solo sconto, 125 = solo await, 120 = nessuno.
  "fake/fake_error_5.ts:21": async () => totale5 === "113.00" || totale5 === "108.00" || /importo\s*>=\s*SOGLIA_SCONTO/.test(testo("fake/fake_error_5.ts")),
  "fake/fake_error_5.ts:35": async () => totale5 === "113.00" || totale5 === "125.00" || /await\s+costoSpedizione/.test(testo("fake/fake_error_5.ts")),
};
const approvazioni = eventi.flatMap(e => e.event.type === "approval" ? [e.event.approval] : []);
const esiti = new Map(eventi.flatMap(e => e.event.type === "approval_result" ? [[e.event.id, e.event.status] as const] : []));
const tabella = [];
for (const voce of chiave) {
  const buggata = originali.get(voce.file)!.replace(/\r\n/g, "\n").split("\n")[voce.line - 1].trim();
  const nome = voce.file.split("/").pop()!;
  // Trovato: una proposta toglie la riga con il bug, oppure il report cita file e riga (±1).
  const proposto = approvazioni.some(a => a.file === voce.file && a.diff.split("\n").some(r => r.startsWith("-") && r.slice(1).trim() === buggata));
  const citato = [...risposta.matchAll(new RegExp(`${nome.replace(/\./g, "\\.")}\\D{0,12}(\\d+)`, "g"))].some(m => Math.abs(Number(m[1]) - voce.line) <= 1);
  const fixed = await corretto[`${voce.file}:${voce.line}`]().catch(() => false);
  tabella.push({ bug: `${voce.file}:${voce.line}`, tipo: voce.kind, trovato: proposto || citato || fixed ? "sì" : "no", corretto: fixed ? "sì" : "no", "riga finale": riga(voce.file, voce.line).trim().slice(0, 60) });
}
console.log("\nRisultato benchmark");
console.table(tabella);
const passi = eventi.flatMap(e => e.event.type === "step" && e.event.step.status !== "running" ? [e.event.step] : []);
console.log(`Trovati ${tabella.filter(r => r.trovato === "sì").length}/${chiave.length}, corretti ${tabella.filter(r => r.corretto === "sì").length}/${chiave.length}`);
console.log(`Strumenti ${fine?.toolCalls ?? "?"} (errori ${passi.filter(s => s.status === "error").length}), approvazioni ${approvazioni.length} (applicate ${[...esiti.values()].filter(s => s === "approved").length}), durata ${((Date.now() - inizio) / 1000).toFixed(0)} s, completato ${fine?.completed ?? false}${fine?.reason ? ` (${fine.reason})` : ""}`);
console.log(`Uscita fake_error_3.py: ${out3.output.trim().split("\n").slice(0, 2).join(" | ").slice(0, 160)}`);
console.log(`Uscita fake_error_5.ts: ${out5.output.trim().slice(0, 160)}`);
if (errori.length) console.log(`Errori:\n${errori.map(e => `  - ${e}`).join("\n")}`);

// 5. Log completo.
const cartellaLog = join(radice, "runtime", "logs");
mkdirSync(cartellaLog, { recursive: true });
const fileLog = join(cartellaLog, `agent-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(fileLog, JSON.stringify({ model, domanda, eventi, tabella, errori, durataMs: Date.now() - inizio }, null, 2));
console.log(`Log: ${fileLog}`);
