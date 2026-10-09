import type { AgentEvent } from "../types/agent";
import type { AgentView } from "../types/types";

/** Applica un evento SSE dell'agente alla trascrizione salvata nel messaggio. Puro: restituisce un nuovo oggetto. */
export function foldAgentEvent(view: AgentView, answer: string, event: AgentEvent): { view: AgentView; answer: string } {
  switch (event.type) {
    case "start": return { view: { ...view, runId: event.runId, model: event.model, writable: event.writable }, answer };
    case "plan": return { view: { ...view, plan: event.steps }, answer };
    case "plan_update": return { view: { ...view, plan: view.plan.map((step) => step.id === event.stepId ? { ...step, status: event.status } : step) }, answer };
    case "step": {
      const exists = view.steps.some((step) => step.id === event.step.id);
      return { view: { ...view, steps: exists ? view.steps.map((step) => step.id === event.step.id ? { ...step, ...event.step } : step) : [...view.steps, event.step] }, answer };
    }
    case "approval": return { view: { ...view, approvals: [...view.approvals.filter((item) => item.id !== event.approval.id), event.approval] }, answer };
    case "approval_result": return { view: { ...view, approvals: view.approvals.map((item) => item.id === event.id ? { ...item, status: event.status, backupId: event.backupId ?? item.backupId, error: event.error } : item) }, answer };
    case "answer": return { view, answer: event.content };
    case "done": return { view: { ...view, done: { completed: event.completed, reason: event.reason, toolCalls: event.toolCalls, totalMs: event.totalMs } }, answer };
    case "error": return { view: { ...view, error: event.message }, answer };
    default: return { view, answer };
  }
}

/** Run chiuso senza "done" (stop, rete, ricarica): le approvazioni aperte non sono più azionabili. */
export function closeAgentView(view: AgentView, reason: string, startedAt: number): AgentView {
  return {
    ...view,
    approvals: view.approvals.map((item) => item.status === "pending" ? { ...item, status: "expired" } : item),
    steps: view.steps.map((step) => step.status === "running" ? { ...step, status: "error", detail: step.detail ?? reason } : step),
    done: view.done ?? { completed: false, reason, toolCalls: view.steps.filter((step) => step.tool !== "plan" && step.tool !== "answer").length, totalMs: Date.now() - startedAt },
  };
}
