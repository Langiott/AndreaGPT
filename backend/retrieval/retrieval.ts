/**
 * Contiene le regole comuni del retrieval.
 * Normalizza le parole, controlla i refusi e sceglie i passaggi migliori.
 */
/** Normalizza testo, accenti e separatori per la ricerca. */
export function retrievalTokens(text: string): string[] {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

/** Controlla se due parole differiscono per una sola modifica. */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length-b.length)>1) return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length) {
    if(a[i]===b[j]) {i++;j++;continue;}
    if(++edits>1)return false;
    if(a.length>=b.length)i++;
    if(b.length>=a.length)j++;
  }
  return edits+(i<a.length||j<b.length?1:0)===1;
}

interface RankedPassage {
  id: string;
  path: string;
  text: string;
  score: number;
}

/** Keep the strongest passage, then prefer evidence that adds new information. */
/** Seleziona i passaggi migliori evitando duplicati della stessa fonte. */
export function selectPassages<T extends RankedPassage>(ranked: T[], limit = 5): T[] {
  const selected: T[] = [];
  // Parole di ogni passaggio, calcolate solo al primo uso.
  const words = new Map<string, Set<string>>();
  const wordsOf = (hit: T) => {
    let set = words.get(hit.id);
    if (!set) words.set(hit.id, set = new Set(retrievalTokens(hit.text)));
    return set;
  };
  const canonical = new Map(ranked.map(hit => [hit.id, hit.text.replace(/\s+/gu, " ").trim()]));
  const remaining = [...ranked];
  const overlap = (a: T, b: T) => {
    const left = wordsOf(a), right = wordsOf(b);
    const shared = [...left].filter(term => right.has(term)).length;
    return shared / Math.max(1, left.size + right.size - shared);
  };
  while (remaining.length && selected.length < limit) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const hit = remaining[i];
      // La penalità può solo abbassare il punteggio: questo candidato non può vincere.
      if (hit.score <= bestScore) continue;
      // Similarity is only a ranking penalty. Near-duplicates can differ in a
      // number, negation or code operator, so only exact copies are discarded.
      if (selected.some(previous => previous.id === hit.id || canonical.get(hit.id) === canonical.get(previous.id))) continue;
      const redundancy = Math.max(0, ...selected.map(previous => overlap(hit, previous)));
      const score = hit.score - Math.abs(ranked[0]?.score ?? 1) * 0.15 * redundancy;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best < 0) break;
    selected.push(remaining.splice(best, 1)[0]);
  }
  return selected;
}
