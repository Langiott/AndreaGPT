import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { createOffice, OfficeError } from "./office/office";
import { intentSchema, planSchema, localDay, priceCandidate, priceSchema, requestSchema, type OfficeActivity } from "./office/office_schema";
import { photoChanges } from "./office/office_collections";
import { readPageForNote } from "./office/web_note";

const tools = {
  classify: async () => intentSchema.parse({ action: "list", kind: "film" }),
  search: async () => [],
  photos: async () => [],
};

test("il Chatbot salva il riassunto del link nelle Note con la fonte", async () => {
  const url = "https://example.org/ricetta";
  const office = createOffice(":memory:", "Europe/Rome", {
    ...tools,
    classify: async () => assert.fail("Il link va letto prima di usare il classificatore"),
    summarizeLink: async link => {
      assert.equal(link, url);
      return { title: "Ricetta", notes: "Ingredienti e procedimento", url };
    },
  });
  try {
    const job = await office.request(`Riassumi ${url} e salvalo nelle note`, "board", undefined, true).done;
    assert.equal(job?.status, "done");
    assert.match(job?.result?.view ?? "", /office=note&entry=/);
    const [entry] = office.snapshot().entries;
    assert.equal(entry.kind, "note");
    assert.equal("url" in entry && entry.url, url);
    assert.equal("notes" in entry && entry.notes, "Ingredienti e procedimento");
  } finally { office.close(); }
});

test("il lettore delle Note rifiuta indirizzi locali e URL con credenziali", async () => {
  for (const url of ["http://127.0.0.1/", "https://[::1]/", "https://user@example.org/", "https://example.org:8188/", "https://pc.example.ts.net/"]) {
    await assert.rejects(readPageForNote(url), /pagina pubblica/);
  }
});

test("smista, accoda e rende idempotenti le richieste Telegram", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const office = createOffice(":memory:", "Europe/Rome", { ...tools, classify: async () => {
    await gate;
    return intentSchema.parse({ action: "add", entry: { kind: "appointment", title: "Visita", day: "2030-04-03", time: "13:00" } });
  } });
  const first = office.request("Aggiungi la visita", "telegram", "bot:owner:message");
  const second = office.add({ kind: "film", title: "Arrival" });
  assert.equal(office.snapshot().jobs[0].status, "queued");
  const duplicate = office.request("Aggiungi la visita", "telegram", "bot:owner:message");
  assert.equal(duplicate.id, first.id);
  assert.equal(await duplicate.done, null);
  release();
  const [recorded, added] = await Promise.all([first.done, second.done]);
  assert.deepEqual(recorded?.events.map(event => event.role), ["secretary", "secretary", "secretary", "executor", "keeper", "director"]);
  assert.equal(added?.status, "done");
  assert.equal(office.snapshot().entries.length, 2);
  office.close();
});

test("pubblica ID e fasi reali per i client iscritti all’attività", async () => {
  const office = createOffice(":memory:", "Europe/Rome", tools);
  try {
    const events: (OfficeActivity | null)[] = [];
    const unsubscribe = office.subscribeActivity(event => events.push(event));
    const request = office.request("Mostrami la lista dei film", "board");
    await request.done;
    assert.deepEqual(events, [
      null,
      { id: request.id, stage: "secretary", status: "queued" },
      { id: request.id, stage: "secretary", status: "running" },
      { id: request.id, stage: "secretary", status: "running" },
      { id: request.id, stage: "executor", status: "running" },
      { id: request.id, stage: "keeper", status: "running" },
      { id: request.id, stage: "director", status: "done" },
    ]);
    unsubscribe();
    const next = office.request("Mostrami di nuovo la lista", "board");
    await next.done;
    assert.equal(events.length, 7);
    const latest: (OfficeActivity | null)[] = [];
    office.subscribeActivity(event => latest.push(event))();
    assert.deepEqual(latest, [{ id: next.id, stage: "director", status: "done" }]);
  } finally {
    office.close();
  }
});

