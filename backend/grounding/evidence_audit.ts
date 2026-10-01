import { mathSpans } from "../retrieval/evidence_policy";

export const DOCUMENT_SCOPE_INSTRUCTION = "Le fonti sono estratti parziali, non l'intero documento. Se non trovi un dettaglio, indica che non compare negli estratti ricevuti: non affermare che manca nel documento. Mantieni formule, simboli e negazioni; segnala esplicitamente se la risposta e parziale. Non dichiarare completezza senza prove sufficienti.";

interface Source { id: string; text: string }

/** Deterministic diagnostics, not an entailment or completeness certificate. */
export function auditEvidenceDelivery(retrieved: Source[], delivered: Source[]) {
  const sent = new Set(delivered.map(source => source.id));
  const formulasBefore = retrieved.flatMap(source => mathSpans(source.text)).length;
  const formulasAfter = delivered.flatMap(source => mathSpans(source.text)).length;
  return {
    evidenceSourcesRetrieved: retrieved.length,
    evidenceSourcesDelivered: delivered.length,
    evidenceSourcesOmitted: retrieved.filter(source => !sent.has(source.id)).length,
    evidenceCharsDelivered: delivered.reduce((sum, source) => sum + source.text.length, 0),
    evidenceFormulaSpansRetrieved: formulasBefore,
    evidenceFormulaSpansDelivered: formulasAfter,
  };
}

export function inspectEvidenceAbsence(answer: string, sources: Source[]) {
  const deniesFormulas = /(?:non\s+(?:contengono|riportano|presentano|includono|ci sono)|nessun[ae]?|assenti|mancano)[^.!?\n]{0,100}\b(?:formul\w*|equazion\w*)\b|\b(?:formul\w*|equazion\w*)\b[^.!?\n]{0,70}(?:assenti|non\s+(?:sono\s+)?presenti|mancano)/iu.test(answer);
  return {
    groundingFormulaAbsenceWarnings: Number(deniesFormulas && sources.some(source => mathSpans(source.text).length > 0)),
  };
}
