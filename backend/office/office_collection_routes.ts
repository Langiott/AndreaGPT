import { Router } from "express";
import { z } from "zod";
import { collectionInput, collectionItemInput, collectionPhotoLimit, photoInput, photoChanges, type createCollectionStore } from "./office_collections";
import { OfficeError } from "./office_error";

const itemInput = collectionItemInput.extend({ collectionId: z.uuid() });
const uploadInput = photoInput.extend({ data: z.base64().max(4 * Math.ceil(collectionPhotoLimit / 3)) });

export function collectionRoutes(store: ReturnType<typeof createCollectionStore>) {
  const router = Router();
  router.get("/", (_request, response) => response.json(store.archive()));
  router.post("/", (request, response) => response.status(201).json(store.saveCollection(collectionInput.parse(request.body))));
  router.put("/:id", (request, response) => response.json(store.saveCollection(collectionInput.parse(request.body), request.params.id)));
  router.delete("/:id", (request, response) => {
    if (!store.deleteCollection(request.params.id)) throw new OfficeError("Collezione non trovata.");
    response.sendStatus(204);
  });
  router.post("/items/new", (request, response) => {
    const { collectionId, ...item } = itemInput.parse(request.body);
    response.status(201).json(store.saveItem(collectionId, item));
  });
  router.put("/items/:id", (request, response) => {
    const { collectionId, ...item } = itemInput.parse(request.body);
    response.json(store.saveItem(collectionId, item, request.params.id));
  });
  router.delete("/items/:id", (request, response) => {
    if (!store.deleteItem(request.params.id)) throw new OfficeError("Elemento non trovato.");
    response.sendStatus(204);
  });
  router.post("/items/:id/photos", (request, response) => {
    const { data, ...photo } = uploadInput.parse(request.body);
    response.status(201).json(store.addPhoto(request.params.id, photo, Buffer.from(data, "base64")));
  });
  router.get("/photos/:id", (request, response) => {
    const photo = store.photoData(request.params.id);
    if (!photo) { response.sendStatus(404); return; }
    response.set("X-Content-Type-Options", "nosniff").type(photo.mime).send(Buffer.from(photo.bytes));
  });
  router.patch("/photos/:id", (request, response) => response.json(store.updatePhoto(request.params.id, photoChanges.parse(request.body))));
  router.delete("/photos/:id", (request, response) => {
    if (!store.deletePhoto(request.params.id)) throw new OfficeError("Foto non trovata.");
    response.sendStatus(204);
  });
  return router;
}
