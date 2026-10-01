/**
 * Riduce le prove duplicate prima di passarle al modello.
 * Mantiene testo, numeri, codice e riferimenti alle fonti.
 */
import type { ContextSource } from "../context/context";
import { mathSpans } from "../retrieval/evidence_policy";

// Exact prose duplicates only: keep numbers, negations, distinct facts and code intact.
// Source IDs and paths remain unchanged so every excerpt retains its provenance.
/** Elimina solo i paragrafi uguali, senza perdere fonti diverse. */
export function compactEvidence(sources: ContextSource[]): ContextSource[] {
  const seen = new Set<string>();
  return sources.flatMap(source => {
    // A repeated formula may be paired with different symbol definitions.
    // Do not remove it or split a multi-paragraph display-math block.
    if (mathSpans(source.text).length) return [source];
    if (/```|^\s{4}\S|^\s*(?:import |def |function |class |#include)/m.test(source.text)) return [source];
    const paragraphs = source.text.split(/\n\s*\n/);
    const retained = paragraphs.filter(paragraph => {
      const key = paragraph.replace(/^\s*#{1,6}\s+.*$/gm, "").replace(/\s+/g, " ").trim();
      if (key.length < 50) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const text = retained.join("\n\n").trim();
    // A leftover heading is not evidence. Keep short original sources as supplied.
    if (retained.length !== paragraphs.length && !text.replace(/^\s*#{1,6}\s+.*$/gm, "").trim()) return [];
    return text ? [{ ...source, text }] : [];
  });
}
