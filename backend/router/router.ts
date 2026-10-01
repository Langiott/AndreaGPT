/**
 * Decide il percorso locale della richiesta: chat normale, Brain o Web.
 * Usa solo segnali testuali e non chiama servizi esterni.
 */
export type LocalRoute = "normal" | "brain" | "web";

export interface LocalRouteDecision {
  route: LocalRoute;
  confidence: number;
  latencyMs: number;
  signals: string[];
}

const WEB_SIGNALS: Array<[RegExp, number, string]> = [
  [/\b(cerca|cercami|ricerca|trova|trovami|controlla|verifica)\s+(?:su\s+|in\s+)?(?:internet|web|online|google|rete)\b/i, 5, "ricerca web esplicita"],
  [/\b(oggi|ieri|domani|adesso|ora|attuale|attualmente|in tempo reale|ultim[eoia]|recent[ei])\b/i, 3, "informazione temporale"],
  [/\b(notizi[ae]|meteo|che tempo fa|previsioni|quotazione|prezzo|borsa|cambio|risultato|classifica|calendario)\b/i, 3, "dato aggiornabile"],
  [/\b(link|sito ufficiale|pagina ufficiale|fonti online|url)\b/i, 2, "fonte online"],
  [/\b(chi è (?:il |la )?(?:presidente|ceo)|legge vigente|normativa vigente|versione più recente)\b/i, 3, "fatto soggetto a cambiamento"],
];

const BRAIN_SIGNALS: Array<[RegExp, number, string]> = [
  [/\b(brain|archivio brain|document[oi] indicizzat[oi]|file indicizzat[oi])\b/i, 5, "Brain esplicito"],
  [/\b(nei miei|nel mio|dai miei|secondo i miei)\s+(documenti|file|appunti|contratti|progetti|repository|repo)\b/i, 5, "contenuto personale"],
  [/\b(che ho (?:caricato|salvato|aggiunto|indicizzato)|caricato nel brain)\b/i, 5, "file caricato"],
  [/\b(nel progetto|nel repository|nel repo|nel codice indicizzato)\b/i, 4, "progetto locale"],
  [/\b(dove (?:viene|è|e) (?:definit[oa]|dichiarat[oa]|implementat[oa])|in quale file)\b/i, 2, "ricerca nel codice"],
];

const NORMAL_SIGNALS: Array<[RegExp, number, string]> = [
  [/\b(scrivi|inventa|crea|riscrivi|traduci|correggi|riassumi questo|spiega|spiegami|calcola)\b/i, 3, "compito diretto"],
  [/\b(filastrocca|poesia|racconto|email|funzione|algoritmo|closure|regex|esempio)\b/i, 2, "generazione o conoscenza stabile"],
];

/** Calcola il punteggio di una domanda usando le regole indicate. */
function score(text: string, rules: Array<[RegExp, number, string]>) {
  let value = 0;
  const signals: string[] = [];
  for (const [pattern, weight, label] of rules) {
    if (!pattern.test(text)) continue;
    value += weight;
    signals.push(label);
  }
  return { value, signals };
}

/** Sceglie il percorso locale più probabile per la domanda. */
export function routeLocally(question: string, options: { allowBrain: boolean } = { allowBrain: true }): LocalRouteDecision {
  const started = performance.now();
  const text = question.normalize("NFKC").trim();
  const web = score(text, WEB_SIGNALS);
  const brain = options.allowBrain ? score(text, BRAIN_SIGNALS) : { value: 0, signals: [] as string[] };
  const normal = score(text, NORMAL_SIGNALS);
  // L'ordinamento è stabile, quindi a parità vince il percorso più prudente: niente web.
  const ranked = ([
    { route: "brain" as const, ...brain },
    { route: "normal" as const, ...normal },
    { route: "web" as const, ...web },
  ]).sort((a, b) => b.value - a.value);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  let route: LocalRoute = winner.value > 0 ? winner.route : "normal";
  let confidence = winner.value > 0 ? Math.min(0.99, 0.68 + winner.value * 0.045 + Math.max(0, winner.value - runnerUp.value) * 0.025) : 0.72;
  let signals = winner.signals;

  // Richieste contemporaneamente personali e aggiornate sono ambigue: la
  // privacy impedisce di combinare Brain e Web, quindi lasciamo il controllo
  // alla scelta manuale senza inviare nulla fuori dal computer.
  if (web.value > 0 && brain.value > 0 && Math.abs(web.value - brain.value) < 3) {
    route = "normal";
    confidence = 0.4;
    signals = ["conflitto Brain/Web"];
  }
  return { route, confidence: Number(confidence.toFixed(3)), latencyMs: Number((performance.now() - started).toFixed(3)), signals };
}
