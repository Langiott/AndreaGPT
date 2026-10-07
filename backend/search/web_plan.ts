/**
 * Pianifica la ricerca web chiedendo al modello di trasformare la domanda in parametri
 * SearXNG (varianti di query, categoria, finestra temporale, lingua). Nessuna regola a parole:
 * se il modello non risponde o risponde male si usa la domanda così com'è.
 */
import { fetch as upstreamFetch } from "undici";
import { cloudTransport, ollamaTransport } from "../config/config";

export type WebPlan = { queries: string[]; category: "news" | "general"; timeRange: "" | "day" | "week" | "month" | "year"; language: string };

const TIME_RANGES = new Set(["day", "week", "month", "year"]);
const MAX_QUERIES = 3;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string" },
    queries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_QUERIES },
    category: { type: "string", enum: ["news", "general"] },
    time_range: { type: "string", enum: ["none", "day", "week", "month", "year"] },
  },
  required: ["language", "queries", "category", "time_range"],
};

export function buildWebPlanPrompt(question: string, today: string) {
  return `Data di oggi: ${today}.
Trasforma la richiesta dell'utente nei parametri di un motore di ricerca web.
- language: codice ISO 639-1 della lingua in cui è scritta la richiesta (es. "it", "en").
- queries: da 1 a ${MAX_QUERIES} query diverse per lo stesso argomento, come le scriveresti su un motore di ricerca: solo parole chiave, senza comandi, quantità, cortesie o parole su tipo e freschezza dei risultati (le esprimono già category e time_range). Varia le formulazioni: sinonimi, nome esteso delle sigle, termine tecnico. Scrivile nella stessa lingua della richiesta: non tradurle.
- category: "news" se chiede notizie o fatti di attualità, altrimenti "general".
- time_range: quanto devono essere recenti i risultati ("day", "week", "month", "year"), "none" se il tempo non conta.
Rispondi solo con il JSON.

Esempi:
Richiesta: mi fai un riassunto degli aggiornamenti più recenti sul PNRR?
{"language":"it","queries":["PNRR","Piano Nazionale di Ripresa e Resilienza","fondi PNRR"],"category":"news","time_range":"week"}
Richiesta: can you explain how photosynthesis works
{"language":"en","queries":["how photosynthesis works","photosynthesis process"],"category":"general","time_range":"none"}

Richiesta: ${question}`;
}

/** Valida l'output del modello; qualsiasi campo fuori schema ricade sul valore neutro. */
export function parseWebPlan(raw: string, question: string): WebPlan {
  const fallback: WebPlan = { queries: [question], category: "general", timeRange: "", language: "it" };
  try {
    const data = JSON.parse(raw) as { queries?: unknown; category?: unknown; time_range?: unknown; language?: unknown };
    const queries = [...new Set((Array.isArray(data.queries) ? data.queries : [])
      .filter((query): query is string => typeof query === "string")
      .map((query) => query.replace(/\s+/g, " ").trim().slice(0, 200))
      .filter((query) => query.length >= 2))].slice(0, MAX_QUERIES);
    return {
      queries: queries.length ? queries : [question],
      category: data.category === "news" ? "news" : "general",
      timeRange: typeof data.time_range === "string" && TIME_RANGES.has(data.time_range) ? data.time_range as WebPlan["timeRange"] : "",
      language: typeof data.language === "string" && /^[a-z]{2}$/i.test(data.language.trim()) ? data.language.trim().toLowerCase() : fallback.language,
    };
  } catch {
    return fallback;
  }
}

/** Piani via via più larghi da provare se il precedente trova poco: periodo più ampio, poi ricerca generale. */
export function relaxWebPlan(plan: WebPlan): WebPlan[] {
  const order: WebPlan["timeRange"][] = ["day", "week", "month", "year", ""];
  const wider = plan.timeRange ? order[order.indexOf(plan.timeRange) + 1] : undefined;
  const steps: WebPlan[] = [plan];
  if (wider) steps.push({ ...plan, timeRange: wider });
  if (plan.category !== "general" || plan.timeRange) steps.push({ ...plan, category: "general", timeRange: "" });
  return steps;
}

