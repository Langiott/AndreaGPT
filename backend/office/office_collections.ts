import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { OfficeError } from "./office_error";

const title = z.string().trim().min(1).max(160);
const notes = z.string().trim().max(4000);
const types = z.array(z.string().trim().min(1).max(60)).max(20);
const photoDescription = z.string().trim().max(500);
export const collectionInput = z.object({ title, description: notes.default("") });
export const collectionItemInput = z.object({ title, notes: notes.default(""), types: types.default([]) });
export const photoInput = z.object({ name: z.string().trim().min(1).max(240), description: photoDescription.default("") });
export const photoChanges = z.object({ description: photoDescription.optional(), important: z.boolean().optional() });

export type Collection = z.infer<typeof collectionInput> & { id: string };
export type CollectionItem = z.infer<typeof collectionItemInput> & { id: string; collectionId: string };
export type CollectionPhoto = z.infer<typeof photoInput> & { id: string; itemId: string; important: boolean };
export type CollectionArchive = { collections: Collection[]; items: CollectionItem[]; photos: CollectionPhoto[] };

export const collectionIntents = [
  z.object({ action: z.literal("createCollection"), title, description: notes.optional() }),
  z.object({ action: z.literal("renameCollection"), collection: title, title }),
  z.object({ action: z.literal("removeCollection"), collection: title }),
  z.object({ action: z.literal("addItem"), collection: title, title, notes: notes.optional(), types: types.optional() }),
  z.object({ action: z.literal("editItem"), collection: title, title, newTitle: title.optional(), replaceNote: notes.optional(), appendNote: notes.optional(), replaceTypes: types.optional(), addTypes: types.optional(), removeTypes: types.optional() }),
  z.object({ action: z.literal("removeItem"), collection: title, title }),
  z.object({ action: z.literal("searchCollections"), collection: title.optional(), query: title.optional(), type: title.optional() }),
  z.object({ action: z.literal("collectionStats"), collection: title.optional() }),
] as const;

const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("it-IT");

const signatures = {
  "image/jpeg": (bytes: Buffer) => bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
  "image/png": (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  "image/webp": (bytes: Buffer) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
  "image/gif": (bytes: Buffer) => /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6)),
  "image/avif": (bytes: Buffer) => bytes.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(bytes.toString("ascii", 8, 12)),
};
export const collectionPhotoLimit = 8 * 1024 * 1024;
export const photoMime = (bytes: Buffer) => Object.entries(signatures).find(([, check]) => check(bytes))?.[0];

