import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Send, Workflow, X } from "lucide-react";
import { userErrorMessage } from "../utils/errors";

type Stato = "nuova" | "inviata" | "scartata" | "risposta" | "colloquio" | "rifiuto";
interface Offerta { id: string; title: string; company: string; location: string; url: string; source: string; email?: string; score?: number; letter?: string; subject?: string; status: Stato; sentAt?: string; followUp?: boolean; followUpAt?: string; error?: string }
interface StatoServizi { cv: { ok: boolean; pdf: boolean; error?: string }; n8n: boolean; workflow: boolean; apiKey: boolean; smtp: boolean; adzuna: boolean }

const TABS: Array<{ key: string; label: string; match: (item: Offerta) => boolean }> = [
  { key: "nuove", label: "Nuove", match: item => item.status === "nuova" },
  { key: "inviate", label: "Inviate", match: item => item.status === "inviata" },
  { key: "esito", label: "Esito", match: item => ["risposta", "colloquio", "rifiuto"].includes(item.status) },
  { key: "scartate", label: "Scartate", match: item => item.status === "scartata" },
];

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, { method: init?.method || "GET", headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const giorni = (iso?: string) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : 0;

export function CandidaturePanel() {
  const [offerte, setOfferte] = useState<Offerta[]>([]);
  const [soglia, setSoglia] = useState(0.62);
  const [elaborazione, setElaborazione] = useState(false);
  const [servizi, setServizi] = useState<StatoServizi>();
  const [tab, setTab] = useState("nuove");
  const [aperta, setAperta] = useState<string>();
  const [bozze, setBozze] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const ricarica = useCallback(async () => {
    try {
      const data = await api<{ offerte: Offerta[]; soglia: number; elaborazione: boolean }>("/api/candidature");
      setOfferte(data.offerte); setSoglia(data.soglia); setElaborazione(data.elaborazione);
    } catch (caught) { setError(userErrorMessage(caught, "Coda non disponibile.")); }
  }, []);

  useEffect(() => {
    void ricarica();
    void api<StatoServizi>("/api/candidature/stato").then(setServizi).catch(() => undefined);
  }, [ricarica]);
  // Mentre il backend calcola punteggi e lettere la lista si aggiorna da sola.
  useEffect(() => {
    if (!elaborazione) return;
    const timer = window.setInterval(() => void ricarica(), 5000);
    return () => window.clearInterval(timer);
  }, [elaborazione, ricarica]);

  async function esegui(key: string, task: () => Promise<unknown>, ok?: string) {
    setBusy(key); setError(""); setNote("");
    try { await task(); if (ok) setNote(ok); await ricarica(); }
    catch (caught) { setError(userErrorMessage(caught, "Operazione non riuscita.")); }
    finally { setBusy(undefined); }
  }

  const creaWorkflow = () => esegui("workflow", async () => {
    await api("/api/candidature/workflow", { method: "POST", body: {} });
    setServizi(await api<StatoServizi>("/api/candidature/stato"));
  }, "Workflow attivi in n8n.");
  const raccogli = () => esegui("raccogli", async () => { await api("/api/candidature/raccogli", { method: "POST", body: {} }); window.setTimeout(() => void ricarica(), 8000); }, "Raccolta avviata.");
  const testo = (item: Offerta) => bozze[item.id] ?? item.letter ?? "";
  const invia = (item: Offerta) => esegui(item.id, () => api(`/api/candidature/${item.id}/invia`, { method: "POST", body: { letter: testo(item) } }), item.status === "inviata" ? "Follow-up inviato." : "Inviata.");
  const stato = (item: Offerta, status: Stato) => esegui(item.id, () => api(`/api/candidature/${item.id}`, { method: "PATCH", body: { status, letter: bozze[item.id] } }));
  const genera = (item: Offerta, tipo: "candidatura" | "followup") => esegui(item.id, async () => {
    const { letter } = await api<{ letter: string }>(`/api/candidature/${item.id}/lettera`, { method: "POST", body: { tipo } });
    setBozze(current => ({ ...current, [item.id]: letter }));
  });
  async function candidatiDalLink(item: Offerta) {
    await navigator.clipboard.writeText(testo(item)).catch(() => undefined);
    window.open(item.url, "_blank", "noopener");
    await stato(item, "inviata");
  }

  const pronto = servizi?.workflow && servizi.cv.ok;
  const visibili = offerte.filter(TABS.find(entry => entry.key === tab)!.match);
  const conteggio = (key: string) => offerte.filter(TABS.find(entry => entry.key === key)!.match).length;
  const inviateOggi = offerte.filter(item => item.sentAt?.startsWith(new Date().toISOString().slice(0, 10))).length;

  return (
    <div className="cand-panel">
      <div className="cand-status">
        <span className={servizi?.cv.ok ? "ok" : "ko"}>CV {servizi?.cv.ok ? servizi.cv.pdf ? "PDF" : "senza PDF" : "assente"}</span>
        <span className={servizi?.n8n ? "ok" : "ko"}>n8n {servizi?.n8n ? "on" : servizi?.apiKey ? "off" : "senza API key"}</span>
        <span className={servizi?.smtp ? "ok" : "ko"}>SMTP {servizi?.smtp ? "ok" : "mancante"}</span>
        <span className={servizi?.adzuna ? "ok" : "warn"}>Adzuna {servizi?.adzuna ? "ok" : "off · solo Remotive"}</span>
        <span className={servizi?.workflow ? "ok" : "ko"}>Workflow {servizi?.workflow ? "attivi" : "da creare"}</span>
        <span>Oggi {inviateOggi} inviate</span>
        {elaborazione && <span className="warn">Punteggi/lettere in corso…</span>}
      </div>
      <div className="cand-actions">
        <button type="button" onClick={creaWorkflow} disabled={!!busy}><Workflow size={15} /> {servizi?.workflow ? "Ricrea workflow" : "Crea workflow n8n"}</button>
        <button type="button" onClick={raccogli} disabled={!!busy || !pronto}><RefreshCw size={15} /> Raccogli ora</button>
      </div>
      {servizi?.cv.error && <p className="cand-error">{servizi.cv.error}</p>}
      {error && <p className="cand-error">{error}</p>}
      {note && <p className="cand-note">{note}</p>}
      <div className="cand-tabs" role="tablist">
        {TABS.map(entry => <button key={entry.key} type="button" role="tab" aria-selected={tab === entry.key} className={tab === entry.key ? "active" : ""} onClick={() => setTab(entry.key)}>{entry.label} {conteggio(entry.key)}</button>)}
      </div>
      <div className="cand-list">
        {!visibili.length && <p className="cand-empty">Vuoto.</p>}
        {visibili.map(item => {
          const open = aperta === item.id;
          const sotto = (item.score ?? 0) < soglia;
          return (
            <div key={item.id} className={`cand-item${sotto ? " weak" : ""}${item.followUp ? " due" : ""}`}>
              <button type="button" className="cand-head" onClick={() => setAperta(open ? undefined : item.id)} aria-expanded={open}>
                <span className="cand-score">{item.score === undefined ? "…" : `${Math.round(item.score * 100)}`}</span>
                <span className="cand-title"><strong>{item.title}</strong><small>{item.company || "—"} · {item.location || "—"} · {item.source}{item.email ? " · email" : " · link"}</small></span>
                {item.status === "inviata" && <span className="cand-badge">{item.followUp ? "follow-up" : `${giorni(item.sentAt)}g`}</span>}
                {item.status === "nuova" && item.letter && <span className="cand-badge">lettera</span>}
              </button>
              {open && (
                <div className="cand-body">
                  {item.error && <p className="cand-error">{item.error}</p>}
                  <textarea value={testo(item)} onChange={event => setBozze(current => ({ ...current, [item.id]: event.target.value }))} rows={10} placeholder="Nessuna lettera" />
                  <div className="cand-actions">
                    {item.status === "nuova" && <>
                      {item.email && <button type="button" className="go" disabled={!!busy || !testo(item) || !servizi?.cv.pdf} onClick={() => invia(item)}><Send size={14} /> Invia a {item.email}</button>}
                      <button type="button" disabled={!!busy || !testo(item)} onClick={() => candidatiDalLink(item)}><ExternalLink size={14} /> Link + copia lettera</button>
                      <button type="button" disabled={!!busy} onClick={() => genera(item, "candidatura")}>{item.letter ? "Rigenera" : "Genera lettera"}</button>
                      <button type="button" disabled={!!busy} onClick={() => stato(item, "scartata")}><X size={14} /> Scarta</button>
                    </>}
                    {item.status === "inviata" && <>
                      {item.email && !item.followUpAt && <button type="button" disabled={!!busy} onClick={() => genera(item, "followup")}>Bozza follow-up</button>}
                      {item.email && !item.followUpAt && bozze[item.id] && <button type="button" className="go" disabled={!!busy} onClick={() => invia(item)}><Send size={14} /> Invia follow-up</button>}
                      <button type="button" disabled={!!busy} onClick={() => stato(item, "risposta")}>Risposta</button>
                      <button type="button" disabled={!!busy} onClick={() => stato(item, "colloquio")}>Colloquio</button>
                      <button type="button" disabled={!!busy} onClick={() => stato(item, "rifiuto")}>Rifiuto</button>
                    </>}
                    {item.status === "scartata" && <button type="button" disabled={!!busy} onClick={() => stato(item, "nuova")}>Ripristina</button>}
                    <a href={item.url} target="_blank" rel="noopener noreferrer">Annuncio</a>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