/**
 * Reciprocal Rank Fusion: fonde le classifiche delle varianti di query.
 * Un risultato presente in più varianti, o in alto in una, sale; uno trovato da una sola variante scende.
 */
export function fuseRankings<T>(rankings: T[][], key: (item: T) => string, k = 60): T[] {
  const scores = new Map<string, { item: T; score: number }>();
  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const id = key(item);
      const entry = scores.get(id) ?? { item, score: 0 };
      entry.score += 1 / (k + rank + 1);
      scores.set(id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).map((entry) => entry.item);
}

/** Ollama (base = URL Ollama) oppure endpoint OpenAI-compatibile (base + apiKey): stesso modello della chat. */
export type PlanModel = { kind: "ollama"; base: string; model: string } | { kind: "openai"; base: string; model: string; apiKey: string };

/** Chiede al modello un JSON (vincolato dallo schema su Ollama); null se la chiamata fallisce. */
async function askJson(target: PlanModel, prompt: string, schema: object, maxTokens: number, signal: AbortSignal): Promise<string | null> {
  const messages = [{ role: "user", content: prompt }];
  try {
    const response = await upstreamFetch(target.kind === "ollama" ? `${target.base}/api/chat` : `${target.base}/chat/completions`, {
      dispatcher: target.kind === "ollama" ? ollamaTransport : cloudTransport,
      method: "POST",
      headers: { "Content-Type": "application/json", ...(target.kind === "openai" ? { Authorization: `Bearer ${target.apiKey}` } : {}) },
      body: JSON.stringify(target.kind === "ollama"
        ? { model: target.model, stream: false, think: false, keep_alive: "30m", format: schema, options: { temperature: 0, num_predict: maxTokens, num_ctx: 4096 }, messages }
        : { model: target.model, stream: false, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" }, messages }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { message?: { content?: string }; choices?: Array<{ message?: { content?: string } }> };
    // I modelli cloud possono avvolgere il JSON in un blocco ```json.
    return (data.message?.content ?? data.choices?.[0]?.message?.content ?? "").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  } catch (error) {
    console.warn("Modello non disponibile per la ricerca web:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function planWebSearch(question: string, target: PlanModel, signal: AbortSignal): Promise<WebPlan> {
  const raw = await askJson(target, buildWebPlanPrompt(question, new Date().toISOString().slice(0, 10)), PLAN_SCHEMA, 160, signal);
  return parseWebPlan(raw ?? "", question);
}

const RELEVANCE_SCHEMA = { type: "object", properties: { relevant: { type: "array", items: { type: "integer" } } }, required: ["relevant"] };

export function buildRelevancePrompt(question: string, candidates: Array<{ title: string; excerpt: string }>) {
  const list = candidates.map((candidate, index) => `[${index + 1}] ${candidate.title} — ${candidate.excerpt.slice(0, 220)}`).join("\n");
  return `Domanda dell'utente: ${question}

Risultati di una ricerca web:
${list}

Quali risultati parlano davvero dell'argomento della domanda? Escludi quelli che condividono solo una parola o una sigla ma trattano altro.
Rispondi solo con il JSON {"relevant": [numeri dei risultati pertinenti]}; lista vuota se nessuno è pertinente.`;
}

/** Indici (0-based) dei candidati pertinenti; null se l'output non è utilizzabile. */
export function parseRelevant(raw: string, count: number): number[] | null {
  try {
    const data = JSON.parse(raw) as { relevant?: unknown };
    if (!Array.isArray(data.relevant)) return null;
    return [...new Set(data.relevant.filter((value): value is number => Number.isInteger(value) && value >= 1 && value <= count).map((value) => value - 1))];
  } catch {
    return null;
  }
}

/** Tiene solo i risultati che il modello giudica pertinenti; se il giudizio fallisce li lascia tutti. */
export async function selectRelevant<T extends { title: string; excerpt: string }>(question: string, candidates: T[], target: PlanModel, signal: AbortSignal): Promise<T[]> {
  if (!candidates.length) return candidates;
  const raw = await askJson(target, buildRelevancePrompt(question, candidates), RELEVANCE_SCHEMA, 80, signal);
  const indices = raw === null ? null : parseRelevant(raw, candidates.length);
  return indices === null ? candidates : candidates.filter((_, index) => indices.includes(index));
}
