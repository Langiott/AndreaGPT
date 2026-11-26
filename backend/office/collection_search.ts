import type { Collection, CollectionItem, CollectionPhoto } from "./office_collections";

export function groupCollectionPhotos(photos: CollectionPhoto[]) {
  const groups = new Map<string, CollectionPhoto[]>();
  for (const photo of photos) {
    const group = groups.get(photo.itemId);
    if (group) group.push(photo);
    else groups.set(photo.itemId, [photo]);
  }
  return groups;
}

export function collectionSearch(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase("it-IT");
}

export function matchesCollectionItem(item: CollectionItem, collection: Collection | undefined, query: string, type: string, photos: CollectionPhoto[] = []) {
  const text = collectionSearch([item.title, item.notes, ...item.types, collection?.title, collection?.description, ...photos.flatMap(photo => [photo.name, photo.description])].join(" "));
  return (!type || item.types.some(value => collectionSearch(value) === collectionSearch(type)))
    && collectionSearch(query).split(/\s+/).every(word => text.includes(word));
}
