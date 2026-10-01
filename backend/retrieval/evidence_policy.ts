/** Shared, domain-independent policy. Query intent changes coverage, never the topic. */
import { retrievalTokens, selectPassages } from "./retrieval";

export function evidenceIntent(query: string) {
  const normalized = retrievalTokens(query).join(" ");
  const formulas = /\b(?:formul\w*|equazion\w*|equation\w*|derivazion\w*)\b/u.test(normalized);
  const detailed = formulas || /\b(?:metod\w*|method\w*|procedur\w*|algoritm\w*|algorithm\w*|dettagli\w*|complet\w*|passaggi|approfond\w*)\b/u.test(normalized);
  return { formulas, detailed };
}

/** Riconosce una richiesta di definizione senza legarla a un dominio specifico. */
export function isDefinitionQuery(query: string): boolean {
  const normalized = query.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const asksDefinition = /\b(?:definisci|definizione|cos['’]?e|che\s+cos['’]?e|in\s+breve|brevemente|sintesi|sintetizza)\b/u.test(normalized);
  const namesConcept = /\b(?:metod\w*|approcci\w*|procedur\w*|algoritm\w*|tecnic\w*|modell\w*|sistem\w*|process\w*)\b/u.test(normalized);
  return asksDefinition && namesConcept;
}

/** Complete math spans only; a lone '=' or a technical keyword is not a formula. */
export function mathSpans(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/gu, "");
  return [...prose.matchAll(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([^\n]+?\\\)|(?<![\\$])\$(?!\$)[^\n$]+?\$(?!\$)/gu)].map(match => match[0]);
}

/** Small preference for the requested evidence format; relevance remains primary. */
export function evidenceFormatBoost(query: string, text: string): number {
  return evidenceIntent(query).formulas && mathSpans(text).length ? 0.12 : 0;
}

interface Passage { id: string; path: string; section?: string; text: string; score: number }

export function selectEvidence<T extends Passage>(ranked: T[], query: string, scoped: boolean): T[] {
  const { detailed } = evidenceIntent(query);
  if (!detailed) return selectPassages(ranked, 5);
  // Preserve a few continuations of the best section (e.g. an algorithm split
  // into chunks), then fill with diverse evidence. Never exclude summaries.
  const top = ranked[0];
  if (!scoped || !top?.section) return selectPassages(ranked, 8);
  const continuations = ranked.filter(hit => hit.path === top.path && hit.section === top.section && hit.score >= top.score * 0.8);
  const anchors = selectPassages(continuations, 3);
  const remainder = selectPassages(ranked.filter(hit => !anchors.some(anchor => anchor.id === hit.id)), 8);
  return [...anchors, ...remainder].filter((hit, i, all) =>
    all.findIndex(other => other.text.replace(/\s+/gu, " ").trim() === hit.text.replace(/\s+/gu, " ").trim()) === i,
  ).slice(0, 8);
}
