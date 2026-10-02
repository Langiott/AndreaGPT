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

/**
 * Seleziona i passaggi migliori nell'ordine del punteggio, scartando solo le copie esatte.
 * Nessuna penalità di somiglianza: i brani giusti di una stessa sezione si somigliano
 * e la penalità li spingeva giù (nDCG +0,021 senza, p = 0,008).
 */
export function selectPassages<T extends RankedPassage>(ranked: T[], limit = 5): T[] {
  const seen = new Set<string>(), selected: T[] = [];
  for (const hit of [...ranked].sort((a, b) => b.score - a.score)) {
    if (selected.length >= limit) break;
    const canonical = hit.text.replace(/\s+/gu, " ").trim();
    if (seen.has(hit.id) || seen.has(canonical)) continue;
    seen.add(hit.id); seen.add(canonical); selected.push(hit);
  }
  return selected;
}
