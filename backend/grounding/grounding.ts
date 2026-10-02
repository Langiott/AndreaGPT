/**
 * Controlla se una risposta usa bene le fonti ricevute e misura Groundedness e Faithfulness.
 *
 * Frasi C: frasi della risposta con contenuto (esclusi titoli, codice, aperture "…:",
 * chiusure di cortesia ed elenchi di fonti). Fonti citate E(c): le citazioni della frase,
 * altrimenti quelle del suo paragrafo (il modello cita di solito una volta a fine paragrafo).
 * K(x): radici (prime 6 lettere) delle parole di contenuto di x.
 *   supporto(c)   = |K(c) ∩ K(E(c))| / |K(c)|
 *   sostenuta(c)  ⇔ E(c) ≠ ∅ ∧ supporto(c) ≥ τ ∧ numeri(c) ⊆ numeri(E(c))
 *   Groundedness  = |{c sostenute}| / |C|          (quanta parte della risposta è sostenuta dalle fonti)
 *   Faithfulness  = |{c sostenute}| / |{c citate}|  (quanto sono affidabili le citazioni date)
 *   Copertura     = |{c citate}| / |C|
 * È un controllo lessicale: non coglie negazioni o relazioni invertite tra parole presenti nella fonte.
 */
import { retrievalTokens } from "../retrieval/retrieval";
import { inspectEvidenceAbsence } from "./evidence_audit";

/**
 * Soglia di supporto lessicale, tarata su 75 frasi citate del 7B: sotto 0,4 cade il 9% delle frasi reali,
 * il 48% delle stesse frasi attribuite alla fonte sbagliata e l'89% delle frasi di altre risposte.
 */
export const SUPPORT_THRESHOLD = 0.4;

const STOP = new Set(["alla", "alle", "allo", "agli", "dalla", "dalle", "dallo", "dagli", "della", "delle", "dello", "degli", "nella", "nelle", "nello", "negli", "sulla", "sulle", "sullo", "sugli", "questo", "questa", "questi", "queste", "quello", "quella", "quelli", "quelle", "sono", "essere", "viene", "vengono", "stato", "stata", "stati", "state", "anche", "come", "quindi", "inoltre", "mentre", "dove", "quando", "perche", "poiche", "ogni", "tutti", "tutte", "tutto", "molto", "molti", "altri", "altre", "altro", "stesso", "stessa", "dunque", "infatti", "cioe", "ovvero", "oppure", "sempre", "ancora", "proprio", "suoi", "sue", "suo", "sua", "loro", "puo", "possono", "deve", "devono", "fonte", "fonti", "estratto", "estratti", "documento", "citazione", "secondo", "riportato", "riportata", "indicato", "indicata", "descritto", "descritta", "tramite", "attraverso", "senza", "verso", "circa", "parte", "modo", "tipo", "cosa", "fatto", "with", "that", "this", "from", "which"]);