test("cerca fonti per l’edizione selezionata e salva il prezzo soltanto su conferma", async () => {
  const queries: string[] = [];
  const source = { title: "Vendita", url: "https://example.com/item", snippet: "30 EUR" };
  const office = createOffice(":memory:", "Europe/Rome", {
    ...tools, search: async query => { queries.push(query); return [source]; },
    classify: async () => ({ action: "price", title: "Pikachu" }),
  });
  await office.add({ kind: "card", title: "Pikachu", edition: "Base", number: "58/102" }).done;
  await office.add({ kind: "card", title: "Pikachu", edition: "Promo" }).done;
  const ambiguous = await office.request("Quanto vale Pikachu?", "board").done;
  assert.match(ambiguous?.result?.message ?? "", /più carte/);
  assert.deepEqual(queries, []);
  const entry = office.snapshot().entries[1];
  const priced = await office.quote(entry.id).done;
  assert.match(queries[0], /Pikachu.*Base.*58\/102/);
  assert.deepEqual(priced?.result?.sources, [source]);
  assert.equal(office.snapshot().entries[1].price, undefined);
  office.savePrice(entry.id, { amount: 30, currency: "EUR", url: source.url });
  assert.equal(office.snapshot().entries[1].price?.amount, 30);
  office.close();
});

test("persiste gli archivi, filtra i dati bancari, valida date e link", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "andreagpt-office-"));
  const file = path.join(directory, "office.sqlite");
  try {
    const office = createOffice(file, "Europe/Rome", tools);
    assert.throws(() => office.request("Salva il numero 4111 1111 1111 1111", "board"), OfficeError);
    await office.add({ kind: "subscription", title: "Streaming", renewal: "2030-02-01", cadence: "monthly" }).done;
    const modelSettings = z.object({ provider: z.literal("ollama"), model: z.string() });
    const configuredModel = modelSettings.parse({ provider: "ollama", model: "qwen3:14b" });
    office.writeSetting("model", configuredModel);
    office.writeSetting("telegram", { token: "test-secret", owner: "123" });
    office.close();
    const reopened = createOffice(file, "Europe/Rome", tools);
    assert.equal(reopened.snapshot().entries[0].title, "Streaming");
    assert.equal(reopened.snapshot().jobs.length, 1);
    assert.deepEqual(reopened.readSetting("model", modelSettings), configuredModel);
    assert.doesNotMatch(JSON.stringify(reopened.snapshot()), /test-secret/);
    reopened.close();
  } finally { rmSync(file, { force: true }); rmdirSync(directory); }
  assert.equal(localDay("Europe/Rome", new Date("2026-11-21T23:30:00Z")), "2026-11-22");
  assert.equal(intentSchema.safeParse({ action: "add", entry: { kind: "appointment", title: "Visita", day: "2026-02-30" } }).success, false);
  assert.equal(priceSchema.safeParse({ amount: 30, currency: "EUR", url: "javascript:alert(1)" }).success, false);
  assert.deepEqual(priceCandidate("Inserzione: 30,25 € · numero 58/102"), { amount: 30.25, currency: "EUR" });
  assert.equal(priceCandidate("Prezzi: da EUR 25 a EUR 31"), undefined);
  assert.equal(priceCandidate("Prezzo formattato: 1.000,00 €"), undefined);
});

test("limita la ricerca documenti all’adattatore Foto e conserva solo gli identificatori", async () => {
  const office = createOffice(":memory:", "Europe/Rome", { ...tools,
    classify: async () => ({ action: "photos", query: "contratto", documents: true }),
    photos: async (query, documents) => { assert.equal(query, "contratto"); assert.equal(documents, true); return [42]; },
  });
  const job = await office.request("Trova la foto del mio contratto", "telegram").done;
  assert.deepEqual(job?.result?.photos, [42]);
  assert.doesNotMatch(job?.result?.message ?? "", /contratto|42/);
  assert.doesNotMatch(JSON.stringify(office.snapshot()), /Trova la foto/);
  office.close();
});

