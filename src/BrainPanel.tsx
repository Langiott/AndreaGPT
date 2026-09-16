import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, Search } from "lucide-react";
import { BRAIN_UPLOAD_PRESETS, brainUploadPreset } from "./brainUploadLimits";

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
  progress?: { phase: "scanning" | "extracting" | "embedding" | "saving" | "complete"; completed: number; total: number; current?: string };
}

export function BrainPanel({ locked, source, onSource, showInfo = false }: {
  showInfo?: boolean;
  locked: boolean; source: string;
  onSource: (value: string) => void;
}) {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [presetId, setPresetId] = useState(() => {
    try { return brainUploadPreset(Number(localStorage.getItem("brain-upload-preset") ?? 20)).id; }
    catch { return 20; }
  });
  const preset = brainUploadPreset(presetId);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setError("");
    setUploadMessage("");
    if (files.length > 50 || files.some(file => !file.size || file.size > preset.fileMiB * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > preset.totalMiB * 1024 * 1024) {
      setError(`Pacchetto ${preset.label}: massimo ${preset.fileMiB} MiB per file, ${preset.totalMiB} MiB totali e 50 file non vuoti. Se necessario, scegli un pacchetto più grande.`); return;
    }
    setBusy(true);
    setUploading(true);
    setUploadMessage(`Caricamento di ${files.length} file e indicizzazione automatica in corso…`);
    try {
      const payload = [];
      for (const file of files) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error(`Impossibile leggere ${file.name}`));
          reader.readAsDataURL(file);
        });
        payload.push({ name: file.name, data });
      }
      const response = await fetch("/api/brain/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: payload, preset: presetId }) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Caricamento non riuscito. Verifica che il server sia aggiornato e riprova.");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Caricamento fallito.");
      setStatus(data);
      onSource("");
      setUploadMessage(`${files.length} file caricati. Indicizzazione completata.${data.errors?.length ? " Alcuni documenti dell'archivio presentano errori: consulta l'elenco sotto." : ""}`);
    } catch (error) {
      setUploadMessage("");
      setError(error instanceof Error ? error.message : "Caricamento fallito.");
    } finally {
      setBusy(false);
      setUploading(false);
    }
  }

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
  useEffect(() => {
    if (!busy && !status?.indexing) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 800);
    return () => window.clearInterval(timer);
  }, [busy, status?.indexing]);

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
    <div id="brain-info" className="brain-info" hidden={!showInfo}>
      <p>Esplora ciò che Brain può consultare. Seleziona un file o un progetto per limitare la ricerca, oppure usa tutto l'archivio. Puoi rimuovere il filtro con la × accanto alla selezione.</p>
      <dl><dt>Ultimo aggiornamento</dt><dd>{status?.indexedAt ? new Date(status.indexedAt).toLocaleString("it-IT") : "Indice non ancora creato"}</dd><dt>Fonti locali</dt><dd>{status?.root ?? "Caricamento…"}</dd><dt>Embedding</dt><dd>{status?.model ?? "Caricamento…"}</dd></dl>
      <p>Seleziona uno o più documenti: verranno indicizzati automaticamente. Scegli il pacchetto vicino a Carica file per impostare la dimensione massima. Fino a 50 file alla volta.</p>
      <p><strong>Aggiorna stato</strong> aggiorna i conteggi. <strong>Reindicizza</strong> aggiorna l'archivio dopo modifiche manuali ai documenti.</p>
    </div>
    <div className="brain-actions">
      <input ref={fileInput} type="file" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void uploadFiles(files); }} />
      <button type="button" disabled={busy || locked || status?.indexing} onClick={() => fileInput.current?.click()}>{uploading ? "Caricamento e indicizzazione…" : "Carica file"}</button>
      <label className="brain-upload-preset">Pacchetto
        <select value={presetId} disabled={busy || locked || status?.indexing} onChange={event => {
          const id = brainUploadPreset(Number(event.target.value)).id;
          setPresetId(id);
          try { localStorage.setItem("brain-upload-preset", String(id)); } catch { /* Selection remains available for this session. */ }
        }}>{BRAIN_UPLOAD_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.fileMiB} MiB/file · {item.totalMiB} MiB totali</option>)}</select>
      </label>
    </div>
    {uploadMessage && <p className="brain-note" role="status">{uploadMessage}</p>}
    <div className="brain-overview"><div><strong>{status?.files ?? 0}</strong><span>Fonti indicizzate</span></div><div><strong>{status?.chunks ?? 0}</strong><span>Estratti disponibili</span></div><div><strong>{groups.length}</strong><span>Raccolte</span></div></div>
    {(busy || status?.indexing) && <p role="status" className="brain-status">{`Operazione in corso: ${status?.progress?.phase ?? "avvio"}${status?.progress?.total ? ` ${status.progress.completed}/${status.progress.total}` : ""}`}</p>}
    {(busy || status?.indexing) && status?.progress && <div><progress max={Math.max(1, status.progress.total)} value={status.progress.completed} /><p className="brain-note">{status.progress.current ?? "Preparazione indice…"}</p></div>}
    {(error || status?.error) && <p className="error-banner" role="alert">{error || status?.error}</p>}
    {source && <div className="brain-filter-row"><span>Filtro attivo: <strong>{source}</strong></span><button aria-label="Rimuovi filtro" onClick={() => onSource("")} disabled={locked}>×</button></div>}
    {!!status?.errors?.length && <ul className="brain-source-list">{status.errors.map((item, i) => <li key={`${item.path}-${i}`}><strong>{item.path}</strong>: {item.error}</li>)}</ul>}
    <label className="brain-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca file o progetto..." /></label>
    <div className="brain-explorer">{groups.map(([group, items]) => <details className="brain-group" key={group} open={Boolean(query) || source.includes(group)}><summary><ChevronRight size={15} /><Folder size={18} /><span><strong>{group}</strong><small>{items.length} file · {items.reduce((sum, item) => sum + (item.chunks ?? 0), 0)} estratti</small></span><button type="button" className={source === `progetti/${group}` ? "active" : ""} onClick={(e) => { e.preventDefault(); onSource(group === "Documenti personali" ? "" : `progetti/${group}`); }}>Usa progetto</button></summary><div className="brain-files">{items.map(item => <button type="button" key={item.id} className={source === item.id ? "active" : ""} onClick={() => onSource(item.id)}><FileText size={15} /><span>{item.id.split("/").at(-1)}</span><small>{item.chunks ?? 0}</small></button>)}</div></details>)}{status && !groups.length && <p className="empty-search">Nessun file trovato.</p>}</div>
    <div className="brain-actions brain-maintenance"><button onClick={() => void run("status")} disabled={busy}>Aggiorna stato</button><button onClick={() => void run("index")} disabled={busy || locked || status?.indexing}>Reindicizza</button></div>
    <form onSubmit={(e) => { e.preventDefault(); void run("import"); }}>
      <label className="brain-field">Repository GitHub opzionale<input type="url" required maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" /></label>
      <button className="primary-action" disabled={busy || locked || !url.trim()}>Importa repository</button>
      <p className="brain-note">Dopo l'importazione premi Reindicizza per includere il repository nel retrieval.</p>
    </form>
  </section>;
}
