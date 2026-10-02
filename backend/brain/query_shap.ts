/**
 * Testo della domanda usato dalla ricerca vettoriale e spiegazione SHAP per parola.
 * Lo SHAP misura quanto ogni parola della domanda avvicina il vettore della domanda
 * a ciascuna fonte scelta, usando lo stesso testo che la ricerca trasforma in embedding.
 */
import { retrievalTokens as tokens } from "../retrieval/retrieval";
import { isDefinitionQuery } from "../retrieval/evidence_policy";

/** Parole che non portano argomento: escluse dai termini di ricerca. */
export const QUERY_STOP_WORDS = new Set(["chi", "cosa", "che", "come", "dove", "quando", "quale", "quali", "tipo", "fa", "lavoro", "professione", "mestiere", "occupazione", "ruolo", "personaggio", "protagonista", "profilo", "panoramica", "completa", "completo", "sono", "essere", "sia", "ha", "hai", "ho", "un", "una", "uno", "il", "lo", "la", "i", "gli", "le", "di", "del", "della", "dei", "delle", "nel", "nella", "nei", "nelle", "per", "progetto", "progetti", "usato", "usata", "utilizzato", "utilizzata", "esiste", "creare", "trova", "trovami", "scrivi", "scrivimi", "codice", "modello"]);

/** Tipo di domanda: cambia il testo che viene trasformato in embedding. */
export function queryIntent(query: string) {
  return {
    // Anche le ricerche telegrafiche ("chi Nova?") e "panoramica del personaggio X" sono domande biografiche.
    identity: /^\s*chi\b(?:\s+(?:e|è|sia))?[\s:,-]+\S/iu.test(query) || /\b(?:personaggio|protagonista|profilo)\b.*\b\p{L}[\p{L}\p{N}_-]{2,}\b/iu.test(query),
    role: /\b(?:lavoro|professione|mestiere|occupazione|ruolo|che\s+cosa\s+fa)\b/iu.test(query),
    definition: isDefinitionQuery(query),
  };
}

/** Rimuove le menzioni @file: restringono la ricerca, non sono argomento. */
export const contentOf = (query: string) => query.replace(/(?:^|\s)@(?:"[^"]+"|[^\s]+)/gu, " ").trim();

/** Espansione generica dell'intento: migliora l'embedding delle domande brevissime. */
export function semanticQueryText(query: string, intent: ReturnType<typeof queryIntent>, identityTerms: string[], corrections = new Map<string, string>()) {
  if (intent.identity) return `Identità, descrizione, caratteristiche, storia e ruolo di ${identityTerms.join(" ")}. Domanda: ${query}`;
  if (intent.role) return `Professione, lavoro, ruolo, incarico e organizzazione del soggetto. Domanda: ${query}`;
  if (intent.definition) return `Definizione sintetica del metodo o approccio: scopo, componenti, fasi e risultato. Domanda: ${query}`;
  return tokens(contentOf(query)).map(term => corrections.get(term) ?? term).join(" ");
}

/* ------------------------------- SHAP ------------------------------- */

const MAX_PLAYERS = 12, EXACT_UP_TO = 8, PERMUTATIONS = 40;

/** Parole spiegate: termini di argomento con almeno 3 lettere, nell'ordine della domanda. */
export function shapPlayers(query: string) {
  return [...new Set(tokens(contentOf(query)).filter(term => term.length >= 3 && !QUERY_STOP_WORDS.has(term)))].slice(0, MAX_PLAYERS);
}

/** La domanda senza le parole spiegate assenti dalla coalizione; il resto resta com'è. */
export function queryWithout(query: string, players: string[], present: Set<string>) {
  const removed = new Set(players.filter(word => !present.has(word)));
  return query.replace(/[\p{L}\p{N}]+/gu, word => removed.has(tokens(word)[0] ?? "") ? "" : word).replace(/\s+/g, " ").trim();
}

/** Testo che la ricerca trasformerebbe in embedding per una coalizione di parole. */
export function coalitionText(query: string, players: string[], present: Set<string>) {
  const intent = queryIntent(query); // il tipo di domanda resta quello della domanda intera
  const partial = queryWithout(query, players, present);
  const identityTerms = tokens(contentOf(partial)).filter(term => !QUERY_STOP_WORDS.has(term));
  return `search_query: ${semanticQueryText(partial, intent, identityTerms)}`;
}

/**
 * Coalizioni da valutare. Fino a 8 parole: tutte (Shapley esatto).
 * Oltre: 40 permutazioni casuali con seme fisso (stima di Monte Carlo).
 */
export function shapleyPlan(n: number) {
  if (n <= EXACT_UP_TO) return { exact: true, masks: Array.from({ length: 2 ** n }, (_, mask) => mask), permutations: [] as number[][] };
  let seed = 13; const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const permutations = Array.from({ length: PERMUTATIONS }, () => { const order = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } return order; });
  const masks = new Set<number>([0]);
  for (const order of permutations) { let mask = 0; for (const player of order) { mask |= 1 << player; masks.add(mask); } }
  return { exact: false, masks: [...masks], permutations };
}

