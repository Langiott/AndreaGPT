import { useEffect, useState, type ReactNode } from "react";
import type { TokenBranch, TokenTrace, TraceToken } from "../types/types";

const percent = (value: number) => `${Math.round(value * 100)}%`;
/** Parola incerta: la prima scelta del modello sotto questa soglia e un'alternativa concreta abbastanza probabile. */
const UNCERTAIN_BELOW = 0.6;
const VERY_UNCERTAIN_BELOW = 0.35;
const ALTERNATIVE_MIN = 0.12;
const MAX_ALTERNATIVES = 3;

const hasContent = (text: string) => /[\p{L}\p{N}]/u.test(text);
/** Parole grammaticali: l'incertezza su articoli e preposizioni non dice niente sul contenuto. */
const FUNCTION_WORDS = new Set("il lo la i gli le l un uno una un' di a da in con su per tra fra e ed o od ma che non si ci ne del dello della dei degli delle al allo alla ai agli alle dal dalla dai dalle nel nello nella nei negli nelle sul sulla sui sulle col questo questa questi queste quello quella è sono the an of to in on and or is are for with".split(" "));
/** Parola che porta contenuto: numeri sempre, altrimenti non grammaticale. */
const informative = (text: string) => /\p{N}/u.test(text) || (hasContent(text) && !FUNCTION_WORDS.has(label(text).toLowerCase()));
/** Parola senza spazi e punteggiatura ai bordi. */
const label = (text: string) => text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Distribuzione del modello in una posizione: alternative + token scelto, dalla più probabile. */
function distribution(token: TraceToken): Array<[string, number]> {
  const options = token.alt.some(([text]) => text === token.t) ? token.alt : [...token.alt, [token.t, token.p] as [string, number]];
  return [...options].sort((a, b) => b[1] - a[1]);
}
/** Quanto il modello era deciso: probabilità della sua prima scelta (indipendente dal campionamento). */
const decisiveness = (token: TraceToken) => distribution(token)[0]?.[1] ?? token.p;

type Word = { start: number; end: number; text: string; decision: number; top: number; uncertain: boolean };

/** Raggruppa i token BPE in parole: una parola nuova inizia con spazio/punteggiatura o dopo un carattere non alfanumerico. */
export function groupWords(tokens: TraceToken[]): Word[] {
  const words: Array<{ start: number; end: number; text: string }> = [];
  tokens.forEach((token, index) => {
    const current = words.at(-1);
    if (current && /^[\p{L}\p{N}]/u.test(token.t) && /[\p{L}\p{N}]$/u.test(current.text)) { current.end = index + 1; current.text += token.t; }
    else words.push({ start: index, end: index + 1, text: token.t });
  });
  return words.map(word => {
    // il punto della parola in cui il modello era meno deciso
    let decision = word.start;
    for (let index = word.start; index < word.end; index++) if (decisiveness(tokens[index]) < decisiveness(tokens[decision])) decision = index;
    const top = decisiveness(tokens[decision]);
    const concrete = distribution(tokens[decision]).filter(([text, p]) => text !== tokens[decision].t && p >= ALTERNATIVE_MIN && hasContent(text));
    return { ...word, decision, top, uncertain: informative(word.text) && top < UNCERTAIN_BELOW && concrete.length > 0 };
  });
}

/** Media geometrica della decisione del modello sulle parole. */
export function confidence(tokens: TraceToken[]) {
  const words = groupWords(tokens).filter(word => informative(word.text));
  if (!words.length) return 1;
  return Math.exp(words.reduce((sum, word) => sum + Math.log(Math.max(word.top, 1e-6)), 0) / words.length);
}

function WordText({ tokens, selected, onSelect, lead }: { tokens: TraceToken[]; selected?: number | null; onSelect?: (index: number) => void; lead?: string }) {
  return <div className="token-text">{lead && <span className="token-prefix">{lead}</span>}{groupWords(tokens).map((word, index) => {
    if (!word.uncertain) return <span key={index}>{word.text}</span>;
    // spazi e punteggiatura iniziali fuori dall'evidenziazione: a capo resterebbero come riquadro vuoto
    const [, space, core] = word.text.match(/^([^\p{L}\p{N}]*)([\s\S]*)$/u)!;
    return <span key={index}>{space}<span className={`${word.top < VERY_UNCERTAIN_BELOW ? "low" : "mid"}${selected === index ? " selected" : ""}`} onClick={onSelect ? () => onSelect(index) : undefined}>{core}</span></span>;
  })}</div>;
}

type Alternative = { token: string; p: number; word: string | null };

