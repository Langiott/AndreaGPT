/**
 * Confidenza per token dalle logprobs di Ollama e contesto per le biforcazioni.
 *
 * Ollama restituisce token BPE: un carattere accentato può essere spezzato su più token
 * che da soli non sono UTF-8 valido. Quei token vengono uniti finché i byte non formano testo valido.
 */
import { randomUUID } from "node:crypto";

/** Logprob come arriva da Ollama (/api/chat con logprobs: true). */
export type OllamaLogprob = { token: string; logprob: number; bytes?: number[]; top_logprobs?: Array<{ token: string; logprob: number; bytes?: number[] }> };
/** Token compatto per il frontend: testo, probabilità scelta, alternative [testo, probabilità]. */
export type TraceToken = { t: string; p: number; alt: Array<[string, number]> };

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const round = (value: number) => Math.round(value * 1000) / 1000;

function decode(bytes: number[]) {
  try { return strictUtf8.decode(Uint8Array.from(bytes)); } catch { return null; }
}

/** Alternativa leggibile: scartate quelle che non sono testo completo. */
function readable(entry: { token: string; bytes?: number[] }) {
  const text = entry.bytes ? decode(entry.bytes) : entry.token;
  return text && !text.includes("�") ? text : null;
}

export function toTraceTokens(logprobs: OllamaLogprob[]): TraceToken[] {
  const tokens: TraceToken[] = [];
  let pendingBytes: number[] = [];
  let pendingLogprob = 0;
  let pendingAlt: Array<[string, number]> | null = null;
  for (const entry of logprobs) {
    const bytes = entry.bytes ?? [...new TextEncoder().encode(entry.token)];
    // alternative del primo token del gruppo: è lì che il modello ha scelto
    pendingAlt ??= (entry.top_logprobs ?? []).flatMap(option => { const text = readable(option); return text === null ? [] : [[text, round(Math.exp(option.logprob))] as [string, number]]; });
    pendingBytes = [...pendingBytes, ...bytes];
    pendingLogprob += entry.logprob;
    const text = decode(pendingBytes);
    if (text === null) continue;
    tokens.push({ t: text, p: round(Math.exp(pendingLogprob)), alt: pendingAlt });
    pendingBytes = [];
    pendingLogprob = 0;
    pendingAlt = null;
  }
  if (pendingBytes.length) tokens.push({ t: new TextDecoder().decode(Uint8Array.from(pendingBytes)), p: round(Math.exp(pendingLogprob)), alt: pendingAlt ?? [] });
  return tokens;
}

/** Contesto completo di una risposta (prompt di sistema, fonti, storia) per ripartire da un token. */
export type BranchContext = { model: string; messages: unknown[]; options: Record<string, unknown>; maxTokens: number; expiresAt: number };

const BRANCH_TTL_MS = 60 * 60_000;
const BRANCH_LIMIT = 40;
const branchContexts = new Map<string, BranchContext>();

export function rememberBranchContext(context: Omit<BranchContext, "expiresAt">) {
  const now = Date.now();
  for (const [id, entry] of branchContexts) if (entry.expiresAt <= now) branchContexts.delete(id);
  // la Map mantiene l'ordine di inserimento: si toglie il più vecchio
  while (branchContexts.size >= BRANCH_LIMIT) branchContexts.delete(branchContexts.keys().next().value!);
  const id = randomUUID();
  branchContexts.set(id, { ...context, expiresAt: now + BRANCH_TTL_MS });
  return id;
}

export function branchContext(id: string) {
  const entry = branchContexts.get(id);
  if (!entry || entry.expiresAt <= Date.now()) { branchContexts.delete(id); return null; }
  return entry;
}
