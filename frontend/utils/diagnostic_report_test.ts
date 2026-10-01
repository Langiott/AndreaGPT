import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../types/types";
import { diagnosticReport } from "./diagnostic_report";

test("report diagnostico: riepilogo leggibile in alto e dettagli tecnici completi in fondo", () => {
  const request: ChatMessage = { id: "u1", role: "user", content: "Cosa sono i Big Data?" };
  const metrics = { indexStatusMs: 5.637232999957632, retrievalMs: 812.3456789, load_duration: 3611516400, eval_duration: 6120000000, totalMs: 11234.56789, groundingUncitedSegments: 3, micelioSupportScore: 0.6123456, rssMb: 312.456789, chiaveSconosciuta: 7 };
  const message: ChatMessage = {
    id: "a1", role: "assistant", content: "I Big Data sono... [Cit. 1]", modelName: "MiniCPM5 2B", modelProvider: "Ollama", brainPrivate: true,
    brainSources: [{ id: "Cit. 1", source: "Big_Data_Sergy.md", text: "estratto" }], metrics,
    diagnostics: { requestId: "req-1", events: [
      { at: "2026-10-01T10:00:00.000Z", stage: "micelio", status: "warning", message: "TurboVec non pronto: ricerca ibrida con fallback JSON.", details: { enabled: true, ready: false } },
      { at: "2026-10-01T10:00:00.010Z", stage: "rag", status: "ok", message: "Retrieval RAG completato.", durationMs: 812.3456789, details: { topScore: 0.7123456 } },
    ] },
  } as ChatMessage;
  const report = diagnosticReport(message, request);
  const [summary, technical] = report.split("DETTAGLI TECNICI");

  assert.match(report.split("\n").slice(0, 5).join("\n"), /RIEPILOGO/);
  // L'avviso TurboVec e' solo informativo: l'esito resta regolare.
  assert.match(summary, /Esito: Tutto regolare/);
  assert.match(summary, /Tempo totale: 11,23 s/);
  assert.match(summary, /Caricamento modello: 3,61 s/);
  assert.match(summary, /Memoria usata dal server: 312 MB/);
  assert.match(summary, /Somiglianza tra risposta e fonti: 61%/);
  assert.doesNotMatch(summary, /\d+\.\d{3,}/, "nessun decimale grezzo prima dei dettagli tecnici");
  assert.doesNotMatch(summary, /\(ns\)|\b\d{9,}\b/, "nessun valore in nanosecondi prima dei dettagli tecnici");
  assert.doesNotMatch(summary, /chiaveSconosciuta|WARNING/);
  // Nei dettagli tecnici restano tutte le metriche grezze e gli eventi completi.
  for (const [key, value] of Object.entries(metrics)) assert.ok(technical.includes(`- ${key}: ${value}`), key);
  assert.match(technical, /Request ID: req-1/);
  assert.match(technical, /WARNING · MICELIO · TurboVec non pronto/);
  assert.match(technical, /- topScore: 0.7123456/);
  // Un errore non tra quelli noti riceve una spiegazione generica.
  const failed = { id: "a2", role: "assistant", content: "", diagnostics: { requestId: "r", events: [{ at: "x", stage: "model", status: "error", message: "boom" }] } } as ChatMessage;
  assert.match(diagnosticReport(failed), /Esito: Errore[\s\S]*copia questo report e invialo all'assistenza/);
});