/** Parole incerte della risposta, alternative complete e rami alternativi. */
export function TokenConfidencePanel({ lead, trace, branches = [], branching, onBranch, onComplete }: {
  /** Inizio della riga di riepilogo (es. affinità con le fonti). */
  lead?: ReactNode;
  trace: TokenTrace; branches?: TokenBranch[]; branching: boolean;
  onBranch: (at: number, token: string, from: string, to: string) => void;
  /** Completa una parola alternativa: restituisce il testo generato dopo il prefisso. */
  onComplete: (prefix: string) => Promise<string>;
}) {
  const words = groupWords(trace.tokens);
  const uncertain = words.map((word, index) => ({ word, index })).filter(({ word }) => word.uncertain);
  const [selected, setSelected] = useState<number | null>(() => uncertain.length ? uncertain.reduce((low, item) => item.word.top < low.word.top ? item : low).index : null);
  const [alternatives, setAlternatives] = useState<Record<number, Alternative[]>>({});
  const [expired, setExpired] = useState(false);
  const score = confidence(trace.tokens);
  const verdict = score >= 0.9 ? "alta" : score >= 0.75 ? "media" : "bassa";
  const word = selected === null ? null : words[selected];

  // alternative della parola selezionata, completate in parole intere (pochi token ciascuna, solo su richiesta)
  useEffect(() => {
    if (selected === null || !word || alternatives[selected]) return;
    const decision = trace.tokens[word.decision];
    const before = trace.tokens.slice(0, word.decision).map(token => token.t).join("");
    const wordStart = trace.tokens.slice(word.start, word.decision).map(token => token.t).join("");
    const options = distribution(decision).filter(([text, p]) => text !== decision.t && p >= ALTERNATIVE_MIN / 2 && hasContent(text)).slice(0, MAX_ALTERNATIVES);
    setAlternatives(current => ({ ...current, [selected]: options.map(([token, p]) => ({ token, p, word: null })) }));
    void Promise.all(options.map(async ([token, p]) => {
      // il token alternativo può chiudere la parola o esserne solo l'inizio: si completa fino al primo separatore
      if (!/[\p{L}\p{N}]$/u.test(token)) return { token, p, word: label(wordStart + token) || token.trim() };
      try {
        const tail = (await onComplete(before + token)).match(/^[\p{L}\p{N}'’-]*/u)?.[0] ?? "";
        return { token, p, word: label(wordStart + token + tail) || token.trim() };
      } catch {
        // contesto non più sul server (riavvio o oltre 1 ora): resta l'inizio della parola
        setExpired(true);
        return { token, p, word: `${label(wordStart + token)}…` };
      }
    })).then(done => setAlternatives(current => ({ ...current, [selected]: done })));
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="citation-panel token-panel">
    <p className="token-summary">{lead}<b>Confidenza {percent(score)} · {verdict}</b> · {uncertain.length} {uncertain.length === 1 ? "parola incerta" : "parole incerte"}</p>
    <WordText tokens={trace.tokens} selected={selected} onSelect={setSelected} />
    {word && <div className="token-choice">
      <span className="token-chosen">«{label(word.text)}» <b>{percent(trace.tokens[word.decision].p)}</b></span>
      <span className="token-or">invece di</span>
      {(alternatives[selected!] ?? []).map(option => <button type="button" key={option.token} disabled={branching || option.word === null}
        onClick={() => onBranch(word.decision, option.token, label(word.text), option.word ?? option.token)} title="Riprendi la risposta con questa parola">
        «{option.word ?? `${label(option.token)}…`}» {percent(option.p)}
      </button>)}
    </div>}
    {expired && <p className="token-branching">Contesto scaduto: rigenera la risposta per alternative complete e rami.</p>}
    {branching && <p className="token-branching">Genero il ramo…</p>}
    {uncertain.length > 1 && <details className="token-forks"><summary>Parole incerte</summary>
      {uncertain.map(({ word: item, index }) => <button type="button" key={index} className={selected === index ? "active" : ""} onClick={() => setSelected(index)}>«{label(item.text)}» · sicurezza {percent(item.top)}</button>)}
    </details>}
    {branches.map((branch, index) => <div key={index} className="token-branch">
      <p className="token-branch-head">Ramo {index + 1} · «{branch.from}» → «{branch.to ?? branch.token.trim()}»</p>
      <WordText tokens={branch.tokens} lead={`…${trace.tokens.slice(Math.max(0, branch.at - 10), branch.at).map(item => item.t).join("")}${branch.token}`} />
    </div>)}
  </div>;
}
