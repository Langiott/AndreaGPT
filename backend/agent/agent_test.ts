/** Verifica regole dei percorsi, diff, backup/annullamento, controlli fissi e ciclo dell'Agente con modello simulato. */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { AgentEvent } from "../../frontend/types/agent";
import { AgentWorkspace, unifiedDiff } from "./agent_workspace";
import { loadAgentConfig, saveAgentConfig, validateWritable } from "./agent_config";
import { runCheck } from "./agent_checks";
import { runAgent, textToolCalls, type AgentChat, type AgentDecision } from "./agent_runner";

async function setup(t: { after(fn: () => unknown): void }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "andreagpt-agent-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "root"), toolsRoot = path.join(base, "tools");
  await fs.mkdir(path.join(root, "fake"), { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, ".env"), "SECRET=1");
  await fs.writeFile(path.join(root, "src", "main.ts"), "export const x = 1;\n");
  await fs.writeFile(path.join(root, "fake", "calc.py"), "def divide(a, b):\n    return a / b\n\nprint(divide(1, 0))\n");
  return { root, toolsRoot, workspace: new AgentWorkspace(root, { toolsRoot, writable: ["fake"] }) };
}

test("percorsi vietati: .env, .., node_modules, assoluti, segreti, collegamenti", async t => {
  const { root, workspace } = await setup(t);
  for (const bad of [".env", "../x", "fake/../.env", "node_modules/a.js", "/etc/passwd", "C:/Windows/win.ini", "fake//calc.py", "src/token_x.ts", "src/key.pem", "data/x.txt", ".git/config"])
    await assert.rejects(workspace.readFile(bad), Error, bad);
  assert.equal((await workspace.readFile("fake/calc.py")).totalLines, 4);
  assert.equal((await workspace.readFile("./fake/calc.py", 2, 2)).text, "2:     return a / b");
  let linked = false;
  try { await fs.symlink(path.join(root, "src"), path.join(root, "link"), process.platform === "win32" ? "junction" : "dir"); linked = true; } catch { /* collegamenti non creabili */ }
  if (linked) await assert.rejects(workspace.readFile("link/main.ts"), /simbolici/);
  const listing = await workspace.listDir(".", 2);
  assert.ok(!listing.tree.includes(".env") && listing.tree.includes("calc.py") && !listing.tree.includes("link"));
  const search = await workspace.searchText("divide");
  assert.equal(search.hits[0].file, "fake/calc.py");
  assert.equal(search.hits[0].definition, true);
  assert.ok(!(await workspace.searchText("SECRET")).hits.length, ".env escluso dalla ricerca");
});

test("configurazione: valida e salva le cartelle scrivibili", async t => {
  const { toolsRoot } = await setup(t);
  assert.deepEqual(await loadAgentConfig(toolsRoot), { model: "qwen3:14b", writable: ["fake"] });
  assert.deepEqual(validateWritable(["fake", "fake/", "a\\b"]), ["fake", "a/b"]);
  for (const bad of [["../x"], ["/abs"], ["C:/x"], [".git"], ["node_modules"], [""], Array.from({ length: 21 }, (_, i) => `d${i}`)]) assert.throws(() => validateWritable(bad));
  assert.deepEqual((await saveAgentConfig(toolsRoot, { writable: ["fake", "tmp/out"] })).writable, ["fake", "tmp/out"]);
  assert.deepEqual((await loadAgentConfig(toolsRoot)).writable, ["fake", "tmp/out"]);
});