/** Valori di Shapley: contributo medio di ogni parola, su tutti gli ordini di ingresso. */
export function shapleyValues(n: number, plan: ReturnType<typeof shapleyPlan>, value: (mask: number) => number) {
  const phi = new Array(n).fill(0) as number[];
  if (plan.exact) {
    const factorial = (k: number) => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
    for (let mask = 0; mask < 2 ** n; mask++) {
      const size = popcount(mask), weight = factorial(size) * factorial(n - size - 1) / factorial(n);
      for (let i = 0; i < n; i++) if (!(mask & (1 << i))) phi[i] += weight * (value(mask | (1 << i)) - value(mask));
    }
  } else {
    for (const order of plan.permutations) { let mask = 0; for (const player of order) { const before = value(mask); mask |= 1 << player; phi[player] += (value(mask) - before) / plan.permutations.length; } }
  }
  return phi;
}
function popcount(mask: number) { let count = 0; while (mask) { count += mask & 1; mask >>>= 1; } return count; }

export interface ShapSource { source: string; similarity: number; baseline: number; shares: number[]; present: boolean[] }
export interface ShapResult { query: string; words: string[]; exact: boolean; evaluations: number; sources: ShapSource[]; overall: number[]; coveredBy: number[]; findings: string[] }

/** Quota firmata di ogni parola: contributo diviso la somma dei contributi in valore assoluto. */
export function toShares(phi: number[]) { const total = phi.reduce((sum, value) => sum + Math.abs(value), 0) || 1; return phi.map(value => value / total); }

/** Verbi di richiesta: dicono cosa fare, non di cosa parlare. Non vanno segnalati come argomenti mancanti. */
const REQUEST_WORDS = /^(?:defini\w*|spieg\w*|descriv\w*|funzion\w*|dimmi|dammi|elenc\w*|mostr\w*|calcol\w*|riassum\w*|confront\w*|analizz\w*|illustr\w*|fammi|vorrei|puoi|potresti|serve|servono|significa|cos[aeì]|perch[eé])$/u;

/** Solo i problemi: parti della domanda che le fonti non coprono e parole che allontanano. */
export function shapFindings(words: string[], overall: number[], coveredBy: number[], _sourceCount: number) {
  const findings: string[] = [];
  const order = words.map((word, i) => ({ word, share: overall[i], covered: coveredBy[i], request: REQUEST_WORDS.test(word) })).sort((a, b) => b.share - a.share);
  const uncovered = order.filter(item => item.share < 0.10 && item.covered === 0 && !item.request).map(item => `"${item.word}"`);
  if (uncovered.length) findings.push(`${uncovered.join(", ")} ${uncovered.length > 1 ? "pesano" : "pesa"} poco e non ${uncovered.length > 1 ? "compaiono" : "compare"} in nessuna fonte: questa parte della domanda non è coperta. Prova a chiederla da sola.`);
  const pushing = order.filter(item => item.share < -0.05).map(item => `"${item.word}"`);
  if (pushing.length) findings.push(`${pushing.join(", ")} allontana${pushing.length > 1 ? "no" : ""} la domanda dalle fonti scelte.`);
  return findings;
}
