import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Camera, ChevronLeft, ChevronRight, Plus, X, Folder, FolderPlus, Images, Pencil, Star, Trash2 } from "lucide-react";
import type { Collection, CollectionArchive, CollectionItem, CollectionPhoto } from "../../backend/office/office_collections";
import { collectionSearch, groupCollectionPhotos, matchesCollectionItem } from "../../backend/office/collection_search";
import type { OfficeConfirmationRequest } from "./OfficeConfirmation";
import { readFileBase64 } from "../utils/files";
import { SearchField } from "./SearchField";

const endpoint = "/api/office/collections";
const photoUrl = (id: string) => `${endpoint}/photos/${id}`;
export type CollectionSelection = { collection?: string; item?: string; query?: string; type?: string };
type Form = { kind: "collection"; record?: Collection } | { kind: "item"; record?: CollectionItem } | undefined;

async function request<T>(path = "", method = "GET", body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint + path, {
    method, signal, cache: "no-store",
    ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Operazione sulle collezioni non riuscita.");
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function OfficeCollections({ selection, confirm }: { selection: CollectionSelection; confirm: (request: OfficeConfirmationRequest) => void }) {
  const [archive, setArchive] = useState<CollectionArchive>();
  const [collectionId, setCollectionId] = useState(selection.collection ?? "");
  const [itemId, setItemId] = useState(selection.item ?? "");
  const [query, setQuery] = useState(selection.query ?? "");
  const [type, setType] = useState(selection.type ?? "");
  const [important, setImportant] = useState(false);
  const [form, setForm] = useState<Form>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState<number>();

  useEffect(() => {
    const controller = new AbortController();
    void request<CollectionArchive>("", "GET", undefined, controller.signal).then(setArchive, caught => {
      if (!controller.signal.aborted) setError(String(caught.message));
    });
    return () => controller.abort();
  }, []);

  async function change(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Operazione non riuscita."); }
    finally { setBusy(false); }
  }

  const collections = archive?.collections ?? [];
  const items = archive?.items ?? [];
  const photos = archive?.photos ?? [];
  const collectionsById = useMemo(() => new Map(collections.map(collection => [collection.id, collection])), [archive]);
  const photosByItem = useMemo(() => groupCollectionPhotos(photos), [archive]);
  const collection = collectionsById.get(collectionId);
  const collectionOverview = !collection && !important && !itemId;
  const itemsByCollection = new Map<string, CollectionItem[]>();
  for (const item of items) {
    const group = itemsByCollection.get(item.collectionId) ?? [];
    group.push(item);
    itemsByCollection.set(item.collectionId, group);
  }
  const scope = collection ? items.filter(item => item.collectionId === collection.id) : items;
  const types = [...new Map(scope.flatMap(item => item.types.map(value => [collectionSearch(value), value] as const))).values()].sort((left, right) => left.localeCompare(right, "it"));
  const visible = (important ? items : scope).filter(item => (!itemId || item.id === itemId)
    && matchesCollectionItem(item, collectionsById.get(item.collectionId), query, type, photosByItem.get(item.id))
    && (!important || photosByItem.get(item.id)?.some(photo => photo.important)));
  const matchingCollections = new Set(visible.map(item => item.collectionId));
  const shownCollections = collections.filter(value => (!type && collectionSearch(`${value.title} ${value.description}`).includes(collectionSearch(query))) || matchingCollections.has(value.id));

  function selectCollection(id: string) {
    setCollectionId(id);
    setItemId("");
    setType("");
    setQuery("");
    setImportant(false);
    setForm(undefined);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = String(fields.get("title") ?? "");
    if (!form) return;
    void change(async () => {
      if (form.kind === "collection") {
        const record = await request<Collection>(form.record ? `/${form.record.id}` : "", form.record ? "PUT" : "POST", { title, description: fields.get("description") });
        setArchive(await request<CollectionArchive>());
        selectCollection(record.id);
        setQuery("");
      } else {
        const record = await request<CollectionItem>(form.record ? `/items/${form.record.id}` : "/items/new", form.record ? "PUT" : "POST", {
          collectionId: fields.get("collectionId"), title, notes: form.record?.notes ?? "",
          types: String(fields.get("types") ?? "").split(",").map(value => value.trim()).filter(Boolean),
        });
        setArchive(await request<CollectionArchive>());
        selectCollection(record.collectionId);
        setItemId(record.id);
        setQuery("");
      }
    });
  }

  function upload(files: File[], target: Collection) {
    if (!files.length) return;
    void change(async () => {
      for (const file of files) {
        try {
          if (file.size > 8 * 1024 * 1024) throw new Error("La foto supera 8 MB.");
          const item = await request<CollectionItem>("/items/new", "POST", {
            collectionId: target.id, title: file.name.replace(/\.[^.]+$/, "") || file.name, notes: "", types: [],
          });
          await request<CollectionPhoto>(`/items/${item.id}/photos`, "POST", { name: file.name, description: "", data: await readFileBase64(file) });
        } catch (caught) {
          setError(current => [current, `${file.name}: ${caught instanceof Error ? caught.message : "Caricamento non riuscito."}`].filter(Boolean).join("\n"));
        }
      }
      setArchive(await request<CollectionArchive>());
    });
  }

  function removePhoto(photo: CollectionPhoto, item: CollectionItem) {
    const last = (photosByItem.get(item.id) ?? []).length <= 1;
    confirm({ title: "Elimina foto", description: `Eliminare la foto di «${item.title}»?`, label: "Elimina", action: () => void change(async () => {
      await request(last ? `/items/${item.id}` : `/photos/${photo.id}`, "DELETE");
      setArchive(await request<CollectionArchive>());
    }) });
  }

  function remove(title: string, description: string, path: string) {
    confirm({ title, description, label: "Elimina", action: () => void change(async () => {
      await request(path, "DELETE");
      setArchive(await request<CollectionArchive>());
      if (path === `/${collectionId}`) selectCollection("");
      if (path === `/items/${itemId}`) setItemId("");
    }) });
  }

  if (!archive) return error ? <p className="office-alert" role="alert">{error}</p> : <p className="office-empty">Caricamento collezioni…</p>;
  const gallery: GalleryEntry[] = collectionOverview ? [] : visible.flatMap(item => (photosByItem.get(item.id) ?? []).filter(photo => !important || photo.important).map(photo => ({ photo, item })));
  const current = viewer === undefined ? undefined : gallery[Math.min(viewer, gallery.length - 1)];
  return <section className="office-collections" aria-label="Collezioni">
    <div className="collection-toolbar">
      {!collectionOverview && <button type="button" onClick={() => selectCollection("")}><ChevronLeft size={16} /> Collezioni</button>}
      <select aria-label="Tipologie" value={types.find(value => collectionSearch(value) === collectionSearch(type)) ?? type} onChange={event => { setItemId(""); setType(event.target.value); }}>
        <option value="">Tipologie</option>
        {type && !types.some(value => collectionSearch(value) === collectionSearch(type)) && <option value={type}>{type}</option>}
        {types.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <button type="button" aria-label="Foto importanti" aria-pressed={important} onClick={() => { selectCollection(""); setImportant(!important); }}><Star size={16} /> Foto</button>
      <button type="button" className="office-primary collection-new" aria-label="Nuova collezione" disabled={busy} onClick={() => setForm({ kind: "collection" })}><FolderPlus size={16} /> Nuova</button>
    </div>
    {!important && <SearchField label="Cerca nelle collezioni" placeholder="Titoli, note, tipologie o foto" value={query} onChange={value => { setItemId(""); setQuery(value); }} />}
    {error && <p className="office-alert collection-error" role="alert">{error}</p>}
    {!important && <div className="collection-heading">
      <div><h3>{collection?.title ?? "Collezioni"}</h3>{collection?.description && <p>{collection.description}</p>}</div>
      <div className="office-actions">
        {itemId && <button type="button" onClick={() => setItemId("")}>Mostra tutti</button>}
        {collection && <>
          <label className="collection-upload" aria-disabled={busy}><Camera size={16} /> Aggiungi foto
            <input type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple disabled={busy} onChange={event => { upload(Array.from(event.target.files ?? []), collection); event.target.value = ""; }} />
          </label>
          <button type="button" disabled={busy} aria-label="Modifica collezione" onClick={() => setForm({ kind: "collection", record: collection })}><Pencil size={16} /></button>
          <button type="button" disabled={busy} aria-label="Elimina collezione" onClick={() => remove("Elimina collezione", `Eliminare «${collection.title}» con tutti i suoi elementi e le sue foto?`, `/${collection.id}`)}><Trash2 size={16} /></button>
        </>}
      </div>
    </div>}
    {form && <form key={form.record?.id ?? form.kind} className="office-form" onSubmit={save}>
      <strong>{form.record ? "Modifica" : "Aggiungi"} {form.kind === "collection" ? "collezione" : "elemento"}</strong>
      <div className={form.kind === "item" ? "collection-form-row" : "collection-form-col"}><label>Titolo<input name="title" defaultValue={form.record?.title} required maxLength={160} /></label>
      {form.kind === "collection" ? <label>Descrizione<textarea name="description" maxLength={4000} rows={3} defaultValue={form.record?.description} /></label> : <>
        <label>Collezione<select name="collectionId" defaultValue={form.record?.collectionId ?? (collectionId || collections[0]?.id)} required>{collections.map(value => <option value={value.id} key={value.id}>{value.title}</option>)}</select></label>
        <label>Tipologie<input name="types" defaultValue={form.record?.types.join(", ")} /></label>
      </>}</div>
      <div className="office-actions"><button className="office-primary" disabled={busy}>Salva</button><button type="button" onClick={() => setForm(undefined)}>Annulla</button></div>
    </form>}
    {important && <h3 className="collection-folder"><Images size={18} /> Foto importanti</h3>}
    {collectionOverview && <div className="collection-grid">{shownCollections.map(value => {
      const group = itemsByCollection.get(value.id) ?? [];
      const cover = group.flatMap(item => photosByItem.get(item.id) ?? [])[0];
      return <button type="button" className="collection-card" key={value.id} onClick={() => selectCollection(value.id)}>
        <span className="collection-cover">{cover ? <img src={photoUrl(cover.id)} alt="" loading="lazy" decoding="async" /> : <Folder size={30} />}</span>
        <strong>{value.title}</strong><small>{group.length} {group.length === 1 ? "elemento" : "elementi"}</small>
      </button>;
    })}</div>}
    {(!collectionOverview && !visible.length || collectionOverview && collections.length > 0 && !shownCollections.length) && <p className="office-empty">{important ? "Nessuna foto importante." : collectionOverview ? "Nessuna collezione trovata." : "Nessun elemento trovato."}</p>}
    {collectionOverview && !collections.length && <p className="office-empty">Crea la prima collezione per aggiungere elementi.</p>}
    {!collectionOverview && <div className="collection-photo-grid">{gallery.map(({ photo, item }, index) =>
      <figure key={photo.id}>
        <button type="button" className="collection-photo-open" title={item.title} onClick={() => setViewer(index)}><img src={photoUrl(photo.id)} alt={item.title} loading="lazy" decoding="async" /></button>
        <button type="button" className="collection-photo-delete" disabled={busy} aria-label="Elimina foto" onClick={() => removePhoto(photo, item)}><Trash2 size={14} /></button>
      </figure>)}</div>}
    {current && <PhotoViewer key={current.item.id + current.photo.id} entry={current} collections={collections} busy={busy}
      hasPrev={viewer! > 0} hasNext={viewer! < gallery.length - 1}
      onMove={step => setViewer(value => value === undefined ? value : Math.min(gallery.length - 1, Math.max(0, value + step)))}
      onClose={() => setViewer(undefined)}
      onSave={changes => void change(async () => {
        await request<CollectionItem>(`/items/${current.item.id}`, "PUT", { notes: current.item.notes, ...changes });
        setArchive(await request<CollectionArchive>());
      })} />}
  </section>;
}

type GalleryEntry = { photo: CollectionPhoto; item: CollectionItem };

function PhotoViewer({ entry, collections, busy, hasPrev, hasNext, onMove, onClose, onSave }: {
  entry: GalleryEntry; collections: Collection[]; busy: boolean; hasPrev: boolean; hasNext: boolean;
  onMove: (step: number) => void; onClose: () => void; onSave: (changes: { title: string; collectionId: string; types: string[] }) => void;
}) {
  const { photo, item } = entry;
  const [title, setTitle] = useState(item.title);
  const [collectionId, setCollectionId] = useState(item.collectionId);
  const [fields, setFields] = useState(() => item.types.map(splitType));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      if (event.key === "ArrowLeft") onMove(-1);
      else if (event.key === "ArrowRight") onMove(1);
      else if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMove, onClose]);
  const types = fields.filter(field => field.name.trim()).map(field => field.value.trim() ? `${field.name.trim()}: ${field.value.trim()}` : field.name.trim());
  function addField() {
    if (!newName.trim()) return;
    setFields([...fields, { name: newName.trim(), value: newValue.trim() }]);
    setNewName(""); setNewValue(""); setAdding(false);
  }
  const dirty = title.trim() !== item.title || collectionId !== item.collectionId || types.join("\n") !== item.types.join("\n");
  return <div className="collection-viewer" role="dialog" aria-label={item.title}>
    <div className="collection-viewer-stage">
      <button type="button" aria-label="Foto precedente" disabled={!hasPrev} onClick={() => onMove(-1)}><ChevronLeft size={22} /></button>
      <img src={photoUrl(photo.id)} alt={item.title} />
      <button type="button" aria-label="Foto successiva" disabled={!hasNext} onClick={() => onMove(1)}><ChevronRight size={22} /></button>
      <button type="button" className="collection-viewer-close" aria-label="Chiudi" onClick={onClose}><X size={20} /></button>
    </div>
    <form className="collection-viewer-form" onSubmit={event => { event.preventDefault(); onSave({ title: title.trim() || item.title, collectionId, types }); }}>
      <input aria-label="Nome" value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required />
      <select aria-label="Collezione" value={collectionId} onChange={event => setCollectionId(event.target.value)}>
        {collections.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
      </select>
      {fields.map((field, index) => <div className="collection-viewer-field" key={index}>
        <strong>{field.name}</strong>
        <input aria-label={`Valore ${field.name}`} placeholder="Valore" value={field.value} onChange={event => setFields(fields.map((value, position) => position === index ? { ...value, value: event.target.value } : value))} />
        <button type="button" aria-label={`Togli ${field.name}`} onClick={() => setFields(fields.filter((_, position) => position !== index))}><X size={14} /></button>
      </div>)}
      {adding ? <div className="collection-viewer-field">
        <input aria-label="Nome categoria" placeholder="Nome categoria" value={newName} autoFocus onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addField(); } }} />
        <input aria-label="Valore" placeholder="Valore" value={newValue} onChange={event => setNewValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addField(); } }} />
        <button type="button" disabled={!newName.trim()} onClick={addField}>Aggiungi</button>
        <button type="button" aria-label="Annulla" onClick={() => { setAdding(false); setNewName(""); setNewValue(""); }}><X size={14} /></button>
      </div> : <button type="button" className="collection-viewer-add" onClick={() => setAdding(true)}><Plus size={14} /> Aggiungi categoria</button>}
      <button className="office-primary" disabled={busy || !dirty}>Salva</button>
    </form>
  </div>;
}


function splitType(value: string) {
  const index = value.indexOf(":");
  return index < 0 ? { name: value, value: "" } : { name: value.slice(0, index).trim(), value: value.slice(index + 1).trim() };
}