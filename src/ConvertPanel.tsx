import { useRef, useState } from "react";
import { Download, FileOutput, Upload, X } from "lucide-react";
import { createId } from "./compat";
import { downloadConverted, type Converted } from "./converted";

type Target = "pdf" | "docx" | "md" | "txt";

const choices: Record<string, Array<{ value: Target; label: string }>> = {
  pdf: [{ value: "docx", label: "Word (.docx)" }, { value: "md", label: "Markdown (.md)" }, { value: "txt", label: "Testo (.txt)" }],
  docx: [{ value: "pdf", label: "PDF (.pdf)" }, { value: "md", label: "Markdown (.md)" }],
  md: [{ value: "pdf", label: "PDF (.pdf)" }, { value: "docx", label: "Word (.docx)" }],
  markdown: [{ value: "pdf", label: "PDF (.pdf)" }, { value: "docx", label: "Word (.docx)" }],
  txt: [{ value: "pdf", label: "PDF (.pdf)" }, { value: "docx", label: "Word (.docx)" }, { value: "md", label: "Markdown (.md)" }],
};

interface QueueItem {
  id: string;
  file: File;
  target: Target;
  status: "pronto" | "conversione" | "ok" | "errore";
  error?: string;
  result?: Converted;
  saving?: boolean;
  saved?: boolean;
}

function extension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function asDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Impossibile leggere il file."));
    reader.readAsDataURL(file);
  });
}

