import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { MarkdownMessage } from "./MarkdownMessage";
import { userErrorMessage } from "../utils/errors";

type Fonte = "saved" | "liked";
interface Post { id: string; url: string; author: string; caption: string; takenAt?: string; sources: Fonte[]; images: string[]; transcript?: string; summary?: string; error?: string }
type Passo = "lista" | "media" | "trascrizione" | "riassunto" | "salvataggio" | "";
interface Stato { running: boolean; passo: Passo; corrente: string; fatti: number; totale: number; utente: string; ultimo: string; errori: string[]; sessione: boolean; sessioneFine: string; modello: string; limite: number }
type Scelta = "liked" | "saved" | "entrambi";
const SCELTE: Array<{ key: Scelta; label: string; fonti: Fonte[] }> = [{ key: "liked", label: "Mi piace", fonti: ["liked"] }, { key: "saved", label: "Salvati", fonti: ["saved"] }, { key: "entrambi", label: "Entrambi", fonti: ["saved", "liked"] }];
const leggi = (key: string) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const scrivi = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage non disponibile */ } };

const PASSI: Array<{ key: Passo; label: string }> = [{ key: "media", label: "Estrai video" }, { key: "trascrizione", label: "Testo video" }, { key: "riassunto", label: "Riassunto" }, { key: "salvataggio", label: "Invio" }];

type Tab = "tutti" | "entrambi" | Fonte;
const TABS: Array<{ key: Tab; label: string }> = [{ key: "tutti", label: "Tutti" }, { key: "saved", label: "Salvati" }, { key: "liked", label: "Mi piace" }, { key: "entrambi", label: "Entrambi" }];
const inTab = (post: Post, tab: Tab) => tab === "tutti" || (tab === "entrambi" ? post.sources.includes("saved") && post.sources.includes("liked") : post.sources.includes(tab));

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, { method: init?.method || "GET", headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const data = (iso?: string) => iso ? new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }) : "";
// Titolo della riga: la frase "In breve" del riassunto, altrimenti l'inizio della didascalia.
const titolo = (post: Post) => (post.summary?.match(/In breve:\**\s*(.+)/)?.[1] ?? post.caption.split("\n")[0] ?? "").replace(/\*+/g, "").slice(0, 140) || "Senza testo";

export function SocialPanel() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [stato, setStato] = useState<Stato>();
  const [tab, setTab] = useState<Tab>("tutti");
  const [aperto, setAperto] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [scelta, setScelta] = useState<Scelta>(() => (SCELTE.find(item => item.key === leggi("social.fonti"))?.key ?? "entrambi"));
  const [limite, setLimite] = useState(() => leggi("social.limite"));

  const ricarica = useCallback(async () => {
    try { const result = await api<{ posts: Post[]; stato: Stato }>("/api/social"); setPosts(result.posts); setStato(result.stato); }
    catch (caught) { setError(userErrorMessage(caught, "Elenco non disponibile.")); }
  }, []);

  useEffect(() => { void ricarica(); }, [ricarica]);
  useEffect(() => {
    if (!stato?.running) return;
    const timer = window.setInterval(() => void ricarica(), 2000);
    return () => window.clearInterval(timer);
  }, [stato?.running, ricarica]);

  async function esegui(key: string, task: () => Promise<unknown>) {
    setBusy(key); setError("");
    try { await task(); await ricarica(); }
    catch (caught) { setError(userErrorMessage(caught, "Operazione non riuscita.")); }
    finally { setBusy(undefined); }
  }

  const sincronizza = () => esegui("sync", () => api("/api/social/sincronizza", { method: "POST", body: { fonti: SCELTE.find(item => item.key === scelta)?.fonti, limite: Number(limite) || undefined } }));
  const scegli = (key: Scelta) => { setScelta(key); scrivi("social.fonti", key); };
  const cambiaLimite = (value: string) => { const pulito = value.replace(/\D/g, "").slice(0, 3); setLimite(pulito); scrivi("social.limite", pulito); };
  const rigenera = (post: Post) => esegui(post.id, () => api(`/api/social/${post.id}/riassunto`, { method: "POST", body: {} }));
  const elimina = (post: Post) => esegui(post.id, () => api(`/api/social/${post.id}`, { method: "DELETE" }));

  const visibili = posts.filter(post => inTab(post, tab));
  const conteggio = (key: Tab) => posts.filter(post => inTab(post, key)).length;

  return (
    <div className="social-panel">
      <div className="social-bar">
        <div className="cand-status">
          <span className={stato?.sessione ? "ok" : "ko"}>{stato?.sessione ? stato.utente ? `@${stato.utente}` : "Sessione" : "INSTAGRAM_SESSIONID mancante in .env"}</span>
          {stato?.sessione && <span className="social-key" title="INSTAGRAM_SESSIONID"><span aria-hidden="true">••••••••••••</span>{stato.sessioneFine}</span>}
          {stato?.ultimo && <span>Ultimo {new Date(stato.ultimo).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
        <div className="cand-actions social-opzioni">
          {SCELTE.map(item => <label key={item.key} className="social-check"><input type="checkbox" checked={scelta === item.key} disabled={stato?.running} onChange={() => scegli(item.key)} />{item.label}</label>)}
          <label className="social-check">Max<input type="text" inputMode="numeric" className="social-max" value={limite} placeholder={String(stato?.limite ?? 30)} disabled={stato?.running} onChange={event => cambiaLimite(event.target.value)} /></label>
          <button type="button" className="go" onClick={sincronizza} disabled={!!busy || !stato?.sessione || stato.running}><RefreshCw size={15} className={stato?.running ? "spin" : undefined} /> Sincronizza</button>
        </div>
      </div>
      {stato?.running && <Avanzamento stato={stato} />}
      {error && <p className="cand-error">{error}</p>}
      {stato?.errori.map(item => <p key={item} className="cand-error">{item}</p>)}
      <div className="cand-tabs" role="tablist">
        {TABS.map(entry => <button key={entry.key} type="button" role="tab" aria-selected={tab === entry.key} className={tab === entry.key ? "active" : ""} onClick={() => setTab(entry.key)}>{entry.label} {conteggio(entry.key)}</button>)}
      </div>
      <div className="cand-list social-list">
        {!visibili.length && <p className="cand-empty">Vuoto.</p>}
        {visibili.map(post => {
          const open = aperto === post.id;
          return (
            <div key={post.id} className={`cand-item${post.error ? " due" : ""}`}>
              <button type="button" className="cand-head" onClick={() => setAperto(open ? undefined : post.id)} aria-expanded={open}>
                {post.images[0] ? <img className="social-thumb" src={post.images[0]} alt="" loading="lazy" /> : <span className="social-thumb" />}
                <span className="cand-title"><strong>{titolo(post)}</strong><small>@{post.author} · {data(post.takenAt)}{post.transcript ? " · video" : ""}</small></span>
                {post.sources.map(source => <span key={source} className="cand-badge">{source === "saved" ? "salvato" : "♥"}</span>)}
                {!post.summary && !post.error && <span className="cand-badge">…</span>}
              </button>
              {open && (
                <div className="cand-body">
                  {post.error && <p className="cand-error">{post.error}</p>}
                  <div className={`social-content${post.images.length === 1 ? " single" : ""}`}>
                    {post.images.length > 0 && <div className="social-gallery">{post.images.map(src => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" loading="lazy" /></a>)}</div>}
                    {post.summary && <div className="social-summary"><MarkdownMessage content={post.summary} privateMode={false} /></div>}
                  </div>
                  <div className="cand-actions">
                    <a href={post.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Instagram</a>
                    <button type="button" disabled={!!busy} onClick={() => rigenera(post)}><Wand2 size={14} /> {busy === post.id ? "…" : "Rigenera"}</button>
                    <button type="button" disabled={!!busy} onClick={() => elimina(post)} aria-label="Elimina" title="Elimina"><Trash2 size={14} /></button>
                  </div>
                  {post.caption && <details className="social-text"><summary>Didascalia</summary><p>{post.caption}</p></details>}
                  {post.transcript && <details className="social-text"><summary>Trascrizione</summary><p>{post.transcript}</p></details>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Barra generale (post finiti / totale) e i quattro passi del post in lavorazione. */
function Avanzamento({ stato }: { stato: Stato }) {
  if (stato.passo === "lista" || !stato.totale) return <div className="social-progress"><div className="social-progress-head"><strong>Leggo i post…</strong></div><div className="social-progress-bar is-indeterminate"><span /></div></div>;
  const attuale = PASSI.findIndex(item => item.key === stato.passo);
  return (
    <div className="social-progress">
      <div className="social-progress-head"><strong>{Math.min(stato.fatti + 1, stato.totale)}/{stato.totale} post</strong><span>{stato.corrente}</span></div>
      <div className="social-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={stato.totale} aria-valuenow={stato.fatti}><span style={{ width: `${(stato.fatti / stato.totale) * 100}%` }} /></div>
      <ol className="social-steps">
        {PASSI.map((item, index) => <li key={item.key} className={index < attuale ? "done" : index === attuale ? "now" : undefined}>{index < attuale ? "✓" : index === attuale ? <span className="social-dot" /> : index + 1} {item.label}</li>)}
      </ol>
    </div>
  );
}