test("esegue un piano sulle collezioni in ordine e conserva note, tipologie e conferme distinte", async () => {
  const office = createOffice(":memory:", "Europe/Rome", { ...tools, classify: async text => planSchema.parse({
    actions: text === "Elimina" ? [
      { action: "removeItem", collection: "Fotografia", title: "Nikon" },
      { action: "removeItem", collection: "Fotografia", title: "Canon" },
    ] : [
      { action: "createCollection", title: "Fotografia" },
      { action: "addItem", collection: "Fotografia", title: "Nikon", types: ["Reflex"], notes: "Testata" },
      { action: "addItem", collection: "Fotografia", title: "Canon", types: ["Digitale"] },
      { action: "editItem", collection: "Fotografia", title: "Nikon", appendNote: "Acquistata a Forlì", addTypes: ["Analogica", "reflex"] },
      { action: "searchCollections", query: "forli testata", type: "analogica" },
      { action: "collectionStats" },
    ],
  }) });
  try {
    const job = await office.request("Organizza la raccolta", "board").done;
    const { collections, items } = office.collections.archive();
    const nikon = items.find(item => item.title === "Nikon")!;
    assert.equal(collections.length, 1);
    assert.deepEqual(nikon.types.map(type => type.toLowerCase()), ["reflex", "analogica"]);
    assert.equal(nikon.notes, "Testata\nAcquistata a Forlì");
    assert.match(job?.result?.steps?.[4].message ?? "", /1 elemento trovato\nNikon/);
    assert.match(job?.result?.steps?.[5].message ?? "", /2 elementi · 3 tipologie/);
    const deletion = await office.request("Elimina", "board").done;
    const [first, second] = deletion?.result?.steps?.map(step => step.confirmation?.code) ?? [];
    assert.ok(first && second && first !== second);
    assert.equal((await office.request(`/conferma ${first}`, "telegram").done)?.status, "error");
    assert.equal(office.collections.archive().items.length, 2);
    for (const code of [first, second]) assert.equal((await office.request(`/conferma ${code}`, "board").done)?.status, "done");
    assert.equal(office.collections.archive().items.length, 0);
  } finally { office.close(); }
});

test("mantiene le foto ordinate, aggiorna i preferiti e rimuove le foto degli elementi eliminati", () => {
  const office = createOffice(":memory:", "Europe/Rome", tools);
  try {
    const store = office.collections;
    const collection = store.saveCollection({ title: "Foto", description: "" });
    const item = store.saveItem(collection.id, { title: "Voce", notes: "", types: [] });
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    assert.throws(() => store.addPhoto(item.id, { name: "test.svg", description: "" }, Buffer.from("<svg/>")), OfficeError);
    const first = store.addPhoto(item.id, { name: "fronte.png", description: "" }, png);
    const second = store.addPhoto(item.id, { name: "retro.png", description: "Retroscena" }, png);
    const updated = store.updatePhoto(second.id, photoChanges.parse({ important: true }));
    assert.equal(updated.description, "Retroscena");
    assert.deepEqual(store.archive().photos.map(photo => [photo.id, photo.important]), [[first.id, false], [second.id, true]]);
    assert.deepEqual(Buffer.from(store.photoData(second.id)!.bytes), png);
    store.deleteCollection(collection.id);
    assert.deepEqual(store.archive(), { collections: [], items: [], photos: [] });
    assert.equal(store.photoData(second.id), undefined);
  } finally { office.close(); }
});

test("archivia i file del chatbot senza testo e conserva originali e anteprime al riavvio", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "andreagpt-chat-files-"));
  const file = path.join(directory, "office.sqlite");
  const photo = Buffer.from("89504e470d0a1a0a", "hex");
  const document = Buffer.from("Appunti fotografici");
  const parsed = requestSchema.parse({ attachments: [
    { name: "Foto.png", data: photo.toString("base64") },
    { name: "Appunti.txt", data: document.toString("base64") },
  ] });
  let classified = false;
  const officeTools = { ...tools, classify: async () => { classified = true; return tools.classify(); } };
  try {
    const office = createOffice(file, "Europe/Rome", officeTools);
    try {
      const job = await office.request(parsed.text, "board", undefined, true, parsed.attachments).done;
      assert.equal(job?.status, "done");
      assert.equal(classified, false);
    } finally { office.close(); }
    assert.equal(requestSchema.safeParse({ text: "" }).success, false);
    const reopened = createOffice(file, "Europe/Rome", officeTools);
    try {
      const saved = reopened.snapshot().chat.at(-1)?.attachments;
      assert.deepEqual(saved?.map(({ name, size, image }) => ({ name, size, image })), [
        { name: "Foto.png", size: photo.length, image: true },
        { name: "Appunti.txt", size: document.length, image: false },
      ]);
      assert.deepEqual(Buffer.from(reopened.chatAttachment(saved![0].id)!.bytes), photo);
      assert.deepEqual(Buffer.from(reopened.chatAttachment(saved![1].id)!.bytes), document);
      assert.equal(reopened.chatAttachment(saved![1].id)?.mime, null);
    } finally { reopened.close(); }
  } finally {
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});

