import type { ChatMessage, DiagnosticEvent } from "../types/types";

// Report diagnostico copiabile: in alto un RIEPILOGO in italiano semplice,
// in fondo i DETTAGLI TECNICI completi (valori grezzi) per chi fa assistenza.

// Etichette italiane delle metriche emesse da backend/index.ts e dal modo in cui mostrarle.
type MetricKind = "ms" | "ns" | "mb" | "percent" | "count" | "yesno" | "route";
const METRIC_LABELS: Record<string, [string, MetricKind]> = {
  totalMs: ["Tempo totale", "ms"],
  firstTokenMs: ["Attesa prima parola della risposta", "ms"],
  routerLatencyMs: ["Scelta del percorso (router)", "ms"],
  routerRoute: ["Percorso scelto dal router", "route"],
  routerConfidence: ["Sicurezza del router", "percent"],
  indexStatusMs: ["Controllo indice Brain", "ms"],
  retrievalMs: ["Ricerca fonti nel Brain", "ms"],
  rerankMs: ["Riordino fonti (cross-encoder)", "ms"],
  retrievalCandidates: ["Estratti esaminati", "count"],
  sqliteBackend: ["Archivio SQLite in uso", "yesno"],
  sources: ["Fonti usate nella risposta", "count"],
  directBrainAnswer: ["Risposta presa direttamente dalle fonti", "yesno"],
  evidenceCharsBefore: ["Caratteri delle fonti trovate", "count"],
  evidenceCharsAfter: ["Caratteri delle fonti dopo il taglio", "count"],
  evidenceSourcesRetrieved: ["Estratti trovati", "count"],
  evidenceSourcesDelivered: ["Estratti inviati al modello", "count"],
  evidenceSourcesOmitted: ["Estratti non inviati (limite di lunghezza)", "count"],
  evidenceSourcesOverBudget: ["Estratti oltre il limite di lunghezza", "count"],
  evidenceCharsDelivered: ["Caratteri inviati al modello", "count"],
  evidenceFormulaSpansRetrieved: ["Formule negli estratti trovati", "count"],
  evidenceFormulaSpansDelivered: ["Formule negli estratti inviati", "count"],
  estimatedPromptTokens: ["Lunghezza stimata della domanda al modello (token)", "count"],
  historyMessages: ["Messaggi precedenti inclusi", "count"],
  promptBuildMs: ["Preparazione della domanda", "ms"],
  load_duration: ["Caricamento modello", "ns"],
  prompt_eval_count: ["Token letti dal modello", "count"],
  prompt_eval_duration: ["Lettura della domanda", "ns"],
  eval_count: ["Token generati", "count"],
  eval_duration: ["Scrittura della risposta", "ns"],
  groundingMs: ["Controllo citazioni", "ms"],
  groundingSegments: ["Frasi controllate", "count"],
  groundingCitedSegments: ["Frasi con citazione", "count"],
  groundingUncitedSegments: ["Frasi senza citazione", "count"],
  groundingInvalidCitations: ["Citazioni non valide", "count"],
  groundingNumericGaps: ["Numeri non trovati nelle fonti", "count"],
  groundingUnsupportedSegments: ["Frasi citate senza riscontro nella fonte", "count"],
  groundedness: ["Groundedness (frasi sostenute dalle fonti)", "percent"],
  faithfulness: ["Faithfulness (citazioni con riscontro)", "percent"],
  citationCoverage: ["Copertura delle citazioni", "percent"],
  groundingFormulaAbsenceWarnings: ["Formule dichiarate assenti per errore", "count"],
  semanticSupportScore: ["Somiglianza tra risposta e fonti", "percent"],
  cpuUserMs: ["Lavoro del processore (utente)", "ms"],
  cpuSystemMs: ["Lavoro del processore (sistema)", "ms"],
  rssMb: ["Memoria usata dal server", "mb"],
  codeToolCalls: ["Strumenti di codice usati", "count"],
};

