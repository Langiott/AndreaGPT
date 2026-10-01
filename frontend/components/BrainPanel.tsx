import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronDown, ChevronRight, Database, FileText, Folder, GitBranch, Maximize2, Minimize2, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { BRAIN_UPLOAD_PRESETS, brainUploadPreset } from "../config/brain_upload_limits";

interface BrainStatus {
  sources?: Array<{ id: string; chunks?: number }>;
  error?: string; root?: string; model?: string; files?: number; indexing?: boolean;
  errors?: Array<{ path: string; error: string }>; indexedAt?: string; chunks?: number;
  progress?: { phase: "scanning" | "extracting" | "embedding" | "saving" | "complete"; completed: number; total: number; current?: string };
  turboVec?: { enabled: boolean; ready: boolean; building: boolean; count?: number; dimension?: number; error?: string };
}

interface BrainDocument {
  source: string;
  name: string;
  extension: string;
  content: string;
}

function normalizeDocumentMath(markdown: string) {
  // I documenti estratti da PDF/Word usano spesso delimitatori LaTeX
  // espliciti, che remark-math non interpreta direttamente.
  return markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((part, index) => {
    if (index % 2) return part;
    return part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`)
      .replace(/\\begin\{(equation\*?|align\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g, (_match, _environment: string, body: string) => `\n$$\n${body.trim()}\n$$\n`);
  }).join("");
}

function BrainDocumentReader({ source, onBack, onClose }: { source: string; onBack: () => void; onClose?: () => void }) {
  const [fileDocument, setFileDocument] = useState<BrainDocument | null>(null);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const readerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFileDocument(null); setError("");
    void fetch(`/api/brain/document?source=${encodeURIComponent(source)}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Documento non disponibile."); return data as BrainDocument; })
      .then(setFileDocument)
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Documento non disponibile."); });
    return () => controller.abort();
  }, [source]);

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.fullscreenElement) onBack(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await readerRef.current?.requestFullscreen();
    } catch { setFullscreen(false); }
  }

  return <section className="brain-document-reader" ref={readerRef}>
    <div className="brain-document-toolbar">
      <button type="button" className="brain-document-back" onClick={onBack} title="Torna all’archivio"><ArrowLeft size={16} /> <span>Torna all’archivio</span></button>
      <div className="brain-document-heading"><FileText size={16} /><strong title={fileDocument?.source ?? source}>{fileDocument?.name ?? source.split("/").at(-1)}</strong><small>{fileDocument?.extension.replace(".", "").toUpperCase() || "Documento"}</small></div>
      <div className="brain-document-actions">
        <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Esci da schermo intero" : "Schermo intero"} title={fullscreen ? "Esci da schermo intero" : "Schermo intero"}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        {onClose && <button type="button" onClick={onClose} aria-label="Chiudi documento" title="Chiudi"><X size={17} /></button>}
      </div>
    </div>
    <div className="brain-document-body">
      {error ? <div className="brain-document-error" role="alert"><strong>Impossibile aprire il documento</strong><span>{error}</span><button type="button" onClick={onBack}>Torna all’archivio</button></div>
        : !fileDocument ? <p className="brain-document-loading" role="status">Apro il documento…</p>
          : <article className="brain-document-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { errorColor: "inherit", throwOnError: false }]]}>{normalizeDocumentMath(fileDocument.content)}</ReactMarkdown></article>}
    </div>
  </section>;
}

export function BrainPanel({ locked, source, onSource, onOpenGraph, onClose, showInfo = false }: { showInfo?: boolean; locked: boolean; source: string; onSource: (value: string) => void; onOpenGraph?: () => void; onClose?: () => void }) {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [url, setUrl] = useState(""); const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null); const [uploadMessage, setUploadMessage] = useState(""); const [uploading, setUploading] = useState(false); const [dismissedWarnings, setDismissedWarnings] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null); const [deleteBusy, setDeleteBusy] = useState(false);
  const [openDocument, setOpenDocument] = useState<string | null>(null);
  const [headerToolbarTarget, setHeaderToolbarTarget] = useState<HTMLElement | null>(null);
  const [presetId, setPresetId] = useState(() => { try { return brainUploadPreset(Number(localStorage.getItem("brain-upload-preset") ?? 20)).id; } catch { return 20; } });
  const preset = brainUploadPreset(presetId);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setError(""); setUploadMessage("");
    if (files.length > 50 || files.some(file => !file.size || file.size > preset.fileMiB * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > preset.totalMiB * 1024 * 1024) { setError(`${preset.label}: massimo ${preset.fileMiB} MiB per file, ${preset.totalMiB} MiB totali e 50 file non vuoti.`); return; }
    setBusy(true); setUploading(true); setUploadMessage(`Caricamento di ${files.length} file e indicizzazione automatica in corso…`);
    try {
      const payload = [];
      for (const file of files) {
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error(`Impossibile leggere ${file.name}`)); reader.readAsDataURL(file); });
        payload.push({ name: file.name, data });
      }
      const response = await fetch("/api/brain/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: payload, preset: presetId }) }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Caricamento fallito.");
      setStatus(data); onSource(""); setUploadMessage(`${files.length} file caricati. Indicizzazione completata.${data.errors?.length ? " Alcuni documenti presentano errori: consulta l'elenco sotto." : ""}`);
    } catch (caught) { setUploadMessage(""); setError(caught instanceof Error ? caught.message : "Caricamento fallito."); } finally { setBusy(false); setUploading(false); }
  }

  const groups = useMemo(() => {
    const matching = (status?.sources ?? []).filter(item => item.id.toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT"))); const map = new Map<string, typeof matching>();
    for (const item of matching) { const parts = item.id.split("/"); const group = parts[0] === "progetti" && parts[1] ? parts[1] : "Documenti personali"; map.set(group, [...(map.get(group) ?? []), item]); }
    return [...map.entries()].sort(([a], [b]) => a === b ? 0 : a === "Documenti personali" ? -1 : b === "Documenti personali" ? 1 : a.localeCompare(b));
  }, [status?.sources, query]);
  const warningCount = status?.errors?.length ?? 0;
  useEffect(() => { if (!warningCount) setDismissedWarnings(false); }, [warningCount]);
  async function refresh() { const response = await fetch("/api/brain/status"); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Stato Brain non disponibile."); setStatus(data); }
  async function deleteSource() {
    if (!deleteTarget) return; setDeleteBusy(true); setError("");
    try { const response = await fetch("/api/brain/source", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: deleteTarget }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Eliminazione Brain fallita."); setStatus(data); onSource(""); setDeleteTarget(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Eliminazione Brain fallita."); } finally { setDeleteBusy(false); }
  }
  useEffect(() => { void refresh().catch(caught => setError(String(caught.message))); }, []);
  useEffect(() => { setHeaderToolbarTarget(document.getElementById("brain-modal-actions")); }, []);
  useEffect(() => { if (!busy && !status?.indexing && !status?.turboVec?.building) return; const timer = window.setInterval(() => void refresh().catch(() => undefined), 800); return () => window.clearInterval(timer); }, [busy, status?.indexing, status?.turboVec?.building]);
  async function run(action: "index" | "import") {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/brain/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "import" ? { url: url.trim() } : {}) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Operazione Brain fallita."); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Brain non disponibile."); } finally { setBusy(false); }
  }

  const toolbar = <div className="brain-toolbar"><input ref={fileInput} type="file" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void uploadFiles(files); }} /><button type="button" disabled={busy || locked || status?.indexing} onClick={() => fileInput.current?.click()}><Upload size={15} />{uploading ? "Caricamento…" : "Carica"}</button><button type="button" onClick={() => void run("index")} disabled={busy || locked || status?.indexing}><RotateCcw size={15} />Ripristina indice</button><button type="button" disabled={busy || locked} onClick={onOpenGraph}>Micelio</button><label className="brain-upload-preset"><select aria-label="Limite di caricamento" value={presetId} disabled={busy || locked || status?.indexing} onChange={event => { const id = brainUploadPreset(Number(event.target.value)).id; setPresetId(id); try { localStorage.setItem("brain-upload-preset", String(id)); } catch { /* sessione */ } }}>{BRAIN_UPLOAD_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.fileMiB} MiB/file · {item.totalMiB} MiB totali</option>)}</select></label></div>;

  return <section className="brain-panel">
    {openDocument ? <BrainDocumentReader source={openDocument} onBack={() => setOpenDocument(null)} onClose={onClose} /> : <>
    <div id="brain-info" className="brain-info" hidden={!showInfo}><div className="brain-overview"><div><strong>{status?.files ?? 0}</strong><span>Fonti indicizzate</span></div><div><strong>{status?.chunks ?? 0}</strong><span>Estratti disponibili</span></div><div><strong>{groups.length}</strong><span>Raccolte</span></div></div><dl><dt>Ultimo aggiornamento</dt><dd>{status?.indexedAt ? new Date(status.indexedAt).toLocaleString("it-IT") : "Indice non ancora creato"}</dd><dt>Fonti locali</dt><dd>{status?.root ?? "Caricamento…"}</dd><dt>Embedding</dt><dd>{status?.model ?? "Caricamento…"}</dd><dt>TurboVec</dt><dd>{status?.turboVec?.ready ? `Attivo · ${status.turboVec.count?.toLocaleString("it-IT")} vettori` : status?.turboVec?.building ? "Elaborazione in corso…" : "Fallback JSON attivo"}</dd></dl><p><strong>Carica</strong> aggiunge documenti e li indicizza. <strong>Ripristina indice</strong> ricostruisce l'indice Brain già esistente.</p></div>
    {headerToolbarTarget ? createPortal(toolbar, headerToolbarTarget) : toolbar}
    <details className="brain-summary" open><summary><span><Database size={15} />Riepilogo</span><ChevronDown size={15} /></summary><div className="brain-summary-grid"><div><strong>{status?.files ?? 0}</strong><span>File</span></div><div><strong>{(status?.chunks ?? 0).toLocaleString("it-IT")}</strong><span>Embedding</span></div><div><strong>{status?.turboVec?.count != null ? status.turboVec.count.toLocaleString("it-IT") : "—"}</strong><span>Vettori indice</span></div><div><strong>{groups.length}</strong><span>Raccolte</span></div></div></details>
    <div className="brain-secondary-grid"><details className="brain-import"><summary><span><GitBranch size={15} />Carica repository</span><ChevronDown size={15} /></summary><form className="brain-github" onSubmit={event => { event.preventDefault(); void run("import"); }}><GitBranch size={17} aria-hidden="true" /><input aria-label="Repository o profilo GitHub pubblico" type="url" required maxLength={500} value={url} onChange={event => setUrl(event.target.value)} placeholder="Repository o profilo GitHub pubblico" /><button className="primary-action" disabled={busy || locked || !url.trim()}>Importa</button></form></details>
    {uploadMessage && <p className="brain-note" role="status">{uploadMessage}</p>}{(busy || status?.indexing) && <p role="status" className="brain-status">{`Operazione in corso: ${status?.progress?.phase ?? "avvio"}${status?.progress?.total ? ` ${status.progress.completed}/${status.progress.total}` : ""}`}</p>}{(busy || status?.indexing) && status?.progress && <div><progress max={Math.max(1, status.progress.total)} value={status.progress.completed} /><p className="brain-note">{status.progress.current ?? "Preparazione indice…"}</p></div>}{(error || status?.error) && <p className="error-banner" role="alert">{error || status?.error}</p>}
    {deleteTarget && <section className="brain-delete-warning" role="alert"><div><strong>Eliminazione solo dal Brain</strong><span><code>{deleteTarget}</code> verrà tolto dall’indice, ma resterà nella cartella di archivio. Se reindicizzi il Brain, potrà ricomparire.</span></div><button type="button" aria-label="Annulla eliminazione" onClick={() => setDeleteTarget(null)}><X size={16} /></button><div className="brain-delete-actions"><button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Annulla</button><button type="button" onClick={() => void deleteSource()} disabled={deleteBusy}>{deleteBusy ? "Elimino…" : "Conferma elimina"}</button></div></section>}
    {source && <div className="brain-filter-row"><span>Filtro attivo: <strong>{source}</strong></span><button aria-label="Rimuovi filtro" onClick={() => onSource("")} disabled={locked}>×</button></div>}    {!!status?.errors?.length && !dismissedWarnings && <details className="brain-warning"><summary><span><strong>{status.errors.length} warning archivio</strong><small>Puoi chiuderli: i file validi restano indicizzati.</small></span><ChevronDown size={15} /></summary><ul className="brain-source-list">{status.errors.map((item, index) => <li key={`${item.path}-${index}`}><strong>{item.path}</strong>: {item.error}</li>)}</ul><button type="button" className="brain-warning-dismiss" onClick={() => setDismissedWarnings(true)}>Nascondi warning</button></details>}
    </div>
    <details className="brain-browser" open><summary><span><Folder size={17} />File e ricerca</span><small>{status?.files ?? 0} file</small></summary><div className="brain-browser-body"><label className="brain-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca file o progetto…" /></label><div className="brain-explorer">{groups.map(([group, items]) => <details className="brain-group" key={group} open={Boolean(query) || source.includes(group)}><summary><ChevronRight size={15} /><Folder size={18} /><span><strong>{group}</strong><small>{items.length} file · {items.reduce((sum, item) => sum + (item.chunks ?? 0), 0)} estratti</small></span></summary><div className="brain-files">{items.map(item => <div className="brain-file-row" key={item.id}><button type="button" className="brain-file-label" onClick={() => setOpenDocument(item.id)} title={`Apri ${item.id}`}><FileText size={15} /><span>{item.id.split("/").slice(-1)[0]}</span><small>{item.chunks ?? 0}</small></button><div className="brain-file-actions"><button type="button" className="delete" onClick={() => setDeleteTarget(item.id)} title="Rimuovi dall’indice Brain" aria-label={`Elimina ${item.id}`}><Trash2 size={13} /></button></div></div>)}</div></details>)}{status && !groups.length && <p className="empty-search">Nessun file trovato.</p>}</div></div></details>
    {status?.turboVec?.error && <p className="brain-note">TurboVec non disponibile: {status.turboVec.error}. La ricerca JSON continua a funzionare.</p>}
    </>}
  </section>;
}
