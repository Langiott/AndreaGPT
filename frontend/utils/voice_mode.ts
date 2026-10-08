import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Conversazione a voce: ascolta (riconoscimento vocale del browser, testo in tempo reale),
 * alla pausa invia il messaggio, legge la risposta a frasi mentre arriva e poi torna ad ascoltare.
 * La chat resta quella testuale: qui si aggiungono solo microfono e voce.
 */

interface Riconoscimento {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; abort(): void;
}
type CostruttoreRiconoscimento = new () => Riconoscimento;

const Riconoscitore = (): CostruttoreRiconoscimento | undefined => {
  const w = window as unknown as { SpeechRecognition?: CostruttoreRiconoscimento; webkitSpeechRecognition?: CostruttoreRiconoscimento };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export type FaseVoce = "" | "ascolto" | "attesa" | "parla";

/** Toglie dal Markdown ciò che non si legge ad alta voce: codice, link, simboli. */
function perVoce(testo: string) {
  return testo
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~>|#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fine dell'ultima frase completa dopo `da`, mai dentro un blocco di codice. */
function fineFrase(testo: string, da: number) {
  const recinti = [...testo.matchAll(/```/g)].map(match => match.index ?? 0);
  let fine = da;
  for (const match of testo.slice(da).matchAll(/[.!?](?=\s)|\n/g)) {
    const posizione = da + (match.index ?? 0) + match[0].length;
    if (recinti.filter(indice => indice < posizione).length % 2 === 0) fine = posizione;
  }
  return fine;
}

function vocaleItaliana() {
  const voci = window.speechSynthesis.getVoices().filter(voce => voce.lang.toLowerCase().startsWith("it"));
  return voci.find(voce => /natural|online|neural/i.test(voce.name)) ?? voci.find(voce => /google/i.test(voce.name)) ?? voci[0];
}

interface Opzioni {
  /** Ultimo messaggio dell'assistente (quello in arrivo durante lo streaming). */
  risposta?: { id: string; content: string };
  loading: boolean;
  invia: (testo: string) => Promise<unknown> | unknown;
  onErrore: (messaggio: string) => void;
}

export function useVoiceMode({ risposta, loading, invia, onErrore }: Opzioni) {
  const supportata = typeof window !== "undefined" && Boolean(Riconoscitore()) && "speechSynthesis" in window;
  const [attiva, setAttiva] = useState(false);
  const [fase, setFase] = useState<FaseVoce>("");
  const [parziale, setParziale] = useState("");
  const [giro, setGiro] = useState(0);

  const attivaRef = useRef(false);
  const riconoscimento = useRef<Riconoscimento | null>(null);
  const inviaRef = useRef(invia);
  const erroreRef = useRef(onErrore);
  inviaRef.current = invia;
  erroreRef.current = onErrore;
  // Stato del giro corrente: risposta attesa, ultimo messaggio prima dell'invio, caratteri già letti.
  const attesa = useRef(false);
  const finita = useRef(false);
  const base = useRef<string | undefined>(undefined);
  const letti = useRef(0);
  const inLettura = useRef(new Set<SpeechSynthesisUtterance>());
  const ultimaRisposta = useRef<string | undefined>(undefined);
  ultimaRisposta.current = risposta?.id;

  const ascolta = useCallback(() => {
    const Costruttore = Riconoscitore();
    if (!attivaRef.current || !Costruttore || riconoscimento.current) return;
    const rec = new Costruttore();
    rec.lang = "it-IT";
    rec.interimResults = true;
    rec.continuous = false; // si chiude da solo alla pausa: è il segnale di invio
    let finale = "", ultimo = "", bloccante = false;
    rec.onresult = event => {
      let provvisorio = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const risultato = event.results[index];
        if (risultato.isFinal) finale += risultato[0].transcript; else provvisorio += risultato[0].transcript;
      }
      ultimo = `${finale}${provvisorio}`;
      setParziale(ultimo);
    };
    rec.onerror = event => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      bloccante = true;
      ferma();
      erroreRef.current(event.error === "not-allowed" || event.error === "service-not-allowed" ? "Microfono non consentito: abilitalo nel browser." : event.error === "audio-capture" ? "Nessun microfono disponibile." : `Riconoscimento vocale: ${event.error}.`);
    };
    rec.onend = () => {
      riconoscimento.current = null;
      if (bloccante) { ferma(); return; }
      if (!attivaRef.current) return;
      const testo = (finale || ultimo).trim();
      setParziale("");
      if (!testo) { ascolta(); return; }
      attesa.current = true; finita.current = false; letti.current = 0; base.current = ultimaRisposta.current;
      setFase("attesa");
      void Promise.resolve(inviaRef.current(testo)).catch(() => undefined).finally(() => { finita.current = true; setGiro(value => value + 1); });
    };
    riconoscimento.current = rec;
    setFase("ascolto");
    try { rec.start(); } catch { riconoscimento.current = null; }
  }, []);

  const parla = useCallback((testo: string) => {
    const frase = perVoce(testo);
    if (!frase) return;
    const voce = new SpeechSynthesisUtterance(frase);
    const vocale = vocaleItaliana();
    voce.lang = vocale?.lang ?? "it-IT";
    if (vocale) voce.voice = vocale;
    const chiudi = () => {
      inLettura.current.delete(voce);
      if (inLettura.current.size || !attivaRef.current) return;
      if (attesa.current) setFase("attesa"); else ascolta();
    };
    voce.onend = chiudi;
    voce.onerror = chiudi;
    inLettura.current.add(voce); // tenuto in un Set: Chrome perde onend se l'oggetto viene raccolto
    setFase("parla");
    window.speechSynthesis.speak(voce);
  }, [ascolta]);

  const ferma = useCallback(() => {
    attivaRef.current = false;
    attesa.current = false;
    setAttiva(false); setFase(""); setParziale("");
    riconoscimento.current?.abort();
    riconoscimento.current = null;
    inLettura.current.clear();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const toggle = useCallback(() => {
    if (attivaRef.current) { ferma(); return; }
    if (!supportata) { erroreRef.current("Modalità voce non supportata da questo browser: usa Chrome, Edge o Safari."); return; }
    attivaRef.current = true;
    setAttiva(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.getVoices(); // carica le voci: alcuni browser le danno solo dopo la prima richiesta
    ascolta();
  }, [ascolta, ferma, supportata]);

  // Legge la risposta a frasi mentre arriva; a stream finito legge il resto e torna ad ascoltare.
  useEffect(() => {
    if (!attivaRef.current || !attesa.current) return;
    const mia = risposta && risposta.id !== base.current ? risposta : undefined;
    const completa = finita.current && !loading;
    if (mia) {
      const fine = completa ? mia.content.length : fineFrase(mia.content, letti.current);
      if (fine > letti.current) { parla(mia.content.slice(letti.current, fine)); letti.current = fine; }
    }
    if (completa) {
      attesa.current = false;
      if (!inLettura.current.size) ascolta();
    }
  }, [risposta?.id, risposta?.content, loading, giro, risposta, parla, ascolta]);

  useEffect(() => () => { attivaRef.current = false; riconoscimento.current?.abort(); if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  return { supportata, attiva, fase, parziale, toggle, ferma };
}
