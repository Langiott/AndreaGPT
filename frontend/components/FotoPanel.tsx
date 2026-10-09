import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CheckCheck, ChevronLeft, ChevronRight, ImagePlus, Link2, Maximize, Minimize, RefreshCw, Search, Square, Trash2, X } from "lucide-react";
import { userErrorMessage } from "../utils/errors";

type Passo = "" | "collegamento" | "elenco" | "analisi" | "volti";
interface Stato { running: boolean; passo: Passo; fatti: number; totale: number; foto: number; errori: string[]; ultimo: string; collegato: boolean; dispositivo: string; ip: string; porta: number | ""; categorie: Record<string, number> }
interface Persona { id: number; nome: string; copertina: number; n: number }
interface Foto { id: number; data: number; categoria: string }
interface Volto { id: number; persona: number | null; nome: string | null; confermato: number }
interface Dettaglio { id: number; remoto: string; scattata: number; categoria: string; tag: string; testo: string; volti: Volto[] }

const PAGINA = 120;
const VOLTI_RIGA = 10;
const PASSI: Record<Passo, string> = { "": "", collegamento: "Collego…", elenco: "Leggo la galleria…", analisi: "Analisi", volti: "Raggruppo i volti…" };

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
const leggi = (key: string) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const data = (secondi?: number) => secondi ? new Date(secondi * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "";
const thumb = (id: number) => `/media/foto/thumbs/${id}.jpg`;
const volto = (id: number) => `/media/foto/volti/${id}.jpg`;

export function FotoPanel() {
  const [stato, setStato] = useState<Stato>();
  const [persone, setPersone] = useState<Persona[]>([]);
  const [foto, setFoto] = useState<Foto[]>([]);
  const [totale, setTotale] = useState(0);
  const [q, setQ] = useState("");
  const [cerca, setCerca] = useState("");
  const [persona, setPersona] = useState<number>();
  const [categoria, setCategoria] = useState("");
  const [aperta, setAperta] = useState<number>();
  const [selezione, setSelezione] = useState<Set<number>>(new Set());
  const [chiediElimina, setChiediElimina] = useState<number[]>();
  // Clic singolo apre (dopo una breve attesa per riconoscere il doppio clic); doppio clic o tocco lungo seleziona.
  const tocco = useRef<{ timer?: number; lungo?: boolean }>({});
  const [collega, setCollega] = useState(false);
  const [error, setError] = useState("");
  const [tuttiVolti, setTuttiVolti] = useState(false);
  const [intero, setIntero] = useState(() => leggi("foto.intero") === "1");
  const fattiVisti = useRef(0);
  const fondo = useRef<HTMLDivElement>(null);
  // Comandi nell'intestazione della finestra, accanto al titolo (slot della Modal).
  const [testata, setTestata] = useState<HTMLElement | null>(null);
  useEffect(() => { setTestata(document.getElementById("foto-modal-actions")); }, []);
  // Schermo intero: classe sulla finestra che contiene il pannello, ricordata tra un'apertura e l'altra.
  useEffect(() => {
    testata?.closest(".modal")?.classList.toggle("foto-intero", intero);
    try { localStorage.setItem("foto.intero", intero ? "1" : "0"); } catch { /* storage non disponibile */ }
  }, [testata, intero]);

  const ricaricaStato = useCallback(async () => {
    try { setStato(await api<Stato>("/api/foto/stato")); } catch (caught) { setError(userErrorMessage(caught, "Stato non disponibile.")); }
  }, []);
  const ricaricaPersone = useCallback(async () => {
    try { setPersone((await api<{ persone: Persona[] }>("/api/foto/persone")).persone); } catch { /* indice ancora vuoto */ }
  }, []);
  const carica = useCallback(async (offset: number) => {
    const params = new URLSearchParams({ q: cerca, offset: String(offset), limit: String(PAGINA) });
    if (persona) params.set("persona", String(persona));
    // Con una persona scelta valgono tutte le sue foto, anche quelle classificate come screenshot o schermo.
    else if (categoria) params.set("categoria", categoria);
    try {
      const result = await api<{ foto: Foto[]; totale: number }>(`/api/foto/lista?${params}`);
      setFoto(prev => offset ? [...prev, ...result.foto] : result.foto);
      setTotale(result.totale);
    } catch (caught) { setError(userErrorMessage(caught, "Ricerca non riuscita.")); }
  }, [cerca, persona, categoria]);

  useEffect(() => { void ricaricaStato(); void ricaricaPersone(); }, [ricaricaStato, ricaricaPersone]);
  useEffect(() => { void carica(0); }, [carica]);
  useEffect(() => { if (categoria === "persone") void ricaricaPersone(); }, [categoria, ricaricaPersone]);
  useEffect(() => { const timer = window.setTimeout(() => setCerca(q.trim()), 350); return () => window.clearTimeout(timer); }, [q]);
  useEffect(() => {
    const timer = window.setInterval(() => void ricaricaStato(), stato?.running ? 2000 : 20000);
    return () => window.clearInterval(timer);
  }, [stato?.running, ricaricaStato]);
  // Durante l'analisi griglia e volti si aggiornano a blocchi; alla fine un'ultima volta.
  useEffect(() => {
    if (!stato) return;
    if (!stato.running || stato.fatti - fattiVisti.current >= 40) {
      if (fattiVisti.current !== stato.fatti || !stato.running) { void carica(0); void ricaricaPersone(); }
      fattiVisti.current = stato.running ? stato.fatti : 0;
    }
  }, [stato?.running, stato?.fatti]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const nodo = fondo.current;
    if (!nodo || foto.length >= totale) return;
    const osservatore = new IntersectionObserver(entries => { if (entries[0].isIntersecting) void carica(foto.length); }, { rootMargin: "600px" });
    osservatore.observe(nodo);
    return () => osservatore.disconnect();
  }, [foto.length, totale, carica]);

  async function azione(task: () => Promise<unknown>) {
    setError("");
    try { await task(); } catch (caught) { setError(userErrorMessage(caught, "Operazione non riuscita.")); }
  }
  function alterna(id: number) {
    setSelezione(prev => { const nuova = new Set(prev); if (!nuova.delete(id)) nuova.add(id); return nuova; });
  }
  async function elimina(ids: number[]) {
    await azione(async () => {
      await api("/api/foto/elimina", { ids });
      setSelezione(new Set());
      setAperta(undefined);
      await Promise.all([carica(0), ricaricaPersone(), ricaricaStato()]);
    });
  }
  const selezionata = persone.find(item => item.id === persona);
  const visibili = persone;
  const categorie = Object.entries(stato?.categorie ?? {});

  const comandi = (
    <div className="foto-testata">
      <label className="foto-cerca"><Search size={14} /><input type="search" value={q} placeholder="Cerca…" aria-label="Cerca foto" onChange={event => setQ(event.target.value)} />{q && <button type="button" aria-label="Pulisci" onClick={() => setQ("")}><X size={13} /></button>}</label>
      <button type="button" className="foto-tasto foto-icona" onClick={() => setIntero(!intero)} aria-label={intero ? "Riduci" : "Schermo intero"} title={intero ? "Riduci" : "Schermo intero"}>{intero ? <Minimize size={14} /> : <Maximize size={14} />}</button>
      <button type="button" className={`foto-tasto${collega ? " active" : ""}`} onClick={() => setCollega(!collega)} aria-expanded={collega} title={stato?.collegato ? `Collegato · ${stato.dispositivo}` : "Non collegato"}>
        <span className={`foto-punto${stato?.collegato ? " ok" : ""}`} /><Link2 size={14} /><span className="foto-etichetta">Collega</span>
      </button>
      <button type="button" className="foto-tasto" disabled={!stato?.collegato || stato.running} onClick={() => azione(async () => { await api("/api/foto/analizza", {}); await ricaricaStato(); })} title="Nuove: foto nuove e cancellate dal telefono">
        <ImagePlus size={14} /><span className="foto-etichetta">Nuove</span>
      </button>
      <button type="button" className="foto-tasto go" disabled={!stato || stato.running} onClick={() => azione(async () => { await api("/api/foto/aggiorna", {}); await ricaricaStato(); })} title="Aggiorna: ricontrolla le persone">
        <RefreshCw size={14} className={stato?.running && stato.passo === "volti" ? "spin" : undefined} /><span className="foto-etichetta">Aggiorna</span>
      </button>
    </div>
  );

  return (
    <div className="foto-panel">
      {testata ? createPortal(comandi, testata) : comandi}
      {collega && <Collega stato={stato} onFatto={async () => { setCollega(false); await ricaricaStato(); }} />}
      {stato?.running && <Avanzamento stato={stato} onFerma={() => azione(() => api("/api/foto/ferma", {}))} />}
      <Avvisi voci={[...(error ? [error] : []), ...(stato?.errori ?? [])]} />

      {categorie.length > 0 && (
        <Schede>
          <button type="button" role="tab" aria-selected={!categoria} className={!categoria ? "active" : ""} onClick={() => { setCategoria(""); setPersona(undefined); }}>Tutte {stato?.foto ?? ""}</button>
          {categorie.map(([nome, n]) => <button key={nome} type="button" role="tab" aria-selected={categoria === nome} className={categoria === nome ? "active" : ""} onClick={() => { setCategoria(categoria === nome ? "" : nome); setPersona(undefined); }}>{nome} {n}</button>)}
        </Schede>
      )}

      {categoria === "persone" && persone.length > 0 && (
        <div className={`foto-volti${tuttiVolti ? " tutti" : ""}`} role="list">
          {visibili.slice(0, tuttiVolti ? undefined : VOLTI_RIGA).concat(!tuttiVolti && visibili.slice(VOLTI_RIGA).some(item => item.id === persona) ? visibili.filter(item => item.id === persona) : []).map(item => (
            <button key={item.id} type="button" role="listitem" className={`foto-volto${persona === item.id ? " active" : ""}`} onClick={() => setPersona(persona === item.id ? undefined : item.id)} title={`${item.nome || "Senza nome"} · ${item.n}`}>
              <img src={volto(item.copertina)} alt="" loading="lazy" />
              <span>{item.nome || "?"}</span>
            </button>
          ))}
          {visibili.length > VOLTI_RIGA && <button type="button" className="foto-altri" onClick={() => setTuttiVolti(!tuttiVolti)} aria-expanded={tuttiVolti}>{tuttiVolti ? "−" : `+${visibili.length - VOLTI_RIGA}`}</button>}
        </div>
      )}
      {selezionata && <SchedaPersona key={selezionata.id} persona={selezionata} persone={persone} onCambio={async (via) => { if (via) setPersona(undefined); await ricaricaPersone(); }} onErrore={setError} />}

      {(cerca || persona || categoria) && <small className="foto-conta">{totale} foto</small>}
      <div className="foto-griglia">
        {foto.map((item, index) => (
          <button key={item.id} type="button" className={selezione.has(item.id) ? "scelta" : undefined} aria-pressed={selezione.size ? selezione.has(item.id) : undefined}
            onClick={() => {
              if (tocco.current.lungo) { tocco.current.lungo = false; return; }
              if (selezione.size) { alterna(item.id); return; }
              window.clearTimeout(tocco.current.timer);
              tocco.current.timer = window.setTimeout(() => setAperta(index), 230);
            }}
            onDoubleClick={() => { window.clearTimeout(tocco.current.timer); if (!selezione.size) alterna(item.id); }}
            onTouchStart={() => { window.clearTimeout(tocco.current.timer); tocco.current.timer = window.setTimeout(() => { tocco.current.lungo = true; alterna(item.id); navigator.vibrate?.(15); }, 450); }}
            onTouchMove={() => window.clearTimeout(tocco.current.timer)}
            onTouchEnd={() => { if (!tocco.current.lungo) window.clearTimeout(tocco.current.timer); }}
            onContextMenu={event => event.preventDefault()}>
            <img src={thumb(item.id)} alt="" loading="lazy" draggable={false} />
            {selezione.has(item.id) && <span className="foto-spunta"><Check size={14} /></span>}
          </button>
        ))}
      </div>
      {!foto.length && <p className="cand-empty">{stato?.foto ? "Nessuna foto." : "Vuoto."}</p>}
      <div ref={fondo} />
      {selezione.size > 0 && (
        <div className="foto-selezione">
          <strong>{selezione.size}</strong>
          <button type="button" onClick={() => setSelezione(new Set(foto.map(item => item.id)))} title="Seleziona tutte quelle caricate"><CheckCheck size={15} /> Tutte</button>
          <button type="button" className="pericolo" onClick={() => setChiediElimina([...selezione])}><Trash2 size={15} /> Elimina</button>
          <button type="button" aria-label="Annulla selezione" onClick={() => setSelezione(new Set())}><X size={15} /></button>
        </div>
      )}
      {chiediElimina && <Dialogo titolo={chiediElimina.length === 1 ? "Eliminare la foto?" : `Eliminare ${chiediElimina.length} foto?`} testo="Tolte dall'app, restano sul telefono." conferma="Elimina" onAnnulla={() => setChiediElimina(undefined)} onOk={() => { const ids = chiediElimina; setChiediElimina(undefined); void elimina(ids); }} />}
      {aperta !== undefined && foto[aperta] && (
        <Visore id={foto[aperta].id} persone={persone} onChiudi={() => setAperta(undefined)} onPrecedente={aperta > 0 ? () => setAperta(aperta - 1) : undefined} onSuccessiva={aperta < foto.length - 1 ? () => setAperta(aperta + 1) : undefined} onCambio={ricaricaPersone} onElimina={id => setChiediElimina([id])} />
      )}
    </div>
  );
}

