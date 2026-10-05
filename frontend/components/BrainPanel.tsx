import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, Database, FileText, Folder, GitBranch, ListTree, Maximize2, Minimize2, MoreHorizontal, Pencil, RotateCcw, Save, Search, Trash2, Undo2, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { BRAIN_UPLOAD_PRESETS, brainUploadPreset } from "../config/brain_upload_limits";
import { findPassage, plainWords } from "../utils/cite_focus";

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

/** Formula breve senza relazioni o frazioni: un simbolo o il nome di un parametro. */
const isShortFormula = (body: string) => body.trim().length <= 16 && !/[=<>\n]|\\(?:frac|sum|int|prod|begin)/.test(body.trim());

function normalizeDocumentMath(markdown: string) {
  // I documenti estratti da PDF/Word usano spesso delimitatori LaTeX
  // espliciti, che remark-math non interpreta direttamente.
  return markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((part, index) => {
    if (index % 2) return part;
    return part
      // Un simbolo isolato (es. \[\epsilon\]) resta in riga: un blocco centrato spreca spazio.
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => isShortFormula(body) ? `$${body.trim()}$` : `\n$$\n${body.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`)
      .replace(/\\begin\{(equation\*?|align\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g, (_match, _environment: string, body: string) => `\n$$\n${body.trim()}\n$$\n`)
      // Simbolo in riga rimasto da solo: si unisce alla frase che lo descrive ("ε che rappresenta…").
      .replace(/(^|\n)[ \t]*(\$[^$\n]+\$)[ \t]*\n[ \t]*\n(?=[^\s#>|`$*+\-\d])/g, (_match, start: string, formula: string) => `${start}${formula} `);
  }).join("");
}

interface OutlineItem { id: string; level: number; text: string }

const TOC_HEADING = /^(indice|sommario|contents|table of contents|index)$/i;

function normalizeHeadingText(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("it-IT");
}

// Testo della voce di elenco senza i sotto-elenchi annidati.
function ownListItemText(item: Element) {
  return [...item.childNodes].filter(node => !(node instanceof Element && (node.tagName === "UL" || node.tagName === "OL"))).map(node => node.textContent ?? "").join(" ");
}

/** Lettore Markdown dell'archivio. Con `url` legge altrove (es. OUTPUT); `onSave` e `onDelete` abilitano modifica ed eliminazione. */
/** Tratto citato da aprire: righe del file originale ed estratto inviato al modello (riserva se le righe non si ritrovano). */
export type DocumentFocus = { startLine: number; endLine: number; text?: string };

export function BrainDocumentReader({ source, focus, onBack, onClose, url, backLabel = "Torna all’archivio", onSave, onDelete, image }: { source: string; focus?: DocumentFocus; onBack: () => void; onClose?: () => void; url?: string; backLabel?: string; image?: string; onSave?: (content: string) => Promise<void>; onDelete?: () => void }) {
  const [fileDocument, setFileDocument] = useState<BrainDocument | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState("");
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Range[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const readerRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Assegna un id ai titoli, costruisce l'indice e rende cliccabile l'indice testuale del documento.
  useEffect(() => {
    const article = articleRef.current;
    if (!article || !fileDocument) { setOutline([]); return; }
    const headings = [...article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
    const byText = new Map<string, string>();
    const items: OutlineItem[] = [];
    headings.forEach((heading, index) => {
      heading.id = `brain-heading-${index}`;
      const text = heading.textContent?.trim() ?? "";
      const key = normalizeHeadingText(text);
      if (key && !byText.has(key)) byText.set(key, heading.id);
      if (TOC_HEADING.test(text) || (index === 0 && heading.tagName === "H1")) return;
      items.push({ id: heading.id, level: Number(heading.tagName[1]), text });
    });
    const minLevel = Math.min(...items.map(item => item.level));
    setOutline(items.map(item => ({ ...item, level: item.level - minLevel })));
    for (const heading of headings.filter(item => TOC_HEADING.test(item.textContent?.trim() ?? ""))) {
      for (let sibling = heading.nextElementSibling; sibling && !/^H[1-6]$/.test(sibling.tagName); sibling = sibling.nextElementSibling) {
        sibling.querySelectorAll("li").forEach(item => {
          const target = byText.get(normalizeHeadingText(ownListItemText(item)));
          if (target) { item.setAttribute("data-toc-target", target); item.classList.add("brain-toc-link"); }
        });
      }
    }
  }, [fileDocument]);

  // Evidenzia nella tendina la sezione attualmente visibile.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !outline.length) return;
    const update = () => {
      const top = body.getBoundingClientRect().top + 80;
      let current = outline[0].id;
      for (const item of outline) { const element = document.getElementById(item.id); if (element && element.getBoundingClientRect().top <= top) current = item.id; else if (element) break; }
      setActiveHeading(current);
    };
    update();
    body.addEventListener("scroll", update, { passive: true });
    return () => body.removeEventListener("scroll", update);
  }, [outline]);

  // Ricerca nel testo: evidenziazione con CSS Custom Highlight API, senza toccare il DOM di React.
  useEffect(() => {
    const article = articleRef.current;
    const term = search.trim().toLocaleLowerCase("it-IT");
    const found: Range[] = [];
    if (article && term.length >= 2) {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").toLocaleLowerCase("it-IT");
        if (node.parentElement?.closest(".katex")) continue;
        for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
          const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + term.length); found.push(range);
        }
      }
    }
    setMatches(found); setMatchIndex(0);
  }, [search, fileDocument]);

  useEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!highlights || !HighlightClass) return;
    if (matches.length) highlights.set("brain-search", new HighlightClass(...matches)); else highlights.delete("brain-search");
    const current = matches[matchIndex];
    if (current) highlights.set("brain-search-current", new HighlightClass(current)); else highlights.delete("brain-search-current");
    if (current && bodyRef.current) {
      const body = bodyRef.current;
      const offset = current.getBoundingClientRect().top - body.getBoundingClientRect().top;
      if (offset < 40 || offset > body.clientHeight - 60) body.scrollTo({ top: body.scrollTop + offset - body.clientHeight / 3, behavior: "smooth" });
    }
  }, [matches, matchIndex]);

  useEffect(() => () => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    highlights?.delete("brain-search"); highlights?.delete("brain-search-current"); highlights?.delete("brain-cite");
  }, []);

  // Citazione: evidenzia il tratto citato e lo porta in vista (confronto per parole, il Markdown renderizzato non conserva le righe).
  useEffect(() => {
    const article = articleRef.current;
    const body = bodyRef.current;
    if (!focus || !article || !body || !fileDocument) return;
    const words: string[] = [];
    const spots: Array<{ node: Text; start: number; end: number }> = [];
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (node.parentElement?.closest(".katex")) continue;
      for (const match of (node.textContent ?? "").matchAll(/[\p{L}\p{N}]+/gu)) {
        words.push(match[0].toLocaleLowerCase("it-IT"));
        spots.push({ node, start: match.index!, end: match.index! + match[0].length });
      }
    }
    const lines = focus.startLine ? fileDocument.content.split(/\r?\n/).slice(focus.startLine - 1, focus.endLine).join("\n") : "";
    const found = findPassage(words, plainWords(lines)) ?? (focus.text ? findPassage(words, plainWords(focus.text)) : null);
    if (!found) return;
    const range = document.createRange();
    range.setStart(spots[found.start].node, spots[found.start].start);
    range.setEnd(spots[found.end].node, spots[found.end].end);
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (highlights && HighlightClass) highlights.set("brain-cite", new HighlightClass(range));
    body.scrollTo({ top: body.scrollTop + range.getBoundingClientRect().top - body.getBoundingClientRect().top - 80 });
  }, [fileDocument, focus]);

  function stepMatch(direction: 1 | -1) {
    if (!matches.length) return;
    setMatchIndex(index => (index + direction + matches.length) % matches.length);
  }

  function scrollToHeading(id: string) {
    const element = document.getElementById(id);
    const body = bodyRef.current;
    if (!element || !body) return;
    body.scrollTo({ top: body.scrollTop + element.getBoundingClientRect().top - body.getBoundingClientRect().top - 12, behavior: "smooth" });
    setActiveHeading(id);
  }

  function handleArticleClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const link = target.closest("a");
    if (link?.getAttribute("href")?.startsWith("#")) {
      const hash = decodeURIComponent(link.getAttribute("href")!.slice(1));
      const byId = articleRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(hash)}"]`);
      const wanted = normalizeHeadingText(hash.replace(/-/g, " "));
      const byText = outline.find(item => normalizeHeadingText(item.text).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ") === wanted.replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " "));
      const id = byId?.id || byText?.id;
      if (id) { event.preventDefault(); scrollToHeading(id); }
      return;
    }
    if (link) return;
    const tocItem = target.closest<HTMLElement>("li[data-toc-target]");
    if (tocItem) scrollToHeading(tocItem.dataset.tocTarget!);
  }

  useEffect(() => {
    const controller = new AbortController();
    setFileDocument(null); setError(""); setDraft(null);
    void fetch(url ?? `/api/brain/document?source=${encodeURIComponent(source)}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Documento non disponibile."); return data as BrainDocument; })
      .then(setFileDocument)
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Documento non disponibile."); });
    return () => controller.abort();
  }, [source, url]);

  async function save() {
    if (draft === null || !fileDocument || !onSave) return;
    setSaving(true); setError("");
    try { await onSave(draft); setFileDocument({ ...fileDocument, content: draft }); setDraft(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Salvataggio non riuscito."); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      if (event.key === "Escape" && event.target === searchRef.current) return;
      if (event.key === "Escape" && draft !== null) return;
      if (event.key === "Escape" && !document.fullscreenElement) onBack();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack, draft]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await readerRef.current?.requestFullscreen();
    } catch { setFullscreen(false); }
  }

  return <section className="brain-document-reader" ref={readerRef}>
    <div className="brain-document-toolbar">
      <button type="button" className="brain-document-back" onClick={onBack} title={backLabel} aria-label={backLabel}><ArrowLeft size={17} /></button>
      <div className="brain-document-heading"><FileText size={16} /><strong title={fileDocument?.source ?? source}>{fileDocument?.name ?? source.split("/").at(-1)}</strong><small>{fileDocument?.extension.replace(".", "").toUpperCase() || "Documento"}</small></div>
      <div className="brain-document-actions">
        <div className="brain-document-search" role="search">
          <Search size={14} aria-hidden="true" />
          <input ref={searchRef} type="search" value={search} placeholder="Cerca nel documento" aria-label="Cerca nel documento" onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); stepMatch(event.shiftKey ? -1 : 1); } else if (event.key === "Escape") { event.preventDefault(); setSearch(""); event.currentTarget.blur(); } }} />
          {search.trim().length >= 2 && <span className="brain-document-search-count" aria-live="polite">{matches.length ? `${matchIndex + 1}/${matches.length}` : "0"}</span>}
          <button type="button" disabled={!matches.length} onClick={() => stepMatch(-1)} aria-label="Risultato precedente" title="Precedente (Maiusc+Invio)"><ChevronUp size={15} /></button>
          <button type="button" disabled={!matches.length} onClick={() => stepMatch(1)} aria-label="Risultato successivo" title="Successivo (Invio)"><ChevronDown size={15} /></button>
        </div>
        <button type="button" className={outlineOpen ? "is-active" : undefined} disabled={!outline.length} onClick={() => setOutlineOpen(open => !open)} aria-expanded={outlineOpen} aria-label="Indice del documento" title="Indice"><ListTree size={16} /></button>
        {onSave && fileDocument && (draft === null
          ? <button type="button" onClick={() => setDraft(fileDocument.content)} aria-label="Modifica" title="Modifica"><Pencil size={15} /></button>
          : <><button type="button" className="is-active" disabled={saving} onClick={() => void save()} aria-label="Salva" title="Salva"><Save size={15} /></button><button type="button" disabled={saving} onClick={() => setDraft(null)} aria-label="Annulla modifiche" title="Annulla modifiche"><Undo2 size={15} /></button></>)}
        {onDelete && <button type="button" className="brain-document-delete" onClick={onDelete} aria-label="Elimina definitivamente" title="Elimina definitivamente"><Trash2 size={15} /></button>}
        <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Esci da schermo intero" : "Schermo intero"} title={fullscreen ? "Esci da schermo intero" : "Schermo intero"}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        {onClose && <button type="button" onClick={onClose} aria-label="Chiudi documento" title="Chiudi"><X size={17} /></button>}
      </div>
    </div>
    {outlineOpen && outline.length > 0 && <nav className="brain-document-outline" aria-label="Indice del documento">
      <div className="brain-document-outline-head"><strong>Indice</strong><button type="button" onClick={() => setOutlineOpen(false)} aria-label="Chiudi indice" title="Chiudi indice"><X size={14} /></button></div>
      <ol>{outline.map(item => <li key={item.id}><button type="button" className={item.id === activeHeading ? "is-active" : undefined} style={{ paddingLeft: 10 + item.level * 14 }} data-level={item.level} onClick={() => scrollToHeading(item.id)} title={item.text}>{item.text}</button></li>)}</ol>
    </nav>}
    <div className={image ? "brain-document-body has-image" : "brain-document-body"} ref={bodyRef}>
      {image && <a className="brain-document-image" href={image} target="_blank" rel="noreferrer" title="Apri immagine"><img src={image} alt="" /></a>}
      {error && draft === null ? <div className="brain-document-error" role="alert"><strong>Impossibile aprire il documento</strong><span>{error}</span><button type="button" onClick={onBack}>{backLabel}</button></div>
        : draft !== null ? <>{error && <p className="error-banner" role="alert">{error}</p>}<textarea className="brain-document-editor" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} autoFocus aria-label="Testo Markdown" /></>
        : !fileDocument ? <p className="brain-document-loading" role="status">Apro il documento…</p>
          : <article className="brain-document-content" ref={articleRef} onClick={handleArticleClick}><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { errorColor: "inherit", throwOnError: false }]]}>{normalizeDocumentMath(fileDocument.content)}</ReactMarkdown></article>}
    </div>
  </section>;
}

export function BrainPanel({ locked, source, onSource, onOpenGraph, onOpenEmbedding, onClose, showInfo = false }: { showInfo?: boolean; locked: boolean; source: string; onSource: (value: string) => void; onOpenGraph?: () => void; onOpenEmbedding?: () => void; onClose?: () => void }) {
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [url, setUrl] = useState(""); const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null); const [uploadMessage, setUploadMessage] = useState(""); const [uploading, setUploading] = useState(false); const [dismissedWarnings, setDismissedWarnings] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null); const [deleteBusy, setDeleteBusy] = useState(false);
  const [openDocument, setOpenDocument] = useState<string | null>(null);
  const [headerToolbarTarget, setHeaderToolbarTarget] = useState<HTMLElement | null>(null);
  const toolbarMenu = useRef<HTMLDetailsElement>(null);
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
      setStatus(data); onSource(""); setUploadMessage("");
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

  const toolbarActions = <><button type="button" disabled={busy || locked || status?.indexing} onClick={() => fileInput.current?.click()}><Upload size={15} />{uploading ? "Caricamento…" : "Carica"}</button><button type="button" onClick={() => void run("index")} disabled={busy || locked || status?.indexing}><RotateCcw size={15} />Ripristina indice</button><button type="button" disabled={busy || locked} onClick={onOpenGraph}>Micelio</button>{onOpenEmbedding && <button type="button" disabled={busy || locked} onClick={onOpenEmbedding} title="Vedi gli embedding reali in 3D">EmbeddingSpace</button>}<label className="brain-upload-preset"><select aria-label="Limite di caricamento" value={presetId} disabled={busy || locked || status?.indexing} onChange={event => { const id = brainUploadPreset(Number(event.target.value)).id; setPresetId(id); try { localStorage.setItem("brain-upload-preset", String(id)); } catch { /* sessione */ } }}>{BRAIN_UPLOAD_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.fileMiB} MiB/file · {item.totalMiB} MiB totali</option>)}</select></label></>;
  const toolbar = <div className="brain-toolbar"><input ref={fileInput} type="file" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void uploadFiles(files); }} /><div className="brain-toolbar-inline">{toolbarActions}</div><details className="brain-toolbar-menu" ref={toolbarMenu}><summary aria-label="Azioni Brain" title="Azioni"><MoreHorizontal size={17} /><span>Azioni</span><ChevronDown size={14} /></summary><div className="brain-toolbar-dropdown" onClick={event => { if ((event.target as HTMLElement).closest("button")) toolbarMenu.current?.removeAttribute("open"); }}>{toolbarActions}</div></details></div>;

  return <section className="brain-panel">
    {openDocument ? <BrainDocumentReader source={openDocument} onBack={() => setOpenDocument(null)} onClose={onClose} /> : <>
    <div id="brain-info" className="brain-info" hidden={!showInfo}><div className="brain-overview"><div><strong>{status?.files ?? 0}</strong><span>Fonti indicizzate</span></div><div><strong>{status?.chunks ?? 0}</strong><span>Estratti disponibili</span></div><div><strong>{groups.length}</strong><span>Raccolte</span></div></div><dl><dt>Ultimo aggiornamento</dt><dd>{status?.indexedAt ? new Date(status.indexedAt).toLocaleString("it-IT") : "Indice non ancora creato"}</dd><dt>Fonti locali</dt><dd>{status?.root ?? "Caricamento…"}</dd><dt>Embedding</dt><dd>{status?.model ?? "Caricamento…"}</dd><dt>TurboVec</dt><dd>{status?.turboVec?.ready ? `Attivo · ${status.turboVec.count?.toLocaleString("it-IT")} vettori` : status?.turboVec?.building ? "Elaborazione in corso…" : "Fallback JSON attivo"}</dd></dl><p><strong>Carica</strong> aggiunge documenti e li indicizza. <strong>Ripristina indice</strong> ricostruisce l'indice Brain già esistente.</p></div>
    {headerToolbarTarget ? createPortal(toolbar, headerToolbarTarget) : toolbar}
    <details className="brain-summary" open><summary><span><Database size={15} />Riepilogo</span><ChevronDown size={15} /></summary><div className="brain-summary-grid"><div><strong>{status?.files ?? 0}</strong><span>File</span></div><div><strong>{(status?.chunks ?? 0).toLocaleString("it-IT")}</strong><span>Embedding</span></div><div><strong>{status?.turboVec?.count != null ? status.turboVec.count.toLocaleString("it-IT") : "—"}</strong><span>Vettori indice</span></div><div><strong>{groups.length}</strong><span>Raccolte</span></div></div></details>
    {(busy || status?.indexing) && <section className="brain-progress-card" role="status">{uploading && uploadMessage && <p className="brain-note">{uploadMessage}</p>}<p className="brain-status">{`Operazione in corso: ${status?.progress?.phase ?? "avvio"}${status?.progress?.total ? ` ${status.progress.completed}/${status.progress.total}` : ""}`}</p>{status?.progress && <><progress max={Math.max(1, status.progress.total)} value={status.progress.completed} /><p className="brain-note">{status.progress.current ?? "Preparazione indice…"}</p></>}</section>}
    {(error || status?.error) && <p className="error-banner" role="alert">{error || status?.error}</p>}
    {deleteTarget && <section className="brain-delete-warning" role="alert"><div><strong>Eliminazione solo dal Brain</strong><span><code>{deleteTarget}</code> verrà tolto dall’indice, ma resterà nella cartella di archivio. Se reindicizzi il Brain, potrà ricomparire.</span></div><button type="button" aria-label="Annulla eliminazione" onClick={() => setDeleteTarget(null)}><X size={16} /></button><div className="brain-delete-actions"><button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Annulla</button><button type="button" onClick={() => void deleteSource()} disabled={deleteBusy}>{deleteBusy ? "Elimino…" : "Conferma elimina"}</button></div></section>}
    {source && <div className="brain-filter-row"><span>Filtro attivo: <strong>{source}</strong></span><button aria-label="Rimuovi filtro" onClick={() => onSource("")} disabled={locked}>×</button></div>}
    <div className="brain-secondary-grid"><details className="brain-import"><summary><span><GitBranch size={15} />Carica repository</span><ChevronDown size={15} /></summary><form className="brain-github" onSubmit={event => { event.preventDefault(); void run("import"); }}><GitBranch size={17} aria-hidden="true" /><input aria-label="Repository o profilo GitHub pubblico" type="url" required maxLength={500} value={url} onChange={event => setUrl(event.target.value)} placeholder="Repository o profilo GitHub pubblico" /><button className="primary-action" disabled={busy || locked || !url.trim()}>Importa</button></form></details>
    {!!status?.errors?.length && !dismissedWarnings && <details className="brain-warning"><summary><span><strong>{status.errors.length} warning archivio</strong><small>Puoi chiuderli: i file validi restano indicizzati.</small></span><ChevronDown size={15} /></summary><ul className="brain-source-list">{status.errors.map((item, index) => <li key={`${item.path}-${index}`}><strong>{item.path}</strong>: {item.error}</li>)}</ul><button type="button" className="brain-warning-dismiss" onClick={() => setDismissedWarnings(true)}>Nascondi warning</button></details>}
    </div>
    <details className="brain-browser" open><summary><span><Folder size={17} />File e ricerca</span><small>{status?.files ?? 0} file</small></summary><div className="brain-browser-body"><label className="brain-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca file o progetto…" /></label><div className="brain-explorer">{groups.map(([group, items]) => <details className="brain-group" key={group} open={Boolean(query) || source.includes(group)}><summary><ChevronRight size={15} /><Folder size={18} /><span><strong>{group}</strong><small>{items.length} file · {items.reduce((sum, item) => sum + (item.chunks ?? 0), 0)} estratti</small></span></summary><div className="brain-files">{items.map(item => <div className="brain-file-row" key={item.id}><button type="button" className="brain-file-label" onClick={() => setOpenDocument(item.id)} title={`Apri ${item.id}`}><FileText size={15} /><span>{item.id.split("/").slice(-1)[0]}</span><small>{item.chunks ?? 0}</small></button><div className="brain-file-actions"><button type="button" className="delete" onClick={() => setDeleteTarget(item.id)} title="Rimuovi dall’indice Brain" aria-label={`Elimina ${item.id}`}><Trash2 size={13} /></button></div></div>)}</div></details>)}{status && !groups.length && <p className="empty-search">Nessun file trovato.</p>}</div></div></details>
    {status?.turboVec?.error && <p className="brain-note">TurboVec non disponibile: {status.turboVec.error}. La ricerca JSON continua a funzionare.</p>}
    </>}
  </section>;
}