test("scritture: fuori da writable rifiutate, old_text unico, diff, backup e annullamento", async t => {
  const { root, workspace } = await setup(t);
  await assert.rejects(workspace.prepareEdit("src/main.ts", "1", "2"), /non consentita/);
  await assert.rejects(workspace.prepareCreate("src/new.ts", "x"), /non consentita/);
  await assert.rejects(workspace.prepareEdit("fake/calc.py", "divide", "div"), /2 volte/);
  await assert.rejects(workspace.prepareEdit("fake/calc.py", "assente", "x"), /non trovato/);
  const file = path.join(root, "fake", "calc.py");
  const original = await fs.readFile(file, "utf8");
  const edit = await workspace.prepareEdit("fake/calc.py", "    return a / b", "    if b == 0:\n        return None\n    return a / b");
  assert.equal(edit.diff, "@@ -1,4 +1,6 @@\n def divide(a, b):\n+    if b == 0:\n+        return None\n     return a / b\n \n print(divide(1, 0))");
  assert.equal(await fs.readFile(file, "utf8"), original, "nessuna scrittura prima di apply");
  const { backupId } = await edit.apply();
  assert.match(await fs.readFile(file, "utf8"), /if b == 0/);
  const meta = JSON.parse(await fs.readFile(path.join(workspace.backupsRoot, backupId, "meta.json"), "utf8"));
  assert.equal(meta.file, "fake/calc.py");
  assert.equal(meta.kind, "edit");
  assert.deepEqual(await workspace.undo(backupId), { file: "fake/calc.py" });
  assert.equal(await fs.readFile(file, "utf8"), original);
  await assert.rejects(workspace.undo(backupId), /già annullata/);
  // Annullamento rifiutato se il file è cambiato dopo la scrittura.
  const second = await (await workspace.prepareEdit("fake/calc.py", "print(divide(1, 0))", "print(divide(4, 2))")).apply();
  await fs.writeFile(file, "cambiato a mano\n");
  await assert.rejects(workspace.undo(second.backupId), /cambiato/);
  // Creazione e annullamento.
  const create = await workspace.prepareCreate("fake/nuova/x.py", "a = 1\nb = 2\n");
  assert.equal(create.diff, "@@ -0,0 +1,2 @@\n+a = 1\n+b = 2");
  const created = await create.apply();
  assert.equal(await fs.readFile(path.join(root, "fake", "nuova", "x.py"), "utf8"), "a = 1\nb = 2\n");
  await assert.rejects(workspace.prepareCreate("fake/nuova/x.py", "y"), /esiste già/);
  await workspace.undo(created.backupId);
  await assert.rejects(fs.stat(path.join(root, "fake", "nuova")), "file e cartella creata rimossi");
});

test("diff unificato con più blocchi e contesto di 3 righe", () => {
  const before = Array.from({ length: 20 }, (_, i) => `r${i + 1}`).join("\n");
  const after = before.replace("r2", "R2").replace("r18", "R18");
  assert.equal(unifiedDiff(before, after), "@@ -1,5 +1,5 @@\n r1\n-r2\n+R2\n r3\n r4\n r5\n@@ -15,6 +15,6 @@\n r15\n r16\n r17\n-r18\n+R18\n r19\n r20");
});

const hasPython = (() => { for (const cmd of [process.env.AGENT_PYTHON || "python3", "python"]) { try { execFileSync(cmd, ["--version"], { stdio: "ignore" }); return true; } catch { /* prossimo */ } } return false; })();
test("controllo sintassi Python", { skip: !hasPython && "Python non disponibile" }, async t => {
  const { root, workspace } = await setup(t);
  assert.equal((await runCheck(workspace, "python_syntax", "fake/calc.py")).ok, true);
  await fs.writeFile(path.join(root, "fake", "rotto.py"), "def f(:\n  pass\n");
  const result = await runCheck(workspace, "python_syntax", "fake/rotto.py");
  assert.equal(result.ok, false);
  assert.match(result.output, /^fake\/rotto\.py:1:7 SyntaxError: /);
  assert.ok(!result.output.includes(root), "percorso assoluto nascosto");
});

test("controlli TypeScript e JavaScript", async t => {
  const { root, workspace } = await setup(t);
  await fs.writeFile(path.join(root, "fake", "a.ts"), "const n: number = \"testo\";\nexport { n };\n");
  const ts = await runCheck(workspace, "typescript", "fake/a.ts");
  assert.equal(ts.ok, false);
  assert.match(ts.output, /^fake\/a\.ts:1:7 TS2322 /);
  assert.equal((await runCheck(workspace, "typescript", "src/main.ts")).ok, true);
  await fs.writeFile(path.join(root, "fake", "b.js"), "function (\n");
  assert.equal((await runCheck(workspace, "javascript_syntax", "fake/b.js")).ok, false);
  await assert.rejects(runCheck(workspace, "typescript", ".env"));
});