const indirizzoValido = (value: string) => /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(value.trim());
const soloIndirizzo = (value: string) => value.replace(/[^\d.:]/g, "").slice(0, 21);

/** Schede categoria senza barra di scorrimento: < e > spostano di 4 alla volta. */
function Schede({ children }: { children: React.ReactNode }) {
  const riga = useRef<HTMLDivElement>(null);
  const [inizio, setInizio] = useState(0);
  const [frecce, setFrecce] = useState({ sx: false, dx: false });
  const misura = useCallback(() => {
    const nodo = riga.current;
    if (!nodo) return;
    setFrecce({ sx: nodo.scrollLeft > 2, dx: nodo.scrollLeft + nodo.clientWidth < nodo.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    const nodo = riga.current;
    if (!nodo) return;
    const osservatore = new ResizeObserver(misura);
    osservatore.observe(nodo);
    nodo.addEventListener("scroll", misura, { passive: true });
    misura();
    return () => { osservatore.disconnect(); nodo.removeEventListener("scroll", misura); };
  }, [misura]);
  function sposta(passo: number) {
    const nodo = riga.current;
    if (!nodo) return;
    const schede = [...nodo.children] as HTMLElement[];
    const nuovo = Math.max(0, Math.min(schede.length - 1, inizio + passo));
    setInizio(nuovo);
    nodo.scrollTo({ left: schede[nuovo]?.offsetLeft - schede[0].offsetLeft, behavior: "smooth" });
  }
  return (
    <div className="foto-schede">
      {frecce.sx && <button type="button" className="foto-freccia sx" aria-label="Categorie precedenti" onClick={() => sposta(-4)}><ChevronLeft size={16} /></button>}
      <div ref={riga} className="cand-tabs foto-schede-riga" role="tablist">{children}</div>
      {frecce.dx && <button type="button" className="foto-freccia dx" aria-label="Altre categorie" onClick={() => sposta(4)}><ChevronRight size={16} /></button>}
    </div>
  );
}

/** Avvisi in una card compatta: primi 3, gli altri dietro "+N"; chiusa resta chiusa finché non arrivano avvisi nuovi. */
function Avvisi({ voci }: { voci: string[] }) {
  const [chiusi, setChiusi] = useState<string[]>([]);
  const [tutti, setTutti] = useState(false);
  const nuove = voci.filter(voce => !chiusi.includes(voce));
  if (!nuove.length) return null;
  const visibili = tutti ? nuove : nuove.slice(0, 3);
  return (
    <div className="foto-avvisi" role="status">
      <AlertTriangle size={15} />
      <ul>
        {visibili.map(voce => <li key={voce}>{voce}</li>)}
        {nuove.length > 3 && <li><button type="button" onClick={() => setTutti(!tutti)}>{tutti ? "meno" : `+${nuove.length - 3}`}</button></li>}
      </ul>
      <button type="button" className="foto-avvisi-chiudi" aria-label="Chiudi avvisi" onClick={() => { setChiusi(voci); setTutti(false); }}><X size={14} /></button>
    </div>
  );
}

function Collega({ stato, onFatto }: { stato?: Stato; onFatto: () => Promise<void> }) {
  const [indirizzo, setIndirizzo] = useState(stato?.ip ? `${stato.ip}:${stato.porta}` : leggi("foto.indirizzo"));
  const [associazione, setAssociazione] = useState("");
  const [codice, setCodice] = useState("");
  const [associato, setAssociato] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const puoAssociare = indirizzoValido(associazione) && codice.length === 6;
  async function invia() {
    setBusy(true); setError("");
    try {
      const result = await api<{ associato: boolean; collegato: boolean }>("/api/foto/collega", { indirizzo: indirizzoValido(indirizzo) ? indirizzo.trim() : undefined, associazione: puoAssociare ? associazione.trim() : undefined, codice: puoAssociare ? codice : undefined });
      if (result.associato) { setAssociato(true); setCodice(""); setAssociazione(""); }
      if (result.collegato) {
        try { localStorage.setItem("foto.indirizzo", indirizzo.trim()); } catch { /* storage non disponibile */ }
        await onFatto();
      }
    } catch (caught) { setError(userErrorMessage(caught, "Collegamento non riuscito.")); }
    finally { setBusy(false); }
  }
  return (
    <form className="foto-collega" onSubmit={event => { event.preventDefault(); void invia(); }}>
      <div className="foto-collega-riga">
        <label className="lungo"><span>Debug wireless</span><input inputMode="decimal" value={indirizzo} onChange={event => setIndirizzo(soloIndirizzo(event.target.value))} /></label>
        <label><span>Indirizzo accoppiamento</span><input inputMode="decimal" value={associazione} onChange={event => setAssociazione(soloIndirizzo(event.target.value))} /></label>
        <label className="corto"><span>Codice autenticazione</span><input inputMode="numeric" value={codice} onChange={event => setCodice(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
        <button type="submit" className="go" disabled={busy || (!indirizzoValido(indirizzo) && !puoAssociare)}>{busy ? "…" : puoAssociare && !indirizzoValido(indirizzo) ? "Associa" : "Collega"}</button>
      </div>
      {associato && <small className="foto-associato">Associato ✓</small>}
      {error && <p className="cand-error">{error}</p>}
    </form>
  );
}

function Avanzamento({ stato, onFerma }: { stato: Stato; onFerma: () => void }) {
  const ferma = <button type="button" className="foto-ferma" onClick={onFerma} aria-label="Ferma" title="Ferma"><Square size={12} /></button>;
  if (!["analisi", "volti"].includes(stato.passo) || !stato.totale) return <div className="social-progress"><div className="social-progress-head"><strong>{PASSI[stato.passo] || "…"}</strong>{ferma}</div><div className="social-progress-bar is-indeterminate"><span /></div></div>;
  return (
    <div className="social-progress">
      <div className="social-progress-head"><strong>{stato.fatti}/{stato.totale} {stato.passo === "volti" ? "persone" : "foto"}</strong><span>{Math.round((stato.fatti / stato.totale) * 100)}%</span>{ferma}</div>
      <div className="social-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={stato.totale} aria-valuenow={stato.fatti}><span style={{ width: `${(stato.fatti / stato.totale) * 100}%` }} /></div>
    </div>
  );
}

function SchedaPersona({ persona, persone, onCambio, onErrore }: { persona: Persona; persone: Persona[]; onCambio: (via: boolean) => Promise<void>; onErrore: (message: string) => void }) {
  const [nome, setNome] = useState(persona.nome);
  const [elimina, setElimina] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!persona.nome) input.current?.focus(); }, [persona.nome]);
  async function invia(body: Record<string, unknown>, via = false) {
    try { await api(`/api/foto/persone/${persona.id}`, body); await onCambio(via); }
    catch (caught) { onErrore(userErrorMessage(caught, "Modifica non riuscita.")); }
  }
  const altre = persone.filter(item => item.id !== persona.id);
  return (
    <form className="foto-persona" onSubmit={event => { event.preventDefault(); void invia({ nome }); }}>
      <input ref={input} value={nome} placeholder="Nome" maxLength={60} onChange={event => setNome(event.target.value)} />
      <button type="submit" className="go" disabled={nome.trim() === persona.nome}>Salva</button>
      {altre.length > 0 && (
        <select value="" onChange={event => { if (event.target.value) void invia({ unisci: Number(event.target.value) }, true); }} aria-label="Unisci a">
          <option value="">Unisci a…</option>
          {altre.map(item => <option key={item.id} value={item.id}>{item.nome || `? (${item.n})`}</option>)}
        </select>
      )}
      <button type="button" className="foto-elimina" onClick={() => setElimina(true)}><Trash2 size={14} /> Elimina</button>
      {elimina && <Dialogo volto={persona.copertina} titolo={`Eliminare ${persona.nome || "questa persona"}?`} testo="Volti ignorati anche nelle foto nuove." conferma="Elimina" onOk={() => { setElimina(false); void invia({ nascondi: true }, true); }} onAnnulla={() => setElimina(false)} />}
    </form>
  );
}

function Visore({ id, persone, onChiudi, onPrecedente, onSuccessiva, onCambio, onElimina }: { id: number; persone: Persona[]; onChiudi: () => void; onPrecedente?: () => void; onSuccessiva?: () => void; onCambio: () => Promise<void>; onElimina: (id: number) => void }) {
  const [dettaglio, setDettaglio] = useState<Dettaglio>();
  const [originale, setOriginale] = useState(false);
  const ricarica = useCallback(async () => { try { setDettaglio(await api<Dettaglio>(`/api/foto/${id}`)); } catch { setDettaglio(undefined); } }, [id]);
  useEffect(() => { setOriginale(false); setDettaglio(undefined); void ricarica(); }, [ricarica]);
  useEffect(() => {
    const tasti = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); onChiudi(); }
      else if (event.key === "ArrowLeft") onPrecedente?.();
      else if (event.key === "ArrowRight") onSuccessiva?.();
    };
    window.addEventListener("keydown", tasti, true);
    return () => window.removeEventListener("keydown", tasti, true);
  }, [onChiudi, onPrecedente, onSuccessiva]);
  const [nuovo, setNuovo] = useState<{ volto: number; nome: string }>();
  async function assegna(faccia: Volto, valore: string, nome = "") {
    if (valore === "nuova" && !nome) { setNuovo({ volto: faccia.id, nome: "" }); return; }
    setNuovo(undefined);
    const body = valore === "no" ? { persona: null } : valore === "nuova" ? { persona: "nuova", nome } : { persona: Number(valore) };
    await api(`/api/foto/volti/${faccia.id}`, body).catch(() => undefined);
    await Promise.all([ricarica(), onCambio()]);
  }
  // Portale sul body: dentro la Modal un antenato con transform sposterebbe il position: fixed.
  return createPortal(
    <div className="foto-visore" role="dialog" aria-modal="true" onClick={event => { if (event.target === event.currentTarget) onChiudi(); }}>
      <div className="foto-visore-img">
        <img src={thumb(id)} alt="" className={originale ? "nascosta" : undefined} />
        <img src={`/api/foto/${id}/originale`} alt="" className={originale ? undefined : "nascosta"} onLoad={() => setOriginale(true)} />
        {onPrecedente && <button type="button" className="foto-nav sx" aria-label="Precedente" onClick={onPrecedente}><ChevronLeft size={22} /></button>}
        {onSuccessiva && <button type="button" className="foto-nav dx" aria-label="Successiva" onClick={onSuccessiva}><ChevronRight size={22} /></button>}
        <button type="button" className="foto-chiudi" aria-label="Chiudi" onClick={onChiudi}><X size={20} /></button>
        <button type="button" className="foto-chiudi foto-cestino" aria-label="Elimina foto" title="Elimina" onClick={() => onElimina(id)}><Trash2 size={18} /></button>
      </div>
      {dettaglio && (
        <div className="foto-info">
          <div className="foto-meta"><span>{data(dettaglio.scattata)}</span><span className="cand-badge">{dettaglio.categoria}</span>{dettaglio.tag.split(" ").filter(Boolean).map(tag => <span key={tag} className="cand-badge">{tag}</span>)}</div>
          {dettaglio.volti.length > 0 && (
            <div className="foto-facce">
              {dettaglio.volti.map(faccia => (
                <label key={faccia.id} className="foto-faccia">
                  <img src={volto(faccia.id)} alt="" />
                  {nuovo?.volto === faccia.id ? (
                    <span className="foto-nuovo">
                      <input autoFocus value={nuovo.nome} placeholder="Nome" maxLength={60} onChange={event => setNuovo({ volto: faccia.id, nome: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && nuovo.nome.trim()) void assegna(faccia, "nuova", nuovo.nome.trim()); if (event.key === "Escape") { event.stopPropagation(); setNuovo(undefined); } }} />
                      <button type="button" disabled={!nuovo.nome.trim()} onClick={() => void assegna(faccia, "nuova", nuovo.nome.trim())}>OK</button>
                      <button type="button" aria-label="Annulla" onClick={() => setNuovo(undefined)}><X size={14} /></button>
                    </span>
                  ) : <select value={faccia.persona ?? ""} onChange={event => void assegna(faccia, event.target.value)}>
                    <option value="">{faccia.persona ? "" : "?"}</option>
                    {persone.map(item => <option key={item.id} value={item.id}>{item.nome || `? (${item.n})`}</option>)}
                    {faccia.persona && !persone.some(item => item.id === faccia.persona) && <option value={faccia.persona}>{faccia.nome || "?"}</option>}
                    <option value="nuova">Nuova persona…</option>
                    {faccia.persona && <option value="no">Non è questa persona</option>}
                  </select>}
                </label>
              ))}
            </div>
          )}
          {dettaglio.testo && <details className="social-text"><summary>Testo</summary><p>{dettaglio.testo}</p></details>}
        </div>
      )}
    </div>,
    document.querySelector(".app-shell") ?? document.body,
  );
}

/** Conferma nello stile dell'app (al posto di window.confirm). */
function Dialogo({ volto: copertina, titolo, testo, conferma, onOk, onAnnulla }: { volto?: number; titolo: string; testo?: string; conferma: string; onOk: () => void; onAnnulla: () => void }) {
  useEffect(() => {
    const tasti = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopImmediatePropagation(); onAnnulla(); } };
    window.addEventListener("keydown", tasti, true);
    return () => window.removeEventListener("keydown", tasti, true);
  }, [onAnnulla]);
  return createPortal(
    <div className="foto-dialogo-sfondo" onClick={event => { if (event.target === event.currentTarget) onAnnulla(); }}>
      <div className="foto-dialogo" role="alertdialog" aria-modal="true" aria-label={titolo}>
        {copertina !== undefined && <img src={volto(copertina)} alt="" />}
        <strong>{titolo}</strong>
        {testo && <p>{testo}</p>}
        <div className="foto-dialogo-azioni">
          <button type="button" onClick={onAnnulla}>Annulla</button>
          <button type="button" className="pericolo" autoFocus onClick={onOk}>{conferma}</button>
        </div>
      </div>
    </div>,
    document.querySelector(".app-shell") ?? document.body,
  );
}