export function createCollectionStore(db: DatabaseSync) {
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collection_items (id TEXT PRIMARY KEY, collectionId TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, name TEXT NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL, types TEXT NOT NULL, UNIQUE(collectionId, name));
    CREATE TABLE IF NOT EXISTS collection_photos (id TEXT PRIMARY KEY, itemId TEXT NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, important INTEGER NOT NULL DEFAULT 0, mime TEXT NOT NULL, bytes BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS collection_photos_item ON collection_photos(itemId);`);

  const columns = "id, itemId, name, description, important";
  const decodeItem = (row: Record<string, unknown>) => ({ ...row, types: JSON.parse(String(row.types)) }) as CollectionItem;
  const decodePhoto = (row: Record<string, unknown>) => ({ ...row, important: Boolean(row.important) }) as CollectionPhoto;
  const collectionById = (id: string) => db.prepare("SELECT id, title, description FROM collections WHERE id = ?").get(id) as Collection | undefined;
  const itemById = (id: string) => {
    const row = db.prepare("SELECT id, collectionId, title, notes, types FROM collection_items WHERE id = ?").get(id);
    return row && decodeItem(row);
  };
  const photoById = (id: string) => {
    const row = db.prepare(`SELECT ${columns} FROM collection_photos WHERE id = ?`).get(id);
    return row && decodePhoto(row);
  };
  const requireRecord = <T>(record: T | undefined, message: string): T => {
    if (!record) throw new OfficeError(message);
    return record;
  };
  const findCollection = (name: string) => db.prepare("SELECT id, title, description FROM collections WHERE name = ?").get(normalized(name)) as Collection | undefined;
  const collectionByName = (name: string) => requireRecord(
    findCollection(name),
    `Collezione «${name}» non trovata.`,
  );
  const findItem = (collectionId: string, name: string) => {
    const row = db.prepare("SELECT id, collectionId, title, notes, types FROM collection_items WHERE collectionId = ? AND name = ?").get(collectionId, normalized(name));
    return row && decodeItem(row);
  };
  // Nome esatto; altrimenti l'unico elemento il cui titolo contiene (o è contenuto in) quello chiesto:
  // "Dark Side of the Moon" trova "Dark Side of the Moon dei Pink Floyd". Con più candidati non sceglie.
  const itemByName = (collectionId: string, name: string) => {
    const exact = findItem(collectionId, name);
    if (exact) return exact;
    const key = normalized(name);
    const candidates = key.length < 3 ? [] : (db.prepare("SELECT id, collectionId, title, notes, types, name FROM collection_items WHERE collectionId = ?").all(collectionId) as { name: string }[])
      .filter(row => row.name.includes(key) || key.includes(row.name));
    if (candidates.length > 1) throw new OfficeError(`Più elementi corrispondono a «${name}»: specifica il titolo completo.`);
    return requireRecord(candidates[0] && decodeItem(candidates[0] as never), `Elemento «${name}» non trovato nella collezione.`);
  };
  function saveCollection(input: z.infer<typeof collectionInput>, id?: string) {
    const key = normalized(input.title);
    const existing = db.prepare("SELECT id FROM collections WHERE name = ?").get(key);
    if (existing && existing.id !== id) throw new OfficeError("Esiste già una collezione con questo nome.");
    if (id) {
      requireRecord(collectionById(id), "Collezione non trovata.");
      db.prepare("UPDATE collections SET name = ?, title = ?, description = ? WHERE id = ?").run(key, input.title, input.description, id);
      return { ...input, id };
    }
    const created = randomUUID();
    db.prepare("INSERT INTO collections VALUES (?, ?, ?, ?)").run(created, key, input.title, input.description);
    return { ...input, id: created };
  }
  function saveItem(collectionId: string, input: z.infer<typeof collectionItemInput>, id?: string) {
    requireRecord(collectionById(collectionId), "Collezione non trovata.");
    const key = normalized(input.title);
    const existing = db.prepare("SELECT id FROM collection_items WHERE collectionId = ? AND name = ?").get(collectionId, key);
    if (existing && existing.id !== id) throw new OfficeError("Esiste già un elemento con questo titolo nella collezione.");
    const distinct = [...new Map(input.types.map(type => [normalized(type), type])).values()];
    if (id) {
      requireRecord(itemById(id), "Elemento non trovato.");
      db.prepare("UPDATE collection_items SET collectionId = ?, name = ?, title = ?, notes = ?, types = ? WHERE id = ?")
        .run(collectionId, key, input.title, input.notes, JSON.stringify(distinct), id);
      return { ...input, id, collectionId, types: distinct };
    }
    const created = randomUUID();
    db.prepare("INSERT INTO collection_items VALUES (?, ?, ?, ?, ?, ?)").run(created, collectionId, key, input.title, input.notes, JSON.stringify(distinct));
    return { ...input, id: created, collectionId, types: distinct };
  }
  function savePhoto(itemId: string, input: z.infer<typeof photoInput>, mime: string, bytes: Buffer) {
    const id = randomUUID();
    db.prepare("INSERT INTO collection_photos (id, itemId, name, description, mime, bytes) VALUES (?, ?, ?, ?, ?, ?)").run(id, itemId, input.name, input.description, mime, bytes);
    return { ...input, id, itemId, important: false };
  }
  return {
    collectionById, collectionByName, itemById, itemByName, saveCollection, saveItem,
    catalog(collectionTitle: string, itemTitle: string, type: string, photos: { name: string; mime: string; bytes: Buffer }[]) {
      db.exec("BEGIN");
      try {
        const collection = findCollection(collectionTitle) ?? saveCollection({ title: collectionTitle, description: "" });
        const existing = findItem(collection.id, itemTitle);
        const types = existing?.types ?? [];
        if (!types.some(value => normalized(value) === normalized(type))) {
          if (types.length === 20) throw new OfficeError("L’elemento ha già 20 tipologie.");
          types.push(type);
        }
        const item = saveItem(collection.id, { title: existing?.title ?? itemTitle, notes: existing?.notes ?? "", types }, existing?.id);
        const hasPhoto = db.prepare("SELECT 1 FROM collection_photos WHERE itemId = ? AND bytes = ?");
        let addedPhotos = 0;
        for (const photo of photos) {
          if (hasPhoto.get(item.id, photo.bytes)) continue;
          savePhoto(item.id, { name: photo.name, description: "" }, photo.mime, photo.bytes);
          addedPhotos++;
        }
        db.exec("COMMIT");
        return { collection, item, addedPhotos, existed: Boolean(existing) };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    archive(): CollectionArchive {
      return {
        collections: db.prepare("SELECT id, title, description FROM collections ORDER BY title COLLATE NOCASE").all() as Collection[],
        items: db.prepare("SELECT id, collectionId, title, notes, types FROM collection_items ORDER BY title COLLATE NOCASE").all().map(decodeItem),
        photos: db.prepare(`SELECT ${columns} FROM collection_photos ORDER BY rowid`).all().map(decodePhoto),
      };
    },
    deleteCollection: (id: string) => Boolean(db.prepare("DELETE FROM collections WHERE id = ?").run(id).changes),
    deleteItem: (id: string) => Boolean(db.prepare("DELETE FROM collection_items WHERE id = ?").run(id).changes),
    deletePhoto: (id: string) => Boolean(db.prepare("DELETE FROM collection_photos WHERE id = ?").run(id).changes),
    addPhoto(itemId: string, input: z.infer<typeof photoInput>, bytes: Buffer) {
      requireRecord(itemById(itemId), "Elemento non trovato.");
      const mime = photoMime(bytes);
      if (!mime || bytes.length > collectionPhotoLimit) throw new OfficeError("Carica una foto JPEG, PNG, WebP, GIF o AVIF fino a 8 MB.");
      return savePhoto(itemId, input, mime, bytes);
    },
    updatePhoto(id: string, changes: z.infer<typeof photoChanges>) {
      const photo = { ...requireRecord(photoById(id), "Foto non trovata."), ...changes };
      db.prepare("UPDATE collection_photos SET description = ?, important = ? WHERE id = ?").run(photo.description, Number(photo.important), id);
      return photo;
    },
    photoData: (id: string) => db.prepare("SELECT mime, bytes FROM collection_photos WHERE id = ?").get(id) as { mime: string; bytes: Uint8Array } | undefined,
  };
}