/** Modello simulato: risponde con una sequenza fissa di messaggi. */
function scripted(replies: Array<{ content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }>) {
  const seen: unknown[][] = [];
  const chat: AgentChat = async messages => { seen.push(structuredClone(messages)); const next = replies.shift(); if (!next) throw new Error("Chiamata inattesa"); return { message: next }; };
  return { chat, seen };
}
const call = (name: string, args: Record<string, unknown>) => ({ function: { name, arguments: args } });

async function runScripted(t: { after(fn: () => unknown): void }, decision: AgentDecision) {
  const { root, workspace } = await setup(t);
  const edit = call("edit_file", { file: "fake/calc.py", old_text: "    return a / b", new_text: "    return a / b if b else None", reason: "Evita la divisione per zero" });
  const { chat, seen } = scripted([
    { content: "{\"steps\":[\"Leggi fake/calc.py\",\"Correggi divide\"]}" },
    { content: "", tool_calls: [call("update_plan", { stepId: 1, status: "doing" }), call("read_file", { file: "fake/calc.py", startLine: 1, endLine: 10 }), call("run_check", { check: "python_syntax", file: "fake/calc.py" })] },
    { content: "", tool_calls: [call("strumento_finto", {}), edit, call("update_plan", { stepId: 1, status: "done" }), call("update_plan", { stepId: "2", status: "done" })] },
    ...(decision === "reject" ? [{ content: "", tool_calls: [edit] }] : []),
    { content: "fake/calc.py:2 divisione per zero: corretta." },
  ]);
  const events: AgentEvent[] = [];
  await runAgent({ runId: "run-1", question: "Correggi la divisione per zero", config: { model: "mock", writable: ["fake"] }, workspace, chat,
    emit: event => events.push(event), waitApproval: async () => decision, signal: new AbortController().signal });
  return { root, events, seen };
}
const summary = (events: AgentEvent[]) => events.map(e => e.type === "step" ? `step:${e.step.tool}:${e.step.status}` : e.type === "approval_result" ? `approval_result:${e.status}` : e.type);

test("agente: legge, propone, attende approvazione, applica e risponde", async t => {
  const { root, events, seen } = await runScripted(t, "approve");
  assert.deepEqual(summary(events), ["start", "step:plan:running", "plan", "step:plan:done", "plan_update", "step:read_file:running", "step:read_file:done",
    "step:run_check:running", "step:run_check:done", "step:edit_file:running", "approval", "approval_result:approved", "step:run_check:running", "step:run_check:done", "step:edit_file:done", "plan_update", "plan_update", "step:answer:done", "answer", "done"]);
  const report = events.find(e => e.type === "answer");
  assert.ok(report?.type === "answer" && report.content === "Ho trovato un errore in calc.py e ho applicato una modifica (riga 2). Valutazione finale: il controllo ora passa.", report?.type === "answer" ? report.content : "");
  const approval = events.find(e => e.type === "approval");
  assert.ok(approval?.type === "approval" && approval.approval.diff.includes("+    return a / b if b else None") && approval.approval.status === "pending");
  const result = events.find(e => e.type === "approval_result");
  assert.ok(result?.type === "approval_result" && /^\d{13}-[0-9a-f]{8}$/.test(result.backupId ?? ""));
  assert.match(await fs.readFile(path.join(root, "fake", "calc.py"), "utf8"), /if b else None/);
  const read = events.find(e => e.type === "step" && e.step.tool === "read_file");
  assert.ok(read?.type === "step" && read.step.label === "Leggo fake/calc.py (1-10)");
  const done = events.at(-1);
  assert.ok(done?.type === "done" && done.completed && done.toolCalls === 7);
  assert.match(JSON.stringify(seen.at(-1)), /Strumento sconosciuto: strumento_finto/);
});

