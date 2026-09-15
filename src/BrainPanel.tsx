import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileText, Folder, Search } from "lucide-react";

interface BrainStatus {
  sources?: Array<{ id: string; name?: string; error?: string; chunks?: number }>;
  error?: string;
  root?: string;
  model?: string;
  files?: number;
  indexing?: boolean;
  errors?: Array<{ path: string; error: string }>;
  indexedAt?: string;
  chunks?: number;
}

export function BrainPanel({ locked, source, onSource }: {
  locked: boolean; source: string;
  onSource: (value: string) => void;
}) {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const matching = (status?.sources ?? []).filter(item => item.id.toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT")));
    const map = new Map<string, typeof matching>();
    for (const item of matching) {
      const parts = item.id.split("/");
      const group = parts[0] === "progetti" && parts[1] ? parts[1] : "Documenti personali";
      map.set(group, [...(map.get(group) ?? []), item]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [status?.sources, query]);

  async function refresh() {
    const response = await fetch("/api/brain/status");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Stato Brain non disponibile.");
    setStatus(data);
  }
  useEffect(() => { void refresh().catch((e) => setError(String(e.message))); }, []);

  async function run(action: "index" | "import" | "status") {
    setBusy(true);
    setError("");
    try {
      if (action !== "status") {
        const response = await fetch(`/api/brain/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "import" ? { url: url.trim() } : {}) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Operazione Brain fallita.");
      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Brain non disponibile."); }
    finally { setBusy(false); }
  }

  return <section className="brain-panel">
    <div className="brain-overview"><div><strong>{status?.files ?? 0}</strong><span>File indicizzati</span></div><div><strong>{status?.chunks ?? 0}</strong><span>Estratti disponibili</span></div><div><strong>{groups.length}</strong><span>Raccolte</span></div></div>
    <p className="brain-note">Esplora ciò che Brain può consultare. Seleziona un file o un progetto per limitare la ricerca, oppure usa tutto l'archivio.</p>
    <p role="status" className="brain-status">{busy || status?.indexing ? "Operazione in corso: indicizzazione ed embedding possono richiedere tempo." : status?.indexedAt ? `Ultimo aggiornamento: ${new Date(status.indexedAt).toLocaleString("it-IT")}` : "Indice non ancora creato"}</p>
    {status?.root && <p className="brain-note">Fonti locali: {status.root}<br />Embedding: {status.model}</p>}
    {(error || status?.error) && <p className="error-banner" role="alert">{error || status?.error}</p>}
    <div className="brain-filter-row"><button className={!source ? "active" : ""} onClick={() => onSource("")} disabled={locked}>Tutte le fonti</button>{source && <span>Filtro attivo: <strong>{source}</strong></span>}</div>
    {!!status?.errors?.length && <ul className="brain-source-list">{status.errors.map((item, i) => <li key={`${item.path}-${i}`}><strong>{item.path}</strong>: {item.error}</li>)}</ul>}
    <label className="brain-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca file o progetto..." /></label>
    <div className="brain-explorer">{groups.map(([group, items]) => <details className="brain-group" key={group} open={Boolean(query) || source.includes(group)}><summary><ChevronRight size={15} /><Folder size={18} /><span><strong>{group}</strong><small>{items.length} file · {items.reduce((sum, item) => sum + (item.chunks ?? 0), 0)} estratti</small></span><button type="button" className={source === `progetti/${group}` ? "active" : ""} onClick={(e) => { e.preventDefault(); onSource(group === "Documenti personali" ? "" : `progetti/${group}`); }}>Usa progetto</button></summary><div className="brain-files">{items.map(item => <button type="button" key={item.id} className={source === item.id ? "active" : ""} onClick={() => onSource(item.id)}><FileText size={15} /><span>{item.id.split("/").at(-1)}</span><small>{item.chunks ?? 0}</small></button>)}</div></details>)}{status && !groups.length && <p className="empty-search">Nessun file trovato.</p>}</div>
    <div className="brain-actions"><button onClick={() => void run("status")} disabled={busy}>Aggiorna stato</button><button onClick={() => void run("index")} disabled={busy || locked}>Reindicizza</button></div>
    <form onSubmit={(e) => { e.preventDefault(); void run("import"); }}>
      <label className="brain-field">Repository GitHub opzionale<input type="url" required maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" /></label>
      <button className="primary-action" disabled={busy || locked || !url.trim()}>Importa repository</button>
      <p className="brain-note">Dopo l'importazione premi Reindicizza per includere il repository nel retrieval.</p>
    </form>
  </section>;
}