// Spiegazioni semplici per gli avvisi noti: [testo che riconosce il messaggio, spiegazione, serve un'azione?].
const KNOWN_WARNINGS: [RegExp, string, boolean][] = [
  [/^TurboVec non pronto/, "La ricerca veloce non era ancora pronta (l'indice si sta preparando): è stata usata la ricerca di riserva, che funziona. Nessuna azione necessaria.", false],
  [/^Fonti effettivamente inviate/, "Alcuni estratti trovati non sono stati inviati al modello per restare nel limite di lunghezza. È normale. Nessuna azione necessaria.", false],
  [/^Controllo semantico non disponibile/, "Il controllo di somiglianza tra risposta e fonti non è stato eseguito. La risposta c'è, ma è stata verificata meno. Nessuna azione necessaria.", false],
  [/^SearXNG/, "La ricerca web principale non ha funzionato ed è stata usata quella di riserva. Nessuna azione necessaria.", false],
  [/^Groundedness|^Risposta con avvisi di grounding/, "Alcune frasi citate non trovano riscontro nella fonte citata, oppure contengono numeri o citazioni non presenti nelle fonti. Cosa fare: controlla quelle frasi confrontandole con le fonti.", true],
  [/^La risposta dichiara formule assenti/, "La risposta dice che non ci sono formule, ma nelle fonti ci sono. Cosa fare: non fidarti di quella parte e controlla le fonti.", true],
  [/^Retrieval RAG completato/, "Le fonti trovate somigliano poco alla domanda: la risposta potrebbe essere imprecisa. Cosa fare: prova a riformulare la domanda.", true],
  [/^RAG non ha trovato|nessuna evidenza RAG/, "Nel Brain non c'è nulla di pertinente alla domanda. Cosa fare: verifica che il documento giusto sia nel Brain oppure riformula la domanda.", true],
  [/^Indice Brain vuoto/, "Il Brain non contiene documenti pronti. Cosa fare: aggiungi o reindicizza i documenti del Brain.", true],
  [/^Similarita semantica debole/, "La risposta somiglia poco alle fonti. Cosa fare: verificala con attenzione prima di usarla.", true],
  [/caratteri CJK/, "La risposta contiene caratteri asiatici: il modello ha cambiato lingua. Cosa fare: riprova o scegli un altro modello.", true],
  [/cita riferimenti non disponibili/, "La risposta cita fonti che non esistono. Cosa fare: controlla le citazioni prima di usare la risposta.", true],
  [/non cita le fonti disponibili/, "La risposta non indica da quali fonti prende le informazioni. Cosa fare: verificala confrontandola con le fonti.", true],
];

// Numeri con la virgola italiana, senza decimali inutili.
const decimal = (value: number, digits: number) => (Math.round(value * 10 ** digits) / 10 ** digits).toFixed(digits).replace(".", ",");

// Tempi: sotto il secondo in ms interi, altrimenti in secondi con due decimali (es. "3,61 s").
function formatMs(value: number) {
  return value < 1000 ? `${Math.round(value)} ms` : `${decimal(value / 1000, 2)} s`;
}

function formatMetric(value: number, kind: MetricKind) {
  if (kind === "ms") return formatMs(value);
  if (kind === "ns") return formatMs(value / 1_000_000);
  if (kind === "mb") return `${Math.round(value)} MB`;
  if (kind === "percent") return `${Math.round(value * 100)}%`;
  if (kind === "yesno") return value ? "sì" : "no";
  if (kind === "route") return value === 1 ? "Brain" : value === 2 ? "Web" : "risposta diretta";
  return Number.isInteger(value) ? String(value) : decimal(value, 2);
}

// Spiegazione dell'avviso o errore: testo noto, altrimenti un testo generico.
function explain(event: DiagnosticEvent): [string, boolean] {
  const known = KNOWN_WARNINGS.find(([pattern]) => pattern.test(event.message));
  if (known) return [known[1], known[2]];
  return event.status === "error"
    ? ["Si è verificato un errore tecnico. Cosa fare: riprova; se si ripete, copia questo report e invialo all'assistenza.", true]
    : ["Avviso tecnico non classificato. Se la risposta sembra sbagliata, copia questo report e invialo all'assistenza.", true];
}