test("agente: report con passi aperti sollecitato una volta, poi accettato", async t => {
  const { workspace } = await setup(t);
  const { chat, seen } = scripted([
    { content: "{\"steps\":[\"Leggi fake/calc.py\",\"Correggi divide\"]}" },
    { content: "Ho corretto tutto." },
    { content: "", tool_calls: [call("read_file", { file: "fake/calc.py" })] },
    { content: "Fatto, davvero." },
    { content: "Report finale." },
  ]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "x", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "reject", signal: new AbortController().signal });
  assert.match(JSON.stringify(seen[2]), /Passi del piano non completati/);
  const answers = events.flatMap(e => e.type === "answer" ? [e.content] : []);
  assert.deepEqual(answers, ["Report finale."], "secondo sollecito dopo uno strumento, poi stop");
  // Senza strumenti dopo il sollecito non si sollecita di nuovo.
  const second = scripted([{ content: "{\"steps\":[\"Elenca fake\"]}" }, { content: "Risposta." }, { content: "Risposta definitiva." }]);
  const events2: AgentEvent[] = [];
  await runAgent({ question: "x", config: { model: "mock", writable: ["fake"] }, workspace, chat: second.chat, emit: e => events2.push(e), waitApproval: async () => "reject", signal: new AbortController().signal });
  assert.deepEqual(events2.flatMap(e => e.type === "answer" ? [e.content] : []), ["Risposta definitiva."]);
});

test("agente: old_text con i numeri di riga di read_file", async t => {
  const { root, workspace } = await setup(t);
  const { chat } = scripted([
    { content: "{\"steps\":[\"Correggi\"]}" },
    { content: "", tool_calls: [call("run_check", { check: "python_syntax", file: "fake/calc.py" }), call("edit_file", { file: "fake/calc.py", old_text: "1: def divide(a, b):\n2:     return a / b", new_text: "1: def divide(a, b):\n2:     return a / b if b else None", reason: "x" }), call("update_plan", { stepId: 1, status: "done" })] },
    { content: "ok" },
  ]);
  await runAgent({ question: "x", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: () => undefined, waitApproval: async () => "approve", signal: new AbortController().signal });
  assert.equal(await fs.readFile(path.join(root, "fake", "calc.py"), "utf8"), "def divide(a, b):\n    return a / b if b else None\n\nprint(divide(1, 0))\n");
});

test("agente: modifica rifiutata non applicata e non riproposta", async t => {
  const { root, events, seen } = await runScripted(t, "reject");
  assert.deepEqual(summary(events).filter(s => s.startsWith("approval")), ["approval", "approval_result:rejected"]);
  assert.doesNotMatch(await fs.readFile(path.join(root, "fake", "calc.py"), "utf8"), /if b else None/);
  assert.match(JSON.stringify(seen.at(-2)), /rifiutato la modifica/);
  assert.match(JSON.stringify(seen.at(-1)), /già stata rifiutata/);
  assert.equal(events.at(-1)?.type, "done");
});

test("agente: limite di turni e interruzione", async t => {
  const { workspace } = await setup(t);
  const loop: AgentChat = async (_m, options) => options.tools ? { message: { content: "", tool_calls: [call("list_dir", { dir: "fake" })] } } : { message: { content: "non json" } };
  const events: AgentEvent[] = [];
  await runAgent({ question: "x", config: { model: "mock", writable: ["fake"] }, workspace, chat: loop, emit: e => events.push(e), waitApproval: async () => "reject", signal: new AbortController().signal, limits: { turns: 3 } });
  const plan = events.find(e => e.type === "plan");
  assert.ok(plan?.type === "plan" && plan.steps.length === 1, "piano di riserva");
  const done = events.at(-1);
  assert.ok(done?.type === "done" && !done.completed && /3 turni/.test(done.reason ?? ""));
  const aborted: AgentEvent[] = [];
  await runAgent({ question: "x", config: { model: "mock", writable: ["fake"] }, workspace, chat: loop, emit: e => aborted.push(e), waitApproval: async () => "reject", signal: AbortSignal.abort() });
  assert.ok(aborted.at(-1)?.type === "done");
});

