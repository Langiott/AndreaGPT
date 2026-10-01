import fs from "node:fs/promises";
import path from "node:path";

export type DiagnosticStatus = "ok" | "warning" | "error" | "info";

export interface DiagnosticEvent {
  at: string;
  stage: "request" | "jev" | "searchx" | "micelio" | "embedding" | "rag" | "model" | "response";
  status: DiagnosticStatus;
  message: string;
  durationMs?: number;
  details?: Record<string, string | number | boolean | null>;
}

const logDirectory = path.resolve(process.env.DIAGNOSTICS_DIR || path.join(process.cwd(), "data", "logs"));

export function createDiagnosticTrace(requestId: string, conversationId: string) {
  const events: DiagnosticEvent[] = [];
  const add = (event: Omit<DiagnosticEvent, "at">) => {
    events.push({ at: new Date().toISOString(), ...event });
  };
  const persist = async (outcome: "ok" | "error") => {
    try {
      await fs.mkdir(logDirectory, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const record = { at: new Date().toISOString(), requestId, conversationId, outcome, events };
      await fs.appendFile(path.join(logDirectory, `diagnostics-${day}.jsonl`), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.error("Impossibile salvare il log diagnostico:", error);
    }
  };
  return { requestId, events, add, persist };
}

export function assessCitations(text: string, brainSources: number, webSources: number) {
  const expected = brainSources + webSources;
  const brainCitations = new Set(text.match(/\[Cit\.\s*\d+\]/giu) ?? []);
  const webCitations = new Set(text.match(/\[(\d+)\]/g) ?? []);
  const found = brainSources ? brainCitations.size : webCitations.size;
  return {
    expected,
    found,
    grounded: expected === 0 ? null : found > 0,
    status: expected === 0 ? "info" as const : found > 0 ? "ok" as const : "warning" as const,
  };
}
