/**
 * Redazione News per modelli locali piccoli.
 * Un articolo per chiamata: contesto corto, output JSON vincolato, prefisso di sistema fisso
 * (Ollama riusa la KV cache) e fallback per singolo articolo invece che per l'intera edizione.
 */
export type NewsSource = { id: number; title: string; url: string; description: string };
export type NewsArticle = { id: number; markdown: string; fallback: boolean };
export type OllamaChat = (body: object, signal: AbortSignal) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    titolo: { type: "string" },
    sintesi: { type: "string" },
    dettagli: { type: "string" },
    perche_conta: { type: "string" },
    limiti: { type: "string" },
  },
  required: ["titolo", "sintesi", "dettagli", "perche_conta", "limiti"],
};

// Identico in ogni chiamata: resta in testa al prompt così la KV cache del prefisso viene riusata.
const SYSTEM = `Sei un redattore scientifico italiano. Ricevi UNA fonte, spesso in inglese, e scrivi UN articolo di giornale in italiano.
Rispondi solo con JSON:
- titolo: titolo giornalistico in italiano, informativo, max 12 parole (traduci, non copiare l'inglese)
- sintesi: 2 frasi sul risultato principale
- dettagli: 3-5 frasi su metodo, dati, metriche e confronto con lo stato dell'arte
- perche_conta: 1-2 frasi sull'impatto pratico
- limiti: 1 frase su limiti o stato (preprint, non revisionato); "non specificato" se assente
Usa solo fatti presenti nella fonte. Niente numeri inventati. Tutto in italiano.`;

const IT_WORDS = /\b(il|lo|la|gli|le|di|che|per|una|del|della|sono|con|non|nel|degli|questo|dei|alla|più|viene|anche)\b/giu;
const EN_WORDS = /\b(the|and|of|to|is|are|with|for|that|this|we|our|which|from)\b/giu;
const LEAK = /(?:l['’]utente ha richiesto|non ho ricevuto|prompt|istruzioni interne|come modello)/iu;

export function looksItalian(text: string) {
  const it = text.match(IT_WORDS)?.length ?? 0;
  const en = text.match(EN_WORDS)?.length ?? 0;
  return it >= 3 && it > en * 1.5;
}

const SITE_SUFFIX = /\s+[-|–—]\s+(?:arXiv(?:\.org)?|OpenReview|Nature|Science|ScienceDirect|PubMed|PNAS|IEEE Xplore|ACM Digital Library|Google DeepMind|Phys\.org|Hugging Face)\s*$/iu;
export const sourceTitle = (title: string) => title.replace(SITE_SUFFIX, "").trim();
const words = (text: string) => new Set(text.toLocaleLowerCase("it-IT").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
/** Titolo ricopiato dall'originale inglese invece che tradotto. */
function copiedTitle(title: string, original: string) {
  const own = words(title), source = words(original);
  if (own.size < 4) return false;
  return [...own].filter(word => source.has(word)).length / own.size >= 0.7;
}

const clean = (text: unknown) => (typeof text === "string" ? text : "").replace(/[\[\]#`]/g, "").replace(/\s+/g, " ").trim();

export function sourceFallback(source: NewsSource): NewsArticle {
  const title = clean(sourceTitle(source.title)) || `Fonte ${source.id}`;
  const excerpt = clean(source.description).slice(0, 700) || "Estratto non disponibile.";
  return { id: source.id, fallback: true, markdown: `## ${title} [${source.id}]\n\n**Estratto originale.** ${excerpt}` };
}

function toMarkdown(source: NewsSource, raw: string, strict: boolean): NewsArticle | null {
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { return null; }
  const titolo = clean(data.titolo), sintesi = clean(data.sintesi), dettagli = clean(data.dettagli);
  const percheConta = clean(data.perche_conta), limiti = clean(data.limiti);
  const body = `${sintesi} ${dettagli} ${percheConta}`;
  if (!titolo || sintesi.length < 40 || LEAK.test(body) || !looksItalian(body)) return null;
  // Al primo tentativo un titolo inglese ricopiato forza la riscrittura; all'ultimo si tiene il corpo italiano.
  if (strict && copiedTitle(titolo, source.title)) return null;
  const parts = [`## ${titolo} [${source.id}]`, `**In sintesi.** ${sintesi}`];
  if (dettagli) parts.push(dettagli);
  if (percheConta) parts.push(`**Perché conta.** ${percheConta}`);
  if (limiti && !/^non specificat/iu.test(limiti)) parts.push(`**Limiti.** ${limiti}`);
  return { id: source.id, fallback: false, markdown: parts.join("\n\n") };
}

async function writeArticle(chat: OllamaChat, model: string, source: NewsSource, signal: AbortSignal): Promise<NewsArticle> {
  const user = `Fonte [${source.id}]\nTitolo: ${sourceTitle(source.title)}\nURL: ${source.url}\nTesto:\n${source.description.slice(0, 1400)}`;
  // Secondo tentativo a temperatura 0: i modelli 2B a volte rispondono in inglese o con JSON troncato.
  for (const [attempt, temperature] of [0.2, 0].entries()) {
    if (signal.aborted) break;
    try {
      const response = await chat({
        model, stream: false, think: false, keep_alive: "15m", format: ARTICLE_SCHEMA,
        options: { temperature, num_ctx: 2048, num_predict: 480 },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }, AbortSignal.any([signal, AbortSignal.timeout(60_000)]));
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      const data = (await response.json()) as { message?: { content?: string } };
      const article = toMarkdown(source, data.message?.content ?? "", attempt === 0);
      if (article) return article;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return sourceFallback(source);
}

/** Redige gli articoli con un piccolo pool di worker e li consegna appena pronti, nell'ordine di completamento. */
export async function writeEdition(chat: OllamaChat, model: string, sources: NewsSource[], signal: AbortSignal, onArticle: (article: NewsArticle) => void, concurrency = 2) {
  const queue = [...sources];
  const worker = async () => {
    for (let source = queue.shift(); source; source = queue.shift()) {
      if (signal.aborted) return;
      onArticle(await writeArticle(chat, model, source, signal));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
}