test("agente: richiesta di correzione con file letto ma non controllato → controllo automatico e report dai fatti", async t => {
  const { workspace, root } = await setup(t);
  await fs.writeFile(path.join(root, "fake", "rotto.py"), "def f(:\n    return 1\n");
  const { chat, seen } = scripted([{ content: "{\"steps\":[\"Leggi rotto.py\"]}" }, { content: "", tool_calls: [call("read_file", { file: "fake/rotto.py" })] }, { content: "1. C'è un errore." }, { content: "Ho trovato un errore." }, { content: "Ho corretto." }, { content: "Ho corretto." }]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "Correggi gli errori nel file rotto", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "approve", signal: new AbortController().signal });
  assert.ok(events.some(e => e.type === "step" && e.step.label.startsWith("Controllo automatico") && e.step.status === "error"));
  assert.match(JSON.stringify(seen.at(-1)), /Controllo automatico eseguito/);
  const answer = events.find(e => e.type === "answer");
  assert.ok(answer?.type === "answer" && answer.content === "Ho trovato errori di sintassi in rotto.py, nessuna modifica applicata.", answer?.type === "answer" ? answer.content : "");
});

test("agente: file nominato nella domanda letto e controllato prima del modello", async t => {
  const { workspace, root } = await setup(t);
  await fs.writeFile(path.join(root, "fake", "rotto.py"), "def f(:\n    return 1\n");
  const { chat, seen } = scripted([{ content: "{\"steps\":[\"Analizza\"]}" }, { content: "Il file contiene un errore." }, { content: "Ho corretto." }, { content: "Ho corretto." }]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "Analizza rotto.py e risolvi gli errori", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "reject", signal: new AbortController().signal });
  const labels = events.flatMap(e => e.type === "step" ? [`${e.step.label}:${e.step.status}`] : []);
  assert.ok(labels.includes("Leggo fake/rotto.py (1-200):done") && labels.includes("Controllo sintassi Python di fake/rotto.py:done"), labels.join(" | "));
  assert.match(JSON.stringify(seen[1]), /Contenuto di fake\/rotto.py/);
  const answer = events.find(e => e.type === "answer");
  assert.ok(answer?.type === "answer" && answer.content === "Ho trovato errori di sintassi in rotto.py, nessuna modifica applicata.", answer?.type === "answer" ? answer.content : "");
});

test("agente: edit_file per numero di riga, indentazione mantenuta, sollecito con la riga dell'errore", async t => {
  const { workspace, root } = await setup(t);
  await fs.writeFile(path.join(root, "fake", "rotto.py"), "def f():\n    if True\n        return 1\n");
  const { chat, seen } = scripted([
    { content: "{\"steps\":[\"Correggi\"]}" },
    { content: "Ho corretto il file." },
    { content: "", tool_calls: [call("edit_file", { file: "fake/rotto.py", line: 2, new_text: "if True:", reason: "manca :" })] },
    { content: "Fatto." },
  ]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "Correggi rotto.py", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "approve", signal: new AbortController().signal });
  assert.match(JSON.stringify(seen[2]), /line 2/);
  assert.equal(await fs.readFile(path.join(root, "fake", "rotto.py"), "utf8"), "def f():\n    if True:\n        return 1\n");
  const answer = events.find(e => e.type === "answer");
  assert.ok(answer?.type === "answer" && answer.content === "Ho trovato errori di sintassi in rotto.py e ho applicato una modifica (riga 2). Valutazione finale: il controllo ora passa.", answer?.type === "answer" ? answer.content : "");
});

test("agente: modifica di un file di codice rifiutata senza run_check prima", async t => {
  const { workspace, root } = await setup(t);
  const { chat } = scripted([{ content: "{\"steps\":[\"Correggi calc.py\"]}" }, { content: "", tool_calls: [call("edit_file", { file: "fake/calc.py", old_text: "return a / b", new_text: "return a / b if b else 0", reason: "x" })] }, { content: "Fatto." }]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "Correggi la divisione", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "approve", signal: new AbortController().signal });
  assert.ok(!events.some(e => e.type === "approval"));
  const step = [...events].reverse().find(e => e.type === "step" && e.step.tool === "edit_file");
  assert.ok(step?.type === "step" && step.step.status === "error" && /run_check python_syntax/.test(step.step.detail ?? ""));
  assert.doesNotMatch(await fs.readFile(path.join(root, "fake", "calc.py"), "utf8"), /if b else 0/);
});

