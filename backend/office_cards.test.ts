import assert from "node:assert/strict";
import { test } from "node:test";
import { createOffice } from "./office/office";
import { chatOfficeText } from "./office/chat_actions";
import { directOfficeIntent } from "./office/office_requests";

const noModel = { classify: async () => { throw Error("Questa frase non deve usare il modello."); }, search: async () => [], photos: async () => [] };
const today = "2026-11-26";
const ask = (office: ReturnType<typeof createOffice>, text: string) => office.request(text, "board", undefined, true).done.then(job => job?.result?.message ?? "");

test("chat principale: le azioni personali vanno all'ufficio, il resto alla chat", () => {
  const office = ["salva la carta One Piece Luffy OP01-024", "che abbonamenti ho?", "dov'è la carta di Luffy", "annulla", "/conferma 1a2b3c4d",
    "fammi un riassunto di https://example.com/a", "quanto vale la carta Luffy OP01-024?", "quali carte mi mancano del set OP01?", "sposta le carte nelle collezioni"];
  const chat = ["come si gioca a carte?", "spiegami la carta costituzionale", "cerca la carta igienica in offerta", "ho una carta di credito scaduta, che faccio?",
    "quali sono le carte più rare di One Piece?", "salva questo codice python in un file", "leggi https://example.com e dimmi cosa dice"];
  for (const text of office) assert.notEqual(chatOfficeText(text, today), "", text);
  for (const text of chat) assert.equal(chatOfficeText(text, today), "", text);
});

test("più carte in una frase diventano più azioni nella stessa collezione", () => {
  const plan = directOfficeIntent("salva Luffy OP01-024 e Zoro OP01-025 di One Piece", false, today);
  assert.ok(plan && "actions" in plan);
  assert.deepEqual(plan.actions.map(action => action.action === "catalogItem" && [action.title, action.collection]), [["Luffy OP01-024", "One Piece"], ["Zoro OP01-025", "One Piece"]]);
});

test("salva, ritrova, set mancanti e annulla l'ultima carta", async () => {
  const office = createOffice(":memory:", "Europe/Rome", noModel);
  try {
    assert.match(await ask(office, "salva la carta One Piece Luffy OP01-001"), /catalogato in «One Piece» · Carta/);
    assert.match(await ask(office, "salva Nami OP01-003 e Zoro OP01-005 di One Piece"), /Nami OP01-003.*\n.*Zoro OP01-005/s);
    assert.match(await ask(office, "ce l'ho la carta di Zoro?"), /1 elemento trovato\nZoro OP01-005/);
    assert.match(await ask(office, "quali carte mi mancano del set OP01 di One Piece?"), /3 carte possedute.*Mancanti fino a OP01-005: OP01-002, OP01-004/s);
    assert.match(await ask(office, "annulla"), /Annullato: Nami OP01-003, Zoro OP01-005/);
    assert.deepEqual(office.collections.archive().items.map(item => item.title), ["Luffy OP01-001"]);
    assert.match(await ask(office, "annulla"), /Annullato: collezione One Piece/);
    assert.equal(office.collections.archive().collections.length, 0);
    assert.match(await ask(office, "annulla"), /Non c’è nessuna azione recente/);
  } finally { office.close(); }
});

test("prezzo di una carta delle collezioni: fonti, mediana e salvataggio solo su conferma", async () => {
  const office = createOffice(":memory:", "Europe/Rome", { ...noModel, search: async () => [
    { title: "Luffy OP01-001 venduta", url: "https://a.example/1", snippet: "", candidate: { amount: 10, currency: "EUR" } },
    { title: "Luffy OP01-001", url: "https://b.example/2", snippet: "", candidate: { amount: 14, currency: "EUR" } },
    { title: "Luffy OP01-001 asta", url: "https://c.example/3", snippet: "", candidate: { amount: 30, currency: "EUR" } },
  ] });
  try {
    await ask(office, "salva la carta One Piece Luffy OP01-001");
    const reply = await ask(office, "quanto vale la carta Luffy OP01-001?");
    assert.match(reply, /prezzo indicativo 14,00\s€/);
    assert.equal(office.collections.archive().items[0].notes, "");
    const code = /\/conferma ([a-f0-9]{8})/.exec(reply)?.[1];
    assert.ok(code);
    assert.match(await ask(office, `/conferma ${code}`), /Prezzo salvato/);
    assert.match(office.collections.archive().items[0].notes, /Prezzo indicativo 14,00\s€/);
  } finally { office.close(); }
});

test("sposta le carte dell'archivio nelle collezioni dopo conferma", async () => {
  const office = createOffice(":memory:", "Europe/Rome", noModel);
  try {
    office.add({ kind: "card", title: "Luffy", edition: "One Piece OP01", number: "OP01-024", condition: "Near mint" });
    await new Promise(resolve => setTimeout(resolve, 20));
    const reply = await ask(office, "sposta le carte nelle collezioni");
    const code = /\/conferma ([a-f0-9]{8})/.exec(reply)?.[1];
    assert.ok(code, reply);
    assert.match(await ask(office, `/conferma ${code}`), /1 carta spostata/);
    const archive = office.collections.archive();
    assert.equal(archive.collections[0].title, "One Piece");
    assert.equal(archive.items[0].title, "Luffy OP01-024");
    assert.match(archive.items[0].notes, /Edizione: One Piece OP01\nCondizione: Near mint/);
    assert.equal(office.snapshot().entries.some(entry => entry.kind === "card"), false);
  } finally { office.close(); }
});

test("rinnovi imminenti: le date passate avanzano al prossimo mese", async () => {
  const office = createOffice(":memory:", "Europe/Rome", noModel);
  try {
    const now = new Date();
    const inTwoDays = new Date(now.getTime() + 2 * 86_400_000);
    const monthAgo = new Date(inTwoDays); monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
    const iso = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(date);
    office.add({ kind: "subscription", title: "Netflix", renewal: iso(monthAgo), cadence: "monthly", amount: 13, currency: "EUR" });
    office.add({ kind: "subscription", title: "Lontano", renewal: iso(new Date(now.getTime() + 40 * 86_400_000)), cadence: "yearly" });
    await new Promise(resolve => setTimeout(resolve, 20));
    const renewals = office.snapshot().renewals;
    assert.deepEqual(renewals.map(item => item.title), ["Netflix"]);
    assert.ok(renewals[0].days >= 1 && renewals[0].days <= 3);
  } finally { office.close(); }
});

test("riassunto di un link senza salvare e dentro una collezione", async () => {
  const url = "https://example.org/articolo";
  const office = createOffice(":memory:", "Europe/Rome", { ...noModel, summarizeLink: async () => ({ title: "Articolo", notes: "Punti chiave", url }) });
  try {
    assert.match(await ask(office, `riassumi ${url} senza salvare`), /Articolo\n\nPunti chiave/);
    assert.equal(office.snapshot().entries.length, 0);
    office.collections.saveCollection({ title: "Letture", description: "" });
    assert.match(await ask(office, `riassumi ${url} nella collezione Letture`), /Riassunto salvato in «Letture»/);
    assert.equal(office.collections.archive().items[0].types[0], "Link");
  } finally { office.close(); }
});
