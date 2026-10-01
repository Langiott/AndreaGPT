/**
 * Metriche del retrieval su un set di domande con risposta nota.
 * - Recall@5: quante domande hanno almeno una fonte giusta tra le prime 5.
 * - MRR: quanto in alto compare la prima fonte giusta (1 = sempre prima, 0,5 = di solito seconda).
 * - Copertura: per le domande "a due temi", quante parti attese sono state trovate.
 */

export interface LineRange { file: string; start: number; end: number; label: string }
export interface Retrieved { path: string; startLine: number; endLine: number }
export interface QuestionResult { question: string; type: string; expected: LineRange[]; ranks: number[]; firstRank: number; coverage: number; top: string[] }

/**
 * Righe di una sezione: dal suo titolo fino al prossimo titolo dello stesso livello o superiore.
 * "3.2.6" trova "#### 3.2.6 Erasure Coding"; le sottosezioni sono incluse.
 */
export function sectionRange(file: string, markdown: string, section: string): LineRange {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.map((line, i) => ({ i, match: line.match(/^(#{1,6})\s+(.*)$/) })).filter(h => h.match);
  const index = headings.findIndex(h => h.match![2].trim() === section || h.match![2].trim().startsWith(`${section} `));
  if (index < 0) throw new Error(`Sezione "${section}" non trovata in ${file}.`);
  const level = headings[index].match![1].length;
  const next = headings.slice(index + 1).find(h => h.match![1].length <= level);
  return { file, start: headings[index].i + 1, end: next ? next.i : lines.length, label: `${section} ${headings[index].match![2].trim().slice(section.length).trim()}`.trim() };
}

/** Un estratto è giusto se è dello stesso file e le sue righe si sovrappongono a quelle attese. */
export const overlaps = (hit: Retrieved, range: LineRange) => (hit.path === range.file || hit.path.endsWith(`/${range.file}`)) && hit.startLine <= range.end && hit.endLine >= range.start;

/** Valuta una domanda sui primi k risultati. */
export function scoreQuestion(question: string, type: string, expected: LineRange[], retrieved: Retrieved[], k = 5): QuestionResult {
  const top = retrieved.slice(0, k);
  const ranks = top.map((hit, i) => expected.some(range => overlaps(hit, range)) ? i + 1 : 0).filter(rank => rank > 0);
  const covered = expected.filter(range => top.some(hit => overlaps(hit, range))).length;
  return { question, type, expected, ranks, firstRank: ranks[0] ?? 0, coverage: expected.length ? covered / expected.length : 0, top: top.map(hit => `${hit.path}:${hit.startLine}-${hit.endLine}`) };
}

/** Riassunto: recall@5, MRR e copertura (solo domande "due temi"), anche per tipo di domanda. */
export function summarize(results: QuestionResult[]) {
  const block = (items: QuestionResult[]) => ({
    questions: items.length,
    recallAt5: items.length ? items.filter(r => r.firstRank > 0).length / items.length : 0,
    mrr: items.length ? items.reduce((sum, r) => sum + (r.firstRank ? 1 / r.firstRank : 0), 0) / items.length : 0,
  });
  const twoTopics = results.filter(r => r.type === "due temi");
  const types = [...new Set(results.map(r => r.type))];
  return {
    ...block(results),
    coverage: twoTopics.length ? twoTopics.reduce((sum, r) => sum + r.coverage, 0) / twoTopics.length : null,
    byType: Object.fromEntries(types.map(type => [type, block(results.filter(r => r.type === type))])),
  };
}
