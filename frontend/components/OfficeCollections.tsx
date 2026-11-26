import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Camera, Folder, FolderPlus, Images, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { Collection, CollectionArchive, CollectionItem, CollectionPhoto } from "../../backend/office/office_collections";
import { collectionSearch, groupCollectionPhotos, matchesCollectionItem } from "../../backend/office/collection_search";
import type { OfficeConfirmationRequest } from "./OfficeConfirmation";
import { readFileBase64 } from "../utils/files";
import { SearchField } from "./SearchField";

const endpoint = "/api/office/collections";
const photoUrl = (id: string) => `${endpoint}/photos/${id}`;
export type CollectionSelection = { collection?: string; item?: string; query?: string; type?: string };
type Form = { kind: "collection"; record?: Collection } | { kind: "item"; record?: CollectionItem } | undefined;
type PendingPhoto = { file: File; index: number };

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
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [uploadItem, setUploadItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editPhoto, setEditPhoto] = useState("");

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
          collectionId: fields.get("collectionId"), title, notes: fields.get("notes"),
          types: String(fields.get("types") ?? "").split(",").map(value => value.trim()).filter(Boolean),
        });
        setArchive(await request<CollectionArchive>());
        selectCollection(record.collectionId);
        setItemId(record.id);
        setQuery("");
      }
    });
  }

  function upload(event: FormEvent<HTMLFormElement>, item: CollectionItem) {
    event.preventDefault();
    if (!pending.length || uploadItem !== item.id) return;
    const fields = new FormData(event.currentTarget);
    void change(async () => {
      for (const photo of pending) {
        try {
          if (photo.file.size > 8 * 1024 * 1024) throw new Error("La foto supera 8 MB.");
          const saved = await request<CollectionPhoto>(`/items/${item.id}/photos`, "POST", {
            name: photo.file.name, description: String(fields.get(`caption-${photo.index}`) ?? ""), data: await readFileBase64(photo.file),
          });
          setArchive(current => current && { ...current, photos: [...current.photos, saved] });
          setPending(current => current.filter(value => value !== photo));
        } catch (caught) {
          setError(current => [current, `${photo.file.name}: ${caught instanceof Error ? caught.message : "Caricamento non riuscito."}`].filter(Boolean).join("\n"));
        }
      }
    });
  }

  function savePhoto(photo: CollectionPhoto, changes: { important?: boolean; description?: string }) {
    void change(async () => {
      const saved = await request<CollectionPhoto>(`/photos/${photo.id}`, "PATCH", changes);
      setArchive(current => current && { ...current, photos: current.photos.map(value => value.id === photo.id ? saved : value) });
      setEditPhoto("");
    });
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
  return <section className="office-collections" aria-label="Collezioni">
    <div className="collection-toolbar">
      <select aria-label="Tipologie" value={types.find(value => collectionSearch(value) === collectionSearch(type)) ?? type} onChange={event => { setItemId(""); setType(event.target.value); }}>
        <option value="">Tipologie</option>
        {type && !types.some(value => collectionSearch(value) === collectionSearch(type)) && <option value={type}>{type}</option>}
        {types.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <button type="button" aria-label="Foto importanti" aria-pressed={important} onClick={() => { selectCollection(""); setImportant(!important); }}><Star size={16} /> Foto</button>
      <button type="button" className="office-primary collection-new" aria-label="Nuova collezione" disabled={busy} onClick={() => setForm({ kind: "collection" })}><FolderPlus size={16} /> Nuova</button>
    </div>
    {!collectionOverview && <div className="office-actions"><button type="button" onClick={() => selectCollection("")}><ArrowLeft size={16} /> Collezioni</button></div>}
    {!important && <SearchField label="Cerca nelle collezioni" placeholder="Titoli, note, tipologie o foto" value={query} onChange={value => { setItemId(""); setQuery(value); }} />}
    {error && <p className="office-alert collection-error" role="alert">{error}</p>}
    {!important && <div className="collection-heading">
      <div><h3>{collection?.title ?? "Collezioni"}</h3>{collection?.description && <p>{collection.description}</p>}</div>
      <div className="office-actions">
        {itemId && <button type="button" onClick={() => setItemId("")}>Mostra tutti</button>}
        {!!collections.length && <button type="button" disabled={busy} onClick={() => setForm({ kind: "item" })}><Plus size={16} /> Elemento</button>}
        {collection && <>
          <button type="button" disabled={busy} aria-label="Modifica collezione" onClick={() => setForm({ kind: "collection", record: collection })}><Pencil size={16} /></button>
          <button type="button" disabled={busy} aria-label="Elimina collezione" onClick={() => remove("Elimina collezione", `Eliminare «${collection.title}» con tutti i suoi elementi e le sue foto?`, `/${collection.id}`)}><Trash2 size={16} /></button>
        </>}
      </div>
    </div>}
    {form && <form key={form.record?.id ?? form.kind} className="office-form" onSubmit={save}>
      <strong>{form.record ? "Modifica" : "Aggiungi"} {form.kind === "collection" ? "collezione" : "elemento"}</strong>
      <label>Titolo<input name="title" defaultValue={form.record?.title} required maxLength={160} /></label>
      {form.kind === "collection" ? <label>Descrizione<textarea name="description" maxLength={4000} rows={3} defaultValue={form.record?.description} /></label> : <>
        <label>Collezione<select name="collectionId" defaultValue={form.record?.collectionId ?? (collectionId || collections[0]?.id)} required>{collections.map(value => <option value={value.id} key={value.id}>{value.title}</option>)}</select></label>
        <label>Tipologie, separate da virgole<input name="types" defaultValue={form.record?.types.join(", ")} /></label>
        <label>Note<textarea name="notes" rows={3} maxLength={4000} defaultValue={form.record?.notes} /></label>
      </>}
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
    {!collectionOverview && visible.map(item => {
      const itemPhotos = (photosByItem.get(item.id) ?? []).filter(photo => !important || photo.important);
      const detailsAction = (photo: CollectionPhoto) => remove("Elimina foto", `Eliminare «${photo.name}» da «${item.title}»?`, `/photos/${photo.id}`);
      return <article className="collection-item" key={item.id}>
        <header>
          <div><h4>{item.title}</h4><small>{collectionsById.get(item.collectionId)?.title} · {itemPhotos.length} foto</small></div>
          {!important && <div className="office-actions">
            <button type="button" disabled={busy} aria-label={`Aggiungi foto a ${item.title}`} onClick={() => { setPending([]); setUploadItem(uploadItem === item.id ? "" : item.id); }}><Camera size={16} /></button>
            <button type="button" disabled={busy} aria-label={`Modifica ${item.title}`} onClick={() => { setForm({ kind: "item", record: item }); setItemId(item.id); }}><Pencil size={16} /></button>
            <button type="button" disabled={busy} aria-label={`Elimina ${item.title}`} onClick={() => remove("Elimina elemento", `Eliminare «${item.title}» con le sue foto?`, `/items/${item.id}`)}><Trash2 size={16} /></button>
          </div>}
        </header>
        {!important && <>
          {!!item.types.length && <ul className="collection-types">{item.types.map(value => <li key={value}><button type="button" onClick={() => { setItemId(""); setType(value); }}>{value}</button></li>)}</ul>}
          {item.notes && <p className="collection-notes">{item.notes}</p>}
        </>}
        {!!itemPhotos.length && <div className="collection-gallery">{itemPhotos.map(photo => <figure key={photo.id}>
          <a href={photoUrl(photo.id)} target="_blank" rel="noreferrer"><img src={photoUrl(photo.id)} alt={photo.description || photo.name} loading="lazy" decoding="async" /></a>
          <figcaption><strong>{photo.name}</strong>{photo.description && <span>{photo.description}</span>}</figcaption>
          <div className="office-actions">
            <button type="button" disabled={busy} aria-pressed={photo.important} aria-label={photo.important ? "Rimuovi da Foto importanti" : "Segna come importante"} onClick={() => savePhoto(photo, { important: !photo.important })}><Star size={16} fill={photo.important ? "currentColor" : "none"} /></button>
            {!important && <>
              <button type="button" disabled={busy} aria-label="Modifica descrizione foto" onClick={() => setEditPhoto(photo.id)}><Pencil size={15} /></button>
              <button type="button" disabled={busy} aria-label="Elimina foto" onClick={() => detailsAction(photo)}><Trash2 size={15} /></button>
            </>}
          </div>
          {editPhoto === photo.id && <form className="office-form" onSubmit={event => { event.preventDefault(); savePhoto(photo, { description: String(new FormData(event.currentTarget).get("description")) }); }}>
            <label>Descrizione<input name="description" maxLength={500} defaultValue={photo.description} /></label>
            <div className="office-actions"><button disabled={busy}>Salva</button><button type="button" onClick={() => setEditPhoto("")}>Annulla</button></div>
          </form>}
        </figure>)}</div>}
        {uploadItem === item.id && !important && <form className="office-form" onSubmit={event => upload(event, item)}>
          <label>Seleziona foto<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" disabled={busy} multiple onChange={event => { setPending(Array.from(event.target.files ?? [], (file, index) => ({ file, index }))); event.target.value = ""; }} /></label>
          {pending.map(({ file, index }) => <label key={`${index}-${file.name}-${file.lastModified}`}>{file.name}<input name={`caption-${index}`} placeholder="Descrizione della foto" maxLength={500} disabled={busy} /></label>)}
          <div className="office-actions"><button className="office-primary" disabled={busy || !pending.length}>{busy ? "Caricamento…" : "Carica foto"}</button><button type="button" disabled={busy} onClick={() => { setUploadItem(""); setPending([]); }}>Chiudi</button></div>
        </form>}
      </article>;
    })}
  </section>;
}