export function ConvertPanel({ onResult }: { onResult?: (result: Converted) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [improveTables, setImproveTables] = useState(true);
  const [translate, setTranslate] = useState(false);
  const [showPicker, setShowPicker] = useState(true);

  function selectFiles(next: FileList | File[] | undefined) {
    const selected = next ? Array.from(next) : [];
    if (!selected.length) return;
    setMessage(""); setError("");
    const skipped: string[] = [];
    const valid: QueueItem[] = [];
    for (const file of selected) {
      if (file.size > 75 * 1024 * 1024) { skipped.push(`${file.name} (supera 75 MiB)`); continue; }
      const options = choices[extension(file.name)] ?? [];
      if (!options.length) { skipped.push(`${file.name} (formato non supportato)`); continue; }
      valid.push({ id: createId(), file, target: options[0].value, status: "pronto" });
    }
    if (valid.length) setItems((current) => [...current, ...valid]);
    if (skipped.length) setError(`Ignorati: ${skipped.join("; ")}.`);
  }

  function removeItem(id: string) {
    if (busy) return;
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function setItemTarget(id: string, target: Target) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, target } : item));
  }

  async function convertAll() {
    const pending = items.filter((item) => item.status === "pronto" || item.status === "errore");
    if (!pending.length || busy) return;
    setBusy(true); setError(""); setMessage(`Conversione locale in corso… 0/${pending.length}`);
    let done = 0;
    for (const item of pending) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "conversione", error: undefined } : entry));
      try {
        const response = await fetch("/api/convert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: item.file.name, data: await asDataUrl(item.file), target: item.target, improveTables, translate }) });
        const data = await response.json() as Converted & { error?: string };
        if (!response.ok) throw new Error(data.error || "Conversione fallita.");
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "ok", result: data } : entry));
        onResult?.(data);
        done += 1;
      } catch (caught) {
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "errore", error: caught instanceof Error ? caught.message : "Conversione fallita." } : entry));
      }
      setMessage(`Conversione locale in corso… ${done}/${pending.length} completate`);
    }
    const failed = pending.length - done;
    setMessage(failed ? `Completate ${done}/${pending.length} conversioni, ${failed} non riuscite. I file originali non sono stati modificati.` : `Conversione completata: ${done} file. Gli originali non sono stati modificati.`);
    setBusy(false);
  }

  async function downloadAll() {
    const converted = items.filter((item) => item.result).map((item) => item.result!);
    if (!converted.length || downloading) return;
    setDownloading(true); setError(""); setMessage("Preparazione dell'archivio ZIP…");
    try {
      const response = await fetch("/api/convert/zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: converted.map((result) => ({ name: result.name, data: result.data })) }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || "Download non riuscito.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const date = new Date().toLocaleDateString("it-IT").replaceAll("/", "-");
      const link = document.createElement("a");
      link.href = url; link.download = `conversioni-${date}.zip`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage(`Archivio ZIP scaricato con ${converted.length} file.`);
    } catch (caught) {
      setMessage("");
      setError(caught instanceof Error ? caught.message : "Download non riuscito.");
    } finally { setDownloading(false); }
  }

  async function saveToBrain(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item?.result || item.saving) return;
    setItems((current) => current.map((entry) => entry.id === id ? { ...entry, saving: true } : entry));
    setError(""); setMessage("Salvataggio e indicizzazione nel Brain…");
    try {
      const response = await fetch("/api/brain/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset: 100, files: [{ name: item.result.name, data: item.result.data }] }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Salvataggio nel Brain fallito.");
      setItems((current) => current.map((entry) => entry.id === id ? { ...entry, saving: false, saved: true } : entry));
      setMessage(`${item.result.name} salvato e indicizzato nel Brain.`);
    } catch (caught) {
      setItems((current) => current.map((entry) => entry.id === id ? { ...entry, saving: false } : entry));
      setError(caught instanceof Error ? caught.message : "Salvataggio fallito.");
    }
  }

  const convertible = items.filter((item) => item.status === "pronto" || item.status === "errore").length;
  const results = items.filter((item) => item.result);

  return <section className="convert-panel">
    <p>Converti i documenti localmente, anche più file insieme. I file originali non vengono sovrascritti.</p>
    <div className="convert-options" role="group" aria-label="Opzioni di conversione">
      <label><input type="checkbox" checked={improveTables} onChange={(event) => setImproveTables(event.target.checked)} disabled={busy} /> <span><strong>Migliora tabelle</strong><small>ricostruisce le righe PDF in tabelle Markdown</small></span></label>
      <label><input type="checkbox" checked={translate} onChange={(event) => setTranslate(event.target.checked)} disabled={busy} /> <span><strong>Traduci in italiano</strong><small>usa il modello locale e conserva numeri e termini tecnici</small></span></label>
      <button type="button" className="convert-picker-toggle" onClick={() => setShowPicker((current) => !current)} disabled={busy}>{showPicker ? "Nascondi scegli documento" : "Mostra scegli documento"}</button>
    </div>
    <input ref={inputRef} type="file" hidden multiple accept=".pdf,.docx,.md,.markdown,.txt" onChange={event => { selectFiles(event.target.files ?? undefined); event.target.value = ""; }} />
    {showPicker && <button className="convert-drop" onClick={() => inputRef.current?.click()} disabled={busy}><Upload size={20} /><span><strong>{items.length ? `${items.length} documenti in coda` : "Scegli uno o più documenti"}</strong><small>PDF, Word, Markdown o testo · massimo 75 MiB per file</small></span></button>}
    {items.length > 0 && <div className="convert-queue">
      {items.map((item) => (
        <div className="convert-queue-item" key={item.id}>
          <div className="convert-queue-head">
            <strong title={item.file.name}>{item.file.name}</strong>
            <small>{formatSize(item.file.size)}</small>
            <button type="button" className="convert-queue-remove" onClick={() => removeItem(item.id)} disabled={busy} aria-label={`Rimuovi ${item.file.name}`}><X size={14} /></button>
          </div>
          <label className="convert-queue-target">Converti in
            <select value={item.target} disabled={busy || item.status === "conversione"} onChange={(event) => setItemTarget(item.id, event.target.value as Target)}>
              {(choices[extension(item.file.name)] ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {item.status === "conversione" && <small className="convert-status" role="status">Elaborazione…</small>}
          {item.status === "errore" && <small className="convert-status error" role="alert">{item.error ?? "Conversione fallita."}</small>}
          {item.status === "ok" && item.result && <small className="convert-status">Pronto: {item.result.name}</small>}
        </div>
      ))}
    </div>}
    {items.length > 0 && <button className="primary-action convert-run" onClick={() => void convertAll()} disabled={busy || !convertible}><FileOutput size={17} />{busy ? "Elaborazione…" : `Converti ${convertible} file`}</button>}
    {results.length > 0 && <div className="convert-results">
      <button className="secondary-action convert-run" onClick={() => void downloadAll()} disabled={downloading}><Download size={17} />{downloading ? "Preparazione ZIP…" : `Scarica tutto in ZIP (${results.length})`}</button>
      {results.map((item) => (
        <div className="convert-result" key={item.id}><strong>{item.result!.name}</strong><div><button onClick={() => downloadConverted(item.result!)}><Download size={16} /> Scarica</button><button onClick={() => void saveToBrain(item.id)} disabled={item.saving}>{item.saved ? "Salvato nel Brain" : item.saving ? "Salvataggio…" : "Salva nel Brain"}</button></div></div>
      ))}
    </div>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {message && <p className="brain-note" role="status">{message}</p>}
  </section>;
}