export function diagnosticReport(message: ChatMessage, request?: ChatMessage): string {
  if (!message.diagnostics) return "";
  const events = message.diagnostics.events;
  const failures = events.filter(event => event.status === "warning" || event.status === "error");
  const statusCounts = events.reduce<Record<string, number>>((counts, event) => ({ ...counts, [event.status]: (counts[event.status] ?? 0) + 1 }), {});

  // Avvisi spiegati, senza ripetere due volte la stessa spiegazione.
  const explanations = new Map<string, boolean>();
  for (const event of failures) {
    const [text, action] = explain(event);
    explanations.set(text, action);
  }
  const toCheck = [...explanations.values()].filter(Boolean).length;
  const notesOnly = explanations.size - toCheck;
  const outcome = statusCounts.error ? "Errore: qualcosa non ha funzionato (vedi sotto)"
    : toCheck ? `${toCheck} ${toCheck === 1 ? "avviso" : "avvisi"} da guardare`
    : `Tutto regolare${notesOnly ? ` (${notesOnly} ${notesOnly === 1 ? "nota informativa" : "note informative"}, nessuna azione necessaria)` : ""}`;
  const notes = [...explanations].map(([text, action]) => `  • ${action ? "[Da controllare]" : "[Solo informativo]"} ${text}`).join("\n");
  const totalMs = message.metrics?.totalMs;

  const metricEntries = Object.entries(message.metrics ?? {});
  const readableMetrics = metricEntries.filter(([key, value]) => METRIC_LABELS[key] && typeof value === "number")
    .map(([key, value]) => `- ${METRIC_LABELS[key][0]}: ${formatMetric(value, METRIC_LABELS[key][1])}`).join("\n") || "- Nessuna metrica disponibile";
  const rawMetrics = metricEntries.map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- Nessuna metrica disponibile";
  const brainSources = message.brainSources?.length ? message.brainSources.map((source, index) => `- [${source.id || index + 1}] ${source.source}\n  Estratto: ${source.text}`).join("\n") : "- Nessuna fonte Brain";
  const webSources = message.webSources?.length ? message.webSources.map(source => `- [${source.source}] ${source.title}\n  URL: ${source.url}\n  Estratto: ${source.excerpt}`).join("\n") : "- Nessuna fonte Web";
  const attachments = request?.attachments?.length ? request.attachments.map(attachment => `- ${attachment.name} · ${attachment.type || attachment.kind} · ${attachment.size} byte`).join("\n") : "- Nessun allegato";
  const rawEvents = events.map(event => {
    const details = event.details ? `\n${Object.entries(event.details).map(([key, value]) => `  - ${key}: ${value ?? "—"}`).join("\n")}` : "";
    return `[${event.at}] ${event.status.toUpperCase()} · ${event.stage.toUpperCase()} · ${event.message}${event.durationMs !== undefined ? ` · ${event.durationMs} ms` : ""}${details}`;
  }).join("\n\n");
  return `REPORT DIAGNOSTICO ANDREAGPT

RIEPILOGO
- Esito: ${outcome}
- Tempo totale: ${typeof totalMs === "number" ? formatMs(totalMs) : "—"}
- Modello: ${message.modelName ?? message.modelId ?? "—"}${message.modelProvider ? ` (${message.modelProvider})` : ""}
- Fonti usate: ${message.brainSources?.length ?? 0} dal Brain, ${message.webSources?.length ?? 0} dal Web
- Avvisi:${notes ? `\n${notes}` : " nessuno"}

CONFIGURAZIONE
- Modello: ${message.modelName ?? "—"}
- ID modello: ${message.modelId ?? "—"}
- Provider: ${message.modelProvider ?? "—"}
- Brain: ${message.brainPrivate || Boolean(message.brainSources?.length) ? "attivo" : "non richiesto"}
- Web: ${message.webSearch || Boolean(message.webSources?.length) ? "attivo" : "non richiesto"}

RICHIESTA UTENTE
${request?.content || "—"}

ALLEGATI
${attachments}

RISPOSTA ASSOCIATA
${message.content || "—"}

DIMENSIONI
- Richiesta: ${request?.content.length ?? 0} caratteri (circa ${Math.ceil((request?.content.length ?? 0) / 4)} token)
- Risposta: ${message.content.length} caratteri (circa ${Math.ceil(message.content.length / 4)} token)

TEMPI E NUMERI
${readableMetrics}

FONTI BRAIN
${brainSources}

FONTI WEB
${webSources}

DETTAGLI TECNICI (per l'assistenza)
Request ID: ${message.diagnostics.requestId}
Data richiesta: ${events[0]?.at ?? "—"}
Eventi: ${events.length} totali · ${statusCounts.ok ?? 0} ok · ${statusCounts.info ?? 0} info · ${statusCounts.warning ?? 0} warning · ${statusCounts.error ?? 0} error

METRICHE GREZZE
${rawMetrics}

EVENTI DIAGNOSTICI
${rawEvents || "—"}`;
}
