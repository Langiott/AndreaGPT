/**
 * Controlla se una risposta usa bene le fonti ricevute.
 * Segnala citazioni mancanti, errate e numeri non presenti nelle prove.
 */
import { inspectEvidenceAbsence } from "./evidence_audit";
/** Esegue i controlli rapidi sulle prove, senza certificare la verità del testo. */
export function inspectGrounding(answer: string, sources: Array<{id:string;text:string}>) {
  const available=new Map(sources.map(source=>[source.id.replace(/\s+/g," "),source.text]));
  const claims=answer.split(/\n+|(?<=[.!?])\s+(?=[A-ZÀ-Ý])/u).map(value=>value.trim()).filter(value=>value.length>30&&!/^```|^#{1,6}\s/.test(value));
  let cited=0,missing=0,invalid=0,numericGaps=0;
  for(const claim of claims) {
    const markers=[...claim.matchAll(/\[(Cit\.\s*\d+)\]/gu)].map(match=>match[1].replace(/\s+/g," "));
    if(!markers.length) {missing++;continue;}
    if(markers.some(marker=>!available.has(marker))) {invalid++;continue;}
    cited++;
    const evidence=markers.map(marker=>available.get(marker)).join(" ");
    const content=claim.replace(/\[Cit\.\s*\d+\]/gu,"").replace(/^\d+[.)]\s/,"");
    const numbers=content.match(/\b\d+(?:[.,]\d+)?\b/g)??[];
    const evidenceNumbers=new Set(evidence.match(/\b\d+(?:[.,]\d+)?\b/g)??[]);
    if(numbers.some(number=>!evidenceNumbers.has(number)))numericGaps++;
  }
  return {groundingSegments:claims.length,groundingCitedSegments:cited,groundingUncitedSegments:missing,groundingInvalidCitations:invalid,groundingNumericGaps:numericGaps,...inspectEvidenceAbsence(answer,sources)};
}
