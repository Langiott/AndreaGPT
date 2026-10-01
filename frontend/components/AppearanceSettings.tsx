/// <reference types="vite/client" />
import { useEffect, useState } from "react";
import { ChevronDown, Pin } from "lucide-react";
import { createId } from "../utils/compat";

const defaults = Object.entries(import.meta.glob<string>("../../img/universe/*.{webp,jpg,jpeg,png}", { eager: true, query: "?url", import: "default" }))
  .sort(([a], [b]) => a.localeCompare(b)).map(([id, url]) => ({ id, url, name: id.split("/").slice(-1)[0] }));
export const fonts = { mono: '"Geist Mono", Consolas, monospace', system: 'Arial, Helvetica, sans-serif', serif: 'Georgia, "Times New Roman", serif' };
type Preferences = { font: keyof typeof fonts; size: number; hidden: string[]; pinned?: string };
type Picture = { id: string; name: string; url: string };
type StoredPicture = { id: string; name: string; file: Blob };

async function picturesStore(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("andreagpt-backgrounds", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pictures", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("pictures", mode);
      const request = action(transaction.objectStore("pictures"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function useAppearance() {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("andreagpt-appearance") ?? "{}");
      // I percorsi delle immagini sono cambiati nel tempo: nascosti e fissato vanno portati al percorso attuale.
      const migrate = (id: string) => id.replace("../UNIVERSE/", "../../img/universe/").replace(/^\.\.\/img\/universe\//, "../../img/universe/");
      const hidden = Array.isArray(value.hidden) ? value.hidden.filter((id: unknown): id is string => typeof id === "string").map(migrate) : [];
      return { font: Object.prototype.hasOwnProperty.call(fonts, value.font) ? value.font : "mono", size: Number.isFinite(value.size) ? Math.max(12, Math.min(24, value.size)) : 14, hidden, pinned: typeof value.pinned === "string" ? migrate(value.pinned) : undefined };
    } catch { return { font: "mono", size: 14, hidden: [] }; }
  });
  const [custom, setCustom] = useState<Picture[]>([]);
  const [loaded, setLoaded] = useState(false); // sfondi letti dal browser: evita uno sfondo a caso all'avvio
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    picturesStore("readonly", store => store.getAll()).then(data => {
      if (!active) return;
      setCustom((data as StoredPicture[]).map(item => { const url = URL.createObjectURL(item.file); urls.push(url); return { id: item.id, name: item.name, url }; }));
    }).catch(() => { if (active) setError("Impossibile leggere gli sfondi salvati nel browser."); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  const pictures = [...defaults.filter(item => !preferences.hidden.includes(item.id)), ...custom];
  function update(next: Preferences) {
    try { localStorage.setItem("andreagpt-appearance", JSON.stringify(next)); setPreferences(next); setError(""); }
    catch { setError("Impossibile salvare le preferenze nel browser."); }
  }
  async function add(files: File[]) {
    setBusy(true); setError("");
    try {
      for (const file of files) {
        if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) throw new Error(`Formato non supportato: ${file.name}`);
        const url = URL.createObjectURL(file);
        try {
          const image = new Image(); image.src = url; await image.decode();
          const id = createId();
          await picturesStore("readwrite", store => store.put({ id, name: file.name, file }));
          setCustom(previous => [...previous, { id, name: file.name, url }]);
        } catch (error) { URL.revokeObjectURL(url); throw error; }
      }
    } catch (error) { setError(`Caricamento interrotto: ${error instanceof Error ? error.message : "spazio del browser non disponibile"}. Le immagini già aggiunte sono conservate.`); }
    finally { setBusy(false); }
  }
  async function remove(picture: Picture) {
    // Eliminando lo sfondo fissato si toglie anche il fissaggio.
    const pinned = preferences.pinned === picture.id ? undefined : preferences.pinned;
    if (defaults.some(item => item.id === picture.id)) { update({ ...preferences, hidden: [...preferences.hidden, picture.id], pinned }); return; }
    if (pinned !== preferences.pinned) update({ ...preferences, pinned });
    setBusy(true); setError("");
    try {
      await picturesStore("readwrite", store => store.delete(picture.id));
      setCustom(previous => previous.filter(item => item.id !== picture.id));
      URL.revokeObjectURL(picture.url);
    } catch { setError("Impossibile eliminare l'immagine. Riprova."); }
    finally { setBusy(false); }
  }
  return { preferences, pictures, update, add, remove, error, busy, loaded };
}

export function SettingsInfo({ text }: { text: string }) {
  void text;
  return null;
}

export function AppearanceSettings({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  const { preferences, pictures, update, add, remove, error, busy } = appearance;
  const [pinMode, setPinMode] = useState(false);
  return <>
    <details className="settings-section appearance-settings settings-collapse">
      <summary className="settings-collapse-title"><span><strong>Testo della chat</strong><SettingsInfo text="Anteprima immediata nei messaggi e nella barra di scrittura." /></span><ChevronDown size={15} /></summary>
      <label>Carattere<select value={preferences.font} onChange={e => update({ ...preferences, font: e.target.value as keyof typeof fonts })}><option value="mono">Geist Mono · originale</option><option value="system">Arial · semplice</option><option value="serif">Georgia · classico</option></select></label>
      <label>Dimensione: {preferences.size} px<input type="range" min="12" max="24" step="1" value={preferences.size} onChange={e => update({ ...preferences, size: Number(e.target.value) })} /></label>
      <p style={{ fontFamily: fonts[preferences.font], fontSize: preferences.size }}>Il tuo prossimo viaggio inizia con una domanda.</p>
    </details>
    <details className="settings-section appearance-settings settings-collapse">
      <summary className="settings-collapse-title"><span><strong>Sfondi della chat</strong><SettingsInfo text="Le immagini cambiano ogni 5 minuti. Con Fissa puoi scegliere uno sfondo permanente." /></span><span className="background-actions"><label className="background-action"><span>Carica</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple disabled={busy} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void add(files); }} /></label><button type="button" className={pinMode ? "active" : ""} onClick={e => { e.preventDefault(); setPinMode(value => !value); }}><Pin size={13} /> Fissa</button><ChevronDown size={15} /></span></summary>
      {busy && <p role="status">Salvataggio immagini…</p>}
      {error && <p role="alert">{error}</p>}
      <div className={`background-gallery ${pinMode ? "pin-mode" : ""}`}>{pictures.map(picture => <div key={picture.id} className={preferences.pinned === picture.id ? "pinned" : ""}><button type="button" className="background-preview" disabled={busy} onClick={() => pinMode && update({ ...preferences, pinned: preferences.pinned === picture.id ? undefined : picture.id })}><img src={picture.url} alt={picture.name} loading="lazy" />{preferences.pinned === picture.id && <span className="background-pin-badge" title="Sfondo fissato"><Pin size={12} fill="currentColor" /></span>}</button><div className="background-card-actions"><span>{picture.name}</span><button type="button" disabled={busy} aria-label={`Elimina sfondo ${picture.name}`} onClick={() => void remove(picture)}>Elimina</button></div></div>)}</div>
      {!pictures.length && <p>Nessuno sfondo: la chat usa il colore del tema.</p>}
      {!!preferences.hidden.length && <button type="button" onClick={() => update({ ...preferences, hidden: [] })}>Ripristina sfondi originali</button>}
    </details>
  </>;
}