test("agente: nome di file senza cartella risolto nella cartella scrivibile", async t => {
  const { workspace, root } = await setup(t);
  const { chat } = scripted([{ content: "{\"steps\":[\"Correggi calc.py\"]}" }, { content: "", tool_calls: [call("run_check", { check: "python_syntax", file: "calc.py" }), call("edit_file", { file: "calc.py", old_text: "return a / b", new_text: "return a / b if b else 0", reason: "divisione per zero" })] }, { content: "Corretto fake/calc.py:2." }]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "Correggi calc.py", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "approve", signal: new AbortController().signal });
  const approval = events.find(e => e.type === "approval");
  assert.ok(approval?.type === "approval" && approval.approval.file === "fake/calc.py");
  assert.match(await fs.readFile(path.join(root, "fake", "calc.py"), "utf8"), /if b else 0/);
});

test("agente: pseudo-chiamate, annunci senza azione e piano scritto come codice", async t => {
  assert.deepEqual(textToolCalls("update_plan:doing 1\n\nProcedo a controllare il file fake_error_1.py."), [call("update_plan", { stepId: 1, status: "doing" })]);
  assert.deepEqual(textToolCalls("list_dir('fake')"), [call("list_dir", { dir: "fake" })]);
  assert.deepEqual(textToolCalls("read_file(\"fake/a.py\", 1, 40)"), [call("read_file", { file: "fake/a.py", startLine: 1, endLine: 40 })]);
  assert.deepEqual(textToolCalls("Ho usato list_dir('fake') e trovato calc.py."), []);
  const { workspace } = await setup(t);
  // Il modello annuncia due volte senza agire: il report mostra l'ultimo risultato concreto.
  const { chat } = scripted([{ content: "{\"steps\":[\"list_dir('fake')\"]}" }, { content: "list_dir('fake')" }, { content: "update_plan:doing 1\n\nProcedo a controllare il file." }, { content: "Procedo." }, { content: "Procedo." }, { content: "Procedo." }, { content: "Procedo." }]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "Elenca i file in fake", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "reject", signal: new AbortController().signal });
  const plan = events.find(e => e.type === "plan");
  assert.ok(plan?.type === "plan" && plan.steps[0].text === "Elenca fake");
  const answer = events.find(e => e.type === "answer");
  assert.ok(answer?.type === "answer" && answer.content.includes("calc.py"), answer?.type === "answer" ? answer.content : "");
  assert.ok(events.some(e => e.type === "plan_update" && e.status === "done"));
});

