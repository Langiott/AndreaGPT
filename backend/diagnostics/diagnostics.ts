/**
 * Crea il registro della richiesta e controlla citazioni e lingua della risposta.
 * Serve a capire cosa è successo durante una chat.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type DiagnosticStatus = "ok" | "warning" | "error" | "info";

export interface DiagnosticEvent {
  at: string;
  stage: "request" | "router" | "searchx" | "semantic" | "embedding" | "rag" | "model" | "response";
  status: DiagnosticStatus;
  message: string;
  durationMs?: number;
  details?: Record<string, string | number | boolean | null>;
}

export interface DiagnosticSummary {
  durationMs?: number;
  timings?: Record<string, number>;
  /** Metriche numeriche non temporali (grounding, reranker, token): servono a misurare i miglioramenti dai log. */
  metrics?: Record<string, number>;
  sources?: Array<{ type: "brain" | "web"; label: string; url?: string }>;
}

const logDirectory = path.resolve(process.env.DIAGNOSTICS_DIR || path.join(process.cwd(), "data", "logs"));

/** Crea un registro vuoto dove aggiungere gli eventi della richiesta. Spento: non registra e non scrive su disco. */
export function createDiagnosticTrace(requestId: string, conversationId: string, enabled = true) {
  const events: DiagnosticEvent[] = [];
  let summary: DiagnosticSummary = {};
  const add = (event: Omit<DiagnosticEvent, "at">) => {
    if (enabled) events.push({ at: new Date().toISOString(), ...event });
  };
  const setSummary = (value: DiagnosticSummary) => {
    summary = { ...summary, ...value };
  };
  const persist = async (outcome: "ok" | "error") => {
    if (!enabled) return;
    try {
      await fs.mkdir(logDirectory, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const record = { at: new Date().toISOString(), requestId, conversationId, outcome, events, summary };
      await fs.appendFile(path.join(logDirectory, `diagnostics-${day}.jsonl`), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.error("Impossibile salvare il log diagnostico:", error);
    }
  };
  return { requestId, events, add, setSummary, persist };
}

/** Controlla quante citazioni sono valide e quante sono mancanti. */
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

/** Controlla se la risposta contiene caratteri non adatti alla lingua scelta. */
export function assessOutputLanguage(text: string) {
  const matches = text.match(CJK_PATTERN) ?? [];
  return {
    hasCjk: matches.length > 0,
    cjkCharacters: matches.length,
    sample: [...new Set(matches)].slice(0, 12).join(""),
  };
}
