import fs from "node:fs/promises";
import path from "node:path";

export type DiagnosticStatus = "ok" | "warning" | "error" | "info";

export interface DiagnosticEvent {
  at: string;
  stage: "request" | "router" | "searchx" | "micelio" | "embedding" | "rag" | "model" | "response";
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

export function assessCitations(text: string, brainSources: number, webSources: number, sourceIds?: string[]) {
  const expected = brainSources + webSources;
  const brainCitations = new Set(text.match(/\[Cit\.\s*\d+\]/giu) ?? []);
  const webCitations = new Set(text.match(/\[(\d+)\]/g) ?? []);
  const allowed = new Set(sourceIds ?? Array.from({ length: brainSources }, (_, i) => `Cit. ${i + 1}`));
  const validBrain = [...brainCitations].filter(marker => allowed.has(marker.slice(1, -1).replace(/\s+/g, " ")));
  const validWeb = [...webCitations].filter(marker => Number(marker.slice(1, -1)) >= 1 && Number(marker.slice(1, -1)) <= webSources);
  const found = brainSources ? validBrain.length : validWeb.length;
  const invalid = brainSources ? brainCitations.size - found : webCitations.size - found;
  return {
    expected,
    found,
    invalid,
    // Marker validation does not establish semantic support for the answer.
    grounded: null,
    status: expected === 0 ? "info" as const : found > 0 && invalid === 0 ? "ok" as const : "warning" as const,
  };
}

const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu;

export function assessOutputLanguage(text: string) {
  const matches = text.match(CJK_PATTERN) ?? [];
  return {
    hasCjk: matches.length > 0,
    cjkCharacters: matches.length,
    sample: [...new Set(matches)].slice(0, 12).join(""),
  };
}