const stems = (text: string) => new Set(retrievalTokens(text).filter(word => word.length >= 4 && !/^\d+$/u.test(word) && !STOP.has(word)).map(word => word.slice(0, 6)));
// "0,52" e "0.52", "418 470" e "418470" sono lo stesso numero.
const numbers = (text: string) => (text.replace(/(\d)[   ](?=\d{3}\b)/gu, "$1").match(/\b\d+(?:[.,]\d+)?\b/gu) ?? []).map(value => value.replace(",", "."));
/** Quota delle parole di contenuto di una frase che compaiono nel testo di prova (radici di 6 lettere). */
export function lexicalSupport(sentence: string, evidence: string) {
  const words = stems(sentence), found = stems(evidence);
  return words.size ? [...words].filter(word => found.has(word)).length / words.size : 1;
}
const MARKER = /\[(Cit\.\s*\d+)\]/gu;
const markersOf = (text: string) => [...text.matchAll(MARKER)].map(match => match[1].replace(/\s+/g, " "));
// Riferimenti alle fonti (percorso:righe) e numerazione degli elenchi non sono affermazioni numeriche.
const claimText = (text: string) => text.replace(MARKER, "").replace(/\S+\.\w{1,5}:\d+-\d+/gu, "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "");
const NOT_A_CLAIM = /^(?:#{1,6}\s|```|\s*[-*]?\s*\[Cit\.\s*\d+\]\s*\S+:\d+-\d+)|:\s*$|^\s*(?:spero|fammi sapere|se (?:hai|vuoi|desideri)|posso (?:aiutarti|approfondire)|resto a disposizione|ecco\b[^.!?]*:)/iu;

/** Esegue i controlli sulle prove: citazioni, numeri, supporto lessicale per frase. Non certifica la verità del testo. */
export function inspectGrounding(answer: string, sources: Array<{ id: string; text: string }>) {
  const available = new Map(sources.map(source => [source.id.replace(/\s+/g, " "), source.text]));
  const allEvidence = sources.map(source => source.text).join("\n");
  const paragraphs = answer.replace(/```[\s\S]*?```/gu, "").split(/\n\s*\n/u);
  // Citazioni inesistenti contate su tutta la risposta, anche negli elenchi di fonti esclusi dalle frasi.
  const invalid = markersOf(answer).filter(marker => !available.has(marker)).length;
  let claims = 0, cited = 0, uncited = 0, numericGaps = 0, unsupported = 0, supported = 0;
  for (const paragraph of paragraphs) {
    const paragraphMarkers = markersOf(paragraph);
    for (const sentence of paragraph.split(/\n+|(?<=[.!?])\s+(?=[A-ZÀ-Ý])/u).map(value => value.trim())) {
      const content = claimText(sentence).trim();
      if (content.length <= 30 || NOT_A_CLAIM.test(sentence)) continue;
      claims++;
      const own = markersOf(sentence);
      const markers = own.length ? own : paragraphMarkers;
      // Numeri controllati su ogni frase: sulla fonte citata, oppure su tutte le fonti se la frase non cita.
      const evidenceNumbers = new Set(numbers(markers.length ? markers.map(marker => available.get(marker) ?? "").join("\n") : allEvidence));
      const numericGap = numbers(content).some(number => !evidenceNumbers.has(number));
      if (numericGap) numericGaps++;
      if (!markers.length) { uncited++; continue; }
      if (markers.some(marker => !available.has(marker))) continue;
      cited++;
      const support = lexicalSupport(content, markers.map(marker => available.get(marker)!).join("\n"));
      if (support >= SUPPORT_THRESHOLD && !numericGap) supported++; else unsupported++;
    }
  }
  const ratio = (value: number, total: number) => total ? Number((value / total).toFixed(3)) : 1;
  return {
    groundingSegments: claims,
    groundingCitedSegments: cited,
    groundingUncitedSegments: uncited,
    groundingInvalidCitations: invalid,
    groundingNumericGaps: numericGaps,
    groundingUnsupportedSegments: unsupported,
    groundedness: ratio(supported, claims),
    faithfulness: ratio(supported, cited),
    citationCoverage: ratio(cited, claims),
    ...inspectEvidenceAbsence(answer, sources),
  };
}

/**
 * Avviso solo per errori concreti (citazione inesistente, numero non trovato, formule negate)
 * o quando una parte rilevante delle frasi citate non trova riscontro nella fonte citata.
 * Le frasi senza citazione abbassano Groundedness e Copertura ma da sole non generano avviso.
 */
export function groundingWarning(checks: ReturnType<typeof inspectGrounding>) {
  return Boolean(checks.groundingInvalidCitations || checks.groundingNumericGaps || checks.groundingFormulaAbsenceWarnings || (checks.groundingCitedSegments >= 2 ? checks.faithfulness < 0.75 : checks.groundingUnsupportedSegments > 0));
}