test("cataloga i libri per tipologia, associa le foto e conserva destinazioni esplicite e titoli", async () => {
  const office = createOffice(":memory:", "Europe/Rome", { ...tools,
    classify: async () => { throw Error("Il titolo dichiarato non richiede il modello."); },
    inspectPhoto: async (_photo, category) => ({ category: "book", title: category ? undefined : "Copertina letta" }),
  });
  try {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const attachment = [{ name: "Copertina.png", data: png.toString("base64") }];
    const request = (text: string, files = attachment) => office.request(text, "board", undefined, true, files).done;
    const instruction = "Aggiungi questo libro alla mia collezione si chiama Universo Pagina di Scienza";
    assert.match((await request(instruction))?.result?.message ?? "", /in «Libri» · Libro\. Foto associata/);
    await request(instruction);
    assert.equal(office.collections.archive().photos.length, 1);
    assert.deepEqual(office.collections.archive().collections.map(item => item.title), ["Libri"]);
    assert.equal(office.collections.archive().items[0].title, "Universo Pagina di Scienza");
    await request("Aggiungi il libro «Dune» alla collezione Fantascienza", []);
    assert.equal(office.collections.archive().collections.some(item => item.title === "Fantascienza"), true);
    await request("");
    assert.match((await request("Cataloga la foto", []))?.result?.message ?? "", /Copertina letta/);
    assert.match((await request("Aggiungi questo libro alla mia collezione."))?.result?.message ?? "", /Come si intitola/);
    assert.match((await request("Si chiama Il giardino", []))?.result?.message ?? "", /Il giardino.*Foto associata/);
    const catalogued = office.collections.archive();
    assert.deepEqual(catalogued.items.map(item => item.types), [["Libro"], ["Libro"], ["Libro"], ["Libro"]]);
    assert.deepEqual(Buffer.from(office.collections.photoData(catalogued.photos[0].id)!.bytes), png);
  } finally { office.close(); }
});

test("il totale abbonamenti aggrega frequenze, gli aggiornamenti risolvono alias e gli orari restano espliciti", async () => {
  const office = createOffice(":memory:", "Europe/Rome", { ...tools,
    classify: async text => {
      if (text.includes("rinnovo")) return { action: "edit", kind: "subscription", title: "Abbonamento Tim", changes: { renewal: "2027-09-26" } };
      if (text.includes("nota")) return { action: "edit", kind: "note", title: "Nuova implementazione", changes: { notes: "Seconda voce" } };
      return { action: "add", entry: { kind: "appointment", title: "Dentista", day: "2026-11-28", time: "10:00" } };
    },
  });
  try {
    await office.add({ kind: "subscription", title: "Tim", currency: "EUR", amount: 10 }).done;
    await office.add({ kind: "subscription", title: "Netflix", currency: "EUR", amount: 20, cadence: "monthly" }).done;
    await office.add({ kind: "subscription", title: "Software", currency: "EUR", amount: 120, cadence: "yearly" }).done;
    await office.add({ kind: "note", title: "Nuovi implementazioni", notes: "Prima voce" }).done;
    const request = (text: string) => office.request(text, "board").done;
    assert.match((await request("Quanto spendo al mese di abbonamenti?"))?.result?.message ?? "", /30,00.*\nDa completare: Tim/);
    assert.match((await request("Nel mio abbonamento mensile Tim la data di rinnovo è il 26/09/27"))?.result?.message ?? "", /Aggiornato: Tim/);
    assert.match((await request("Modifica il rinnovo per TIM"))?.result?.message ?? "", /Aggiornato: Tim/);
    assert.match((await request("Quanto costano all’anno gli abbonamenti?"))?.result?.message ?? "", /480,00/);
    assert.match((await request("Accoda nella nota Nuova implementazione: Seconda voce"))?.result?.message ?? "", /Aggiornato: Nuovi/);
    await request("Fissami un appuntamento con il dentista il 28");
    const items = office.snapshot().entries;
    const note = items.find(item => item.kind === "note");
    const appointment = items.find(item => item.kind === "appointment");
    assert.equal(note?.kind === "note" && note.notes, "Prima voce\nSeconda voce");
    assert.equal(appointment?.kind === "appointment" && appointment.time, undefined);
  } finally { office.close(); }
});