test("agente: chiamate scritte come JSON nel testo (modelli senza tool_calls nativi)", async t => {
  assert.deepEqual(textToolCalls("{\"name\": \"list_dir\", \"arguments\": {\"dir\": \"fake\"}}"), [call("list_dir", { dir: "fake" })]);
  assert.deepEqual(textToolCalls("<tool_call>\n{\"name\":\"read_file\",\"arguments\":{\"file\":\"fake/a.py\"}}\n</tool_call>").map(c => c.function.name), ["read_file"]);
  assert.equal(textToolCalls("```json\n{\"name\":\"list_dir\",\"parameters\":{\"dir\":\"fake\"}}\n{\"name\":\"read_file\",\"arguments\":{\"file\":\"fake/a.py\"}}\n```").length, 2);
  assert.deepEqual(textToolCalls("Verifico:\n```json\n{\"name\":\"run_check\",\"arguments\":{\"check\":\"python_syntax\",\"file\":\"fake/a.py\"}}\n```\nPoi continuo.").map(c => c.function.name), ["run_check"]);
  assert.equal(textToolCalls("<tool_response>\n{\"name\": \"update_plan\", \"arguments\": {\"status\":\"doing\",\"stepId\":1}}\n{\"name\": \"search_text\", \"arguments\": {\"dir\":\"fake\",\"query\":\"def\"}}\n</tool_response>").length, 2);
  assert.deepEqual(textToolCalls("Passo 4 completato. Aggiorno il passo 3. {\"name\": \"update_plan\", \"arguments\": {\"stepId\":3,\"status\":\"done\"}}"), [call("update_plan", { stepId: 3, status: "done" })]);
  for (const text of ["Ho corretto fake/a.py:3.", "Esempio:\n```json\n{\"a\":1}\n```","{\"name\":\"rm_rf\",\"arguments\":{}}", "{\"steps\":[\"x\"]}", "{\"name\":\"list_dir\",\"arguments\":{}} e poi altro"]) assert.deepEqual(textToolCalls(text), [], text);
  const { workspace } = await setup(t);
  const { chat } = scripted([{ content: "{\"steps\":[\"Elenca fake\"]}" }, { content: "Elenco la cartella:\n```json\n{\"name\": \"list_dir\", \"arguments\": {\"dir\": \"fake\"}}\n```" }, { content: "{\"name\": \"update_plan\", \"arguments\": {\"stepId\": 1, \"status\": \"done\"}}" }, { content: "In fake c'è calc.py." }]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "Elenca fake", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "reject", signal: new AbortController().signal });
  assert.deepEqual(summary(events).filter(s => s.startsWith("step:list_dir") || s === "answer"), ["step:list_dir:running", "step:list_dir:done", "answer"]);
  const answer = events.find(e => e.type === "answer");
  assert.ok(answer?.type === "answer" && /^1 elemento in fake:\n\n- calc\.py/.test(answer.content), answer?.type === "answer" ? answer.content : "");
  // Chiamata troncata: si chiede di ripeterla.
  const cut = scripted([{ content: "{\"steps\":[\"Elenca fake\"]}" }, { content: "<tool" }, { content: "", tool_calls: [call("update_plan", { stepId: 1, status: "done" })] }, { content: "Fine." }]);
  const cutEvents: AgentEvent[] = [];
  await runAgent({ question: "x", config: { model: "mock", writable: ["fake"] }, workspace, chat: cut.chat, emit: e => cutEvents.push(e), waitApproval: async () => "reject", signal: new AbortController().signal });
  assert.match(JSON.stringify(cut.seen[2]), /incompleta o non valida/);
  assert.deepEqual(cutEvents.flatMap(e => e.type === "answer" ? [e.content] : []), ["Fine."]);
  // Eco di un risultato invece del report.
  const echo = scripted([{ content: "{\"steps\":[\"Elenca fake\"]}" }, { content: "<tool_response>\nok\n</tool_response>" }]);
  const echoed: AgentEvent[] = [];
  await runAgent({ question: "x", config: { model: "mock", writable: ["fake"] }, workspace, chat: echo.chat, emit: e => echoed.push(e), waitApproval: async () => "reject", signal: new AbortController().signal, limits: { turns: 1 } });
  assert.ok(echoed.some(e => e.type === "answer" && e.content === "Il modello non ha prodotto un report."));
});

test("agente: scrittura fuori da writable e lettura di .env rifiutate senza card di approvazione", async t => {
  const { root, workspace } = await setup(t);
  const { chat, seen } = scripted([
    { content: "{\"steps\":[\"Modifica src/main.ts\"]}" },
    { content: "", tool_calls: [call("edit_file", { file: "src/main.ts", old_text: "export const x = 1;", new_text: "export const x = 2;", reason: "prova" }), call("write_file", { file: "src/nuovo.ts", content: "x", reason: "prova" }), call("read_file", { file: ".env" })] },
    { content: "Non posso." },
  ]);
  const events: AgentEvent[] = [];
  await runAgent({ question: "x", config: { model: "mock", writable: ["fake"] }, workspace, chat, emit: e => events.push(e), waitApproval: async () => "approve", signal: new AbortController().signal });
  assert.ok(!events.some(e => e.type === "approval"), "nessuna card");
  assert.deepEqual(summary(events).filter(s => s.startsWith("step:") && !s.startsWith("step:plan")), ["step:edit_file:running", "step:edit_file:error", "step:write_file:running", "step:write_file:error", "step:read_file:running", "step:read_file:error"]);
  assert.equal(await fs.readFile(path.join(root, "src", "main.ts"), "utf8"), "export const x = 1;\n");
  await assert.rejects(fs.stat(path.join(root, "src", "nuovo.ts")));
  const results = JSON.stringify(seen.at(-1));
  assert.match(results, /Scrittura non consentita in src\/main\.ts/);
  assert.doesNotMatch(results, /SECRET=1/);
});
