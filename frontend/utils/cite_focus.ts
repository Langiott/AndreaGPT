/**
 * Trova nel documento renderizzato il tratto citato da una fonte Brain (es. "file.md:3428-3432").
 *
 * Il lettore trasforma il Markdown (formule, simboli) prima di mostrarlo, quindi i numeri di riga
 * non corrispondono al DOM: si confrontano le sequenze di parole, senza sintassi Markdown.
 */

/** Citazione Brain: percorso del documento e righe (come le scrive il backend). */
export function parseCitation(citation: string) {
  const match = /^(.*?)(?: \(pagina \d+\))?:(\d+)-(\d+)(?: \(testo estratto\))?$/u.exec(citation.trim());
  return match ? { source: match[1], startLine: Number(match[2]), endLine: Number(match[3]) } : { source: citation.trim(), startLine: 0, endLine: 0 };
}

/** Parole in minuscolo, senza sintassi Markdown/LaTeX. */
export function plainWords(markdown: string) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\[a-zA-Z]+/g, " ")
    .toLocaleLowerCase("it-IT")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

const LONGEST = 8;
const SHORTEST = 3;

function indexOf(words: string[], sequence: string[], from = 0, to = words.length) {
  outer: for (let index = from; index + sequence.length <= to; index++) {
    for (let offset = 0; offset < sequence.length; offset++) if (words[index + offset] !== sequence[offset]) continue outer;
    return index;
  }
  return -1;
}

/**
 * Indici [start, end] (parole del documento) del tratto che corrisponde al frammento.
 * Inizio: la prima sequenza del frammento ritrovata (si scartano parole iniziali non presenti, es. formule).
 * Fine: l'ultima sequenza del frammento ritrovata dopo l'inizio, entro una finestra proporzionata.
 */
export function findPassage(documentWords: string[], snippet: string[]): { start: number; end: number } | null {
  if (!snippet.length || !documentWords.length) return null;
  for (let size = Math.min(LONGEST, snippet.length); size >= Math.min(SHORTEST, snippet.length); size--) {
    for (let skip = 0; skip + size <= snippet.length; skip++) {
      const start = indexOf(documentWords, snippet.slice(skip, skip + size));
      if (start === -1) continue;
      const windowEnd = Math.min(documentWords.length, start + snippet.length * 3 + LONGEST);
      for (let tail = snippet.length; tail - size >= skip + size; tail--) {
        const at = indexOf(documentWords, snippet.slice(tail - size, tail), start + size, windowEnd);
        if (at !== -1) return { start, end: at + size - 1 };
      }
      return { start, end: Math.min(documentWords.length - 1, start + snippet.length - skip - 1) };
    }
  }
  return null;
}
