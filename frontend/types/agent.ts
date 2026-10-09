/**
 * Contratto tra backend e frontend per l'Agente (chat dedicata, modalità "agent").
 * Il backend trasmette AgentEvent come Server-Sent Events: una riga `data: <json>` per evento.
 */

/** Strumenti che il modello può chiamare. Le scritture passano sempre dall'approvazione. */
export type AgentToolName = "list_dir" | "search_text" | "read_file" | "run_check" | "edit_file" | "write_file" | "update_plan";

/** Controlli fissi eseguibili dall'agente: nessun comando libero. */
export type AgentCheckName = "python_syntax" | "typescript" | "javascript_syntax";

export interface AgentConfig {
  /** Modello Ollama usato dall'agente (default qwen3:14b). */
  model: string;
  /** Cartelle relative alla radice del progetto in cui l'agente può scrivere, previa approvazione. */
  writable: string[];
}

export interface AgentPlanStep { id: number; text: string; status: "todo" | "doing" | "done" | "skipped" }

export interface AgentApproval {
  id: string;
  file: string;
  /** "edit" = sostituzione in un file esistente, "create" = file nuovo. */
  kind: "edit" | "create";
  /** Diff unificato (righe che iniziano con "+", "-", " ", "@@"). */
  diff: string;
  /** Motivo dichiarato dal modello. */
  reason: string;
  status: "pending" | "approved" | "rejected" | "expired";
  /** Passo (edit_file/write_file) che ha generato la richiesta: la card si mostra in quel punto della timeline. */
  stepId?: string;
  /** Id del backup creato prima della scrittura (solo dopo approvazione). */
  backupId?: string;
}

export interface AgentStep {
  id: string;
  tool: AgentToolName | "plan" | "answer";
  /** Frase breve e puntuale, es. "Leggo fake/fake_error_2.py righe 1-40". */
  label: string;
  status: "running" | "done" | "error";
  /** Dettaglio opzionale mostrato a tendina chiusa (estratto del risultato o errore). */
  detail?: string;
  ms?: number;
}

export type AgentEvent =
  | { type: "start"; runId: string; model: string; writable: string[] }
  | { type: "plan"; steps: AgentPlanStep[] }
  | { type: "plan_update"; stepId: number; status: AgentPlanStep["status"] }
  | { type: "step"; step: AgentStep }
  | { type: "approval"; approval: AgentApproval }
  | { type: "approval_result"; id: string; status: AgentApproval["status"]; backupId?: string; error?: string }
  | { type: "answer"; content: string }
  | { type: "done"; completed: boolean; reason?: string; toolCalls: number; totalMs: number }
  | { type: "error"; message: string };

/** Corpo di POST /api/agent/run (risposta: text/event-stream di AgentEvent). */
export interface AgentRunRequest {
  conversationId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  numCtx?: number;
  maxTokens?: number;
}

/** Corpo di POST /api/agent/approve. */
export interface AgentApproveRequest { runId: string; approvalId: string; decision: "approve" | "reject" }

/** Stato salvato nel messaggio assistente della chat Agente. */
export interface AgentTranscript {
  runId?: string;
  model?: string;
  plan: AgentPlanStep[];
  steps: AgentStep[];
  approvals: AgentApproval[];
  done?: { completed: boolean; reason?: string; toolCalls: number; totalMs: number };
  error?: string;
}
