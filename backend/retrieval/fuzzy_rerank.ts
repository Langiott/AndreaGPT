/**
 * Canale fuzzy (proposta A): terzo modo di proporre candidati, accanto a embedding e lessicale.
 * Ogni estratto e la domanda diventano un profilo di temi (gradi fuzzy che sommano a 1).
 * Il canale ordina i candidati per sovrapposizione dei profili e la sua classifica viene
 * fusa alla pari con quella attuale tramite Reciprocal Rank Fusion (RRF).
 */

/** Somiglianza tra due profili fuzzy: Σ min(a, b). 1 = stessi temi negli stessi gradi, 0 = nessun tema in comune. */
export function fuzzyOverlap(a: number[], b: number[]) {
  let sum = 0;
  for (let k = 0; k < a.length; k++) sum += Math.min(a[k], b[k] ?? 0);
  return sum;
}

/** RRF: ogni classifica dà 1/(k + posizione); chi sta in alto in più classifiche vince. k = 60 è il valore classico. */
export function reciprocalRankFusion(rankings: string[][], k = 60) {
  const scores = new Map<string, number>();
  for (const ranking of rankings) ranking.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return scores;
}

export interface FuzzyFusion<T> { ranked: T[]; fuzzyTop: string[] }

/**
 * ranked: classifica attuale (embedding + lessicale), dal migliore.
 * Restituisce la classifica fusa con il canale fuzzy. Il punteggio viene riscalato
 * sul valore del primo originale, così la selezione successiva lavora sulla stessa scala.
 */
export function fuseFuzzyChannel<T extends { id: string; score: number }>(ranked: T[], queryProfile: number[], profileOf: (hit: T) => number[] | undefined): FuzzyFusion<T> {
  if (ranked.length < 2) return { ranked, fuzzyTop: [] };
  const fuzzyOrder = ranked.map((hit, i) => ({ hit, i, overlap: fuzzyOverlap(queryProfile, profileOf(hit) ?? []) }))
    .sort((a, b) => b.overlap - a.overlap || a.i - b.i).map(item => item.hit);
  const fused = reciprocalRankFusion([ranked.map(hit => hit.id), fuzzyOrder.map(hit => hit.id)]);
  const best = Math.max(...fused.values());
  const scale = Math.max(0, ranked[0].score) / best || 1;
  return {
    ranked: ranked.map(hit => ({ ...hit, score: fused.get(hit.id)! * scale })).sort((a, b) => b.score - a.score),
    fuzzyTop: fuzzyOrder.slice(0, 5).map(hit => hit.id),
  };
}
