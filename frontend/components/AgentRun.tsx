import { lazy, Suspense, useState } from "react";
/**
 * Trascrizione di un run dell'Agente: piano, passi, approvazioni delle scritture, risposta finale.
 */
import { Bot, Check, ChevronDown, Circle, FilePlus, FileText, FolderTree, ListChecks, Loader2, MessageSquare, Minus, Pencil, Search, ShieldCheck, Wrench, X } from "lucide-react";
import type { AgentApproveRequest, AgentPlanStep, AgentStep } from "../types/agent";
import type { AgentApprovalView, AgentView } from "../types/types";

const MarkdownMessage = lazy(() => import("./MarkdownMessage").then(module => ({ default: module.MarkdownMessage })));

const toolIcons: Record<AgentStep["tool"], typeof Bot> = { list_dir: FolderTree, search_text: Search, read_file: FileText, run_check: ShieldCheck, edit_file: Pencil, write_file: FilePlus, update_plan: ListChecks, plan: ListChecks, answer: MessageSquare };
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${response.status}`);
}

function PlanIcon({ status }: { status: AgentPlanStep["status"] }) {
  if (status === "doing") return <Loader2 size={14} className="agent-spin" />;
  if (status === "done") return <Check size={14} />;
  if (status === "skipped") return <Minus size={14} />;
  return <Circle size={13} />;
}

function StepRow({ step, active, children }: { step: AgentStep; active: boolean; children?: React.ReactNode }) {
  const Icon = toolIcons[step.tool] ?? Wrench;
  const running = step.status === "running" && active;
  const status = running ? "running" : step.status === "running" ? "stopped" : step.status;
  const body = children ?? (step.detail ? <pre className="agent-step-detail">{step.detail}</pre> : null);
  const row = <>
    <span className="agent-step-chevron">{body ? <ChevronDown size={14} /> : null}</span>
    <span className="agent-step-label">{step.label}</span>
    <span className="agent-step-ms">{step.ms !== undefined ? seconds(step.ms) : ""}</span>
    <span className="agent-step-icon">{running ? <Loader2 size={14} className="agent-spin" /> : status === "error" ? <X size={14} /> : <Icon size={14} />}</span>
  </>;
  return body
    ? <details className={`agent-step ${status}`}><summary>{row}</summary>{body}</details>
    : <div className={`agent-step ${status}`}>{row}</div>;
}

function DiffBox({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return <pre className="agent-diff"><code>{lines.map((line, index) => {
    const kind = line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("+++") || line.startsWith("---") ? "hunk" : "ctx";
    return <span key={index} className={`agent-diff-${kind}`}>{line || " "}</span>;
  })}</code></pre>;
}

/** Righe cambiate di un diff unificato con il loro numero di riga (nuovo file per "+", vecchio per "-"). */
function changedLines(diff: string) {
  const rows: Array<{ line: number; kind: "add" | "del"; text: string }> = [];
  let oldLine = 0, newLine = 0;
  for (const line of diff.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); continue; }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) rows.push({ line: newLine++, kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ line: oldLine++, kind: "del", text: line.slice(1) });
    else { oldLine++; newLine++; }
  }
  return rows;
}

/** Righe cambiate di una modifica, con i caratteri cambiati evidenziati (es. i ":" aggiunti). */
function ChangedLines({ diff }: { diff: string }) {
  return <pre className="agent-diff agent-applied-diff"><code>{changedLines(diff).map((row, index, rows) => {
        // Coppia riga tolta/aggiunta: si evidenziano solo i caratteri cambiati (es. i ":" aggiunti).
        const other = row.kind === "add" ? rows[index - 1] : rows[index + 1];
        const pair = other && other.kind !== row.kind ? other.text : undefined;
        let start = 0, end = 0;
        if (pair !== undefined) {
          while (start < row.text.length && start < pair.length && row.text[start] === pair[start]) start++;
          while (end < row.text.length - start && end < pair.length - start && row.text[row.text.length - 1 - end] === pair[pair.length - 1 - end]) end++;
        }
        const text = row.text.trimStart(), cut = row.text.length - text.length;
        const from = Math.max(0, start - cut), to = text.length - end;
        return <span key={index} className={`agent-diff-${row.kind}`}><span className="agent-applied-line">{row.line}</span>{row.kind === "add" ? "+ " : "- "}{pair !== undefined && from < to ? <>{text.slice(0, from)}<mark>{text.slice(from, to)}</mark>{text.slice(to)}</> : text || " "}</span>;
      })}</code></pre>;
}

const TOOL_NAMES: Partial<Record<AgentStep["tool"], string>> = { list_dir: "list_dir · elenco cartella", search_text: "search_text · ricerca testo", read_file: "read_file · lettura file", run_check: "run_check · controllo", edit_file: "edit_file · modifica", write_file: "write_file · file nuovo" };

/** Pannello Logs (aperto dal pulsante accanto a Copia): tempi, strumenti usati (con quanti eseguiti in automatico dal codice) e modifiche applicate. */
function AgentLogs({ view, applied, open }: { view: AgentView; applied: number; open: boolean }) {
  const done = view.done!;
  const counts = new Map<string, { total: number; auto: number }>();
  for (const step of view.steps) {
    const name = TOOL_NAMES[step.tool];
    if (!name) continue;
    const entry = counts.get(name) ?? { total: 0, auto: 0 };
    entry.total++;
    if (/^(?:Controllo automatico|Valutazione finale)/.test(step.label)) entry.auto++;
    counts.set(name, entry);
  }
  if (!open && done.completed) return null;
  return <div className="agent-logs">
    {!done.completed && <span className="agent-logs-reason">{done.reason || "Non completato"}</span>}
    {open && <div className="agent-logs-panel">
      <p>{done.toolCalls} strumenti · {seconds(done.totalMs)} · <span className={applied ? "agent-foot-edits" : undefined}>{applied ? `${applied} ${applied === 1 ? "modifica applicata" : "modifiche applicate"}` : "nessuna modifica ai file"}</span></p>
      {view.model && <p>modello {view.model}</p>}
      {[...counts].map(([name, c]) => <p key={name}>{name} ×{c.total}{c.auto ? ` (${c.auto} automatic${c.auto === 1 ? "o" : "i"})` : ""}</p>)}
      {!counts.size && <p>nessuno strumento usato</p>}
    </div>}
  </div>;
}

function ApprovalCard({ approval, runId, active, onChange, compact }: { approval: AgentApprovalView; runId?: string; active: boolean; onChange: (patch: Partial<AgentApprovalView>) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const pending = approval.status === "pending";
  const actionable = pending && active && Boolean(runId);
  async function decide(decision: AgentApproveRequest["decision"]) {
    if (!runId) return;
    setBusy(true);
    try { await postJson("/api/agent/approve", { runId, approvalId: approval.id, decision } satisfies AgentApproveRequest); onChange({ error: undefined }); }
    catch (caught) { onChange({ error: caught instanceof Error ? caught.message : "Errore" }); setBusy(false); }
  }
  async function undo() {
    if (!approval.backupId) return;
    setBusy(true);
    try { await postJson("/api/agent/undo", { backupId: approval.backupId }); onChange({ undone: true, error: undefined }); }
    catch (caught) { onChange({ error: caught instanceof Error ? caught.message : "Errore" }); }
    finally { setBusy(false); }
  }
  const state = approval.status === "approved" ? approval.undone ? "undone" : "approved" : pending && !actionable ? "expired" : approval.status;
  return <div className={`agent-approval ${state}${compact ? " compact" : ""}`}>
    {!compact && <div className="agent-approval-head">{approval.kind === "create" ? <FilePlus size={14} /> : <Pencil size={14} />}<code>{approval.file}</code><span className="agent-badge">{approval.kind === "create" ? "Nuovo" : "Modifica"}</span></div>}
    {approval.reason && <p className="agent-approval-reason">{approval.reason}</p>}
    {compact ? <ChangedLines diff={approval.diff} /> : <DiffBox diff={approval.diff} />}
    <div className="agent-approval-actions">
      {actionable && <><button type="button" className="settings-small-button active" onClick={() => void decide("approve")} disabled={busy}><Check size={13} /> Approva</button><button type="button" className="settings-small-button" onClick={() => void decide("reject")} disabled={busy}><X size={13} /> Rifiuta</button>{busy && <Loader2 size={14} className="agent-spin" />}</>}
      {state === "approved" && <><span className="agent-state ok">Applicata</span>{approval.backupId && <button type="button" className="settings-small-button" onClick={() => void undo()} disabled={busy}>Annulla</button>}</>}
      {state === "undone" && <span className="agent-state">Annullata</span>}
      {state === "rejected" && <span className="agent-state">Rifiutata</span>}
      {state === "expired" && <span className="agent-state">Scaduta</span>}
      {approval.error && <span className="agent-state bad">{approval.error}</span>}
    </div>
  </div>;
}

export function AgentRun({ view, answer, active, logsOpen, onChange, onReply }: { view: AgentView; answer: string; active: boolean; logsOpen?: boolean; onChange: (update: (view: AgentView) => AgentView) => void; onReply?: (text: string) => void }) {
  const applied = view.approvals.filter(item => item.status === "approved" && !item.undone && !item.error).length;
  const asks = Boolean(onReply && view.done && /\?\s*$/.test(answer.trim()));
  const patchApproval = (id: string) => (patch: Partial<AgentApprovalView>) => onChange(current => ({ ...current, approvals: current.approvals.map(item => item.id === id ? { ...item, ...patch } : item) }));
  const steps = view.steps.filter(step => step.tool !== "answer" || step.detail || step.status === "error");
  return <div className="agent-run">
    {steps.length > 0 && <div className="agent-steps">{steps.map(step => {
      if (step.tool === "plan" && view.plan.length) return <StepRow key={step.id} step={{ ...step, detail: undefined }} active={active}><ol className="agent-plan">{view.plan.map(item => <li key={item.id} className={item.status}><PlanIcon status={active || item.status !== "doing" ? item.status : "todo"} /><span>{item.text}</span></li>)}</ol></StepRow>;
      // Modifica: card aperta finché aspetta la decisione, poi riga "Modifica approvata · file" con il diff nella tendina.
      const approval = view.approvals.find(item => item.stepId === step.id);
      if (!approval) return <StepRow key={step.id} step={step} active={active} />;
      const card = <ApprovalCard approval={approval} runId={view.runId} active={active} onChange={patchApproval(approval.id)} />;
      const live = approval.status === "pending" && active;
      if (live) return <div key={step.id} className="agent-step-live"><StepRow step={{ ...step, detail: undefined }} active={active} />{card}</div>;
      const outcome = approval.status === "approved" ? approval.error ? "Modifica non applicata" : approval.undone ? "Modifica annullata" : "Modifica approvata" : approval.status === "rejected" ? "Modifica rifiutata" : "Modifica scaduta";
      return <StepRow key={step.id} step={{ ...step, label: `${outcome} · ${approval.file}`, status: approval.status === "approved" && !approval.error ? "done" : step.status }} active={active}><ApprovalCard approval={approval} runId={view.runId} active={active} onChange={patchApproval(approval.id)} compact /></StepRow>;
    })}</div>}
    {active && !answer && !steps.some(step => step.status === "running") && !view.approvals.some(item => item.status === "pending") && <div className="agent-step running"><span className="agent-step-icon"><Loader2 size={14} className="agent-spin" /></span><span className="agent-step-label">{steps.length ? "Ragiono…" : "Pianifico…"}</span></div>}
    {view.approvals.filter(approval => !approval.stepId || !steps.some(step => step.id === approval.stepId)).map(approval => <ApprovalCard key={approval.id} approval={approval} runId={view.runId} active={active} onChange={patchApproval(approval.id)} />)}
    {answer && <div className="agent-answer"><Suspense fallback={<p>{answer}</p>}><MarkdownMessage content={answer} privateMode /></Suspense></div>}
    {view.error && <p className="agent-error">{view.error}</p>}
    {asks && <div className="agent-reply"><button type="button" className="settings-small-button active" onClick={() => onReply!("Sì, procedi: applica le modifiche con edit_file.")}><Check size={13} /> Sì</button><button type="button" className="settings-small-button" onClick={() => onReply!("No.")}><X size={13} /> No</button></div>}
    {view.done && <AgentLogs view={view} applied={applied} open={Boolean(logsOpen)} />}
  </div>;
}
