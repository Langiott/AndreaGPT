/**
 * Verifica il comportamento completo del Brain.
 * Controlla indicizzazione, retrieval, fonti, import e limiti.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chunkBrainText, createBrain, validateBrainRepositoryUrl } from "./brain";

test("retrieval conserva fatti lontani dalla frase che corrisponde alla domanda", async t => {
  const f = await fixture(t);
  const text = "Il database Postgres è descritto qui. Si usa in produzione. Gestisce diversi servizi. Il backup è eseguito ogni notte alle 03:00.";
  await fs.writeFile(path.join(f.root, "database.txt"), text);
  await f.brain.indexBrain();
  const hits = await f.brain.searchBrain("Quale database Postgres?");
  assert.equal(hits[0].text.replace(/\s+/g, " "), text);
});

test("ricerca lessicale riconosce accenti e nomi nei percorsi con underscore", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "reti_di_Petri.txt"), "Affidabilità del sistema.");
  await f.brain.indexBrain();
  for (const query of ["affidabilita", "Petri"]) {
    assert.ok((await f.brain.searchBrain(query))[0].lexicalScore > 0);
  }
});

test("refuso tecnico non ambiguo recupera retrieval senza correggere nomi", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "ricerca.txt"), "Il retrieval combina BM25 e ricerca vettoriale per recuperare documenti pertinenti.");
  await fs.writeFile(path.join(f.root, "nova.txt"), "Nova pilota una navicella con Sapez.");
  await f.brain.indexBrain();
  const hits = await f.brain.searchBrain("Parlami metodi retrival");
  assert.equal(hits[0].path, "ricerca.txt");
  assert.ok(hits[0].lexicalScore > 0);
  assert.ok(f.calls.flat().includes("search_query: parlami metodi retrieval"));
});

test("domanda senza nessuna parola presente nell'archivio non restituisce estratti", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "database.txt"), "Il database Postgres conserva i dati dei clienti.");
  await f.brain.indexBrain();
  // Il vettore finto è simile per tutti i testi: conta solo la presenza di parole in comune.
  assert.deepEqual(await f.brain.searchBrain("ricetta della carbonara"), []);
  assert.ok((await f.brain.searchBrain("ricetta dei clienti")).length > 0);
});

async function fixture(t:{ after: (fn: () => Promise<void>) => void }) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "andreagpt-brain-test-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, "ANDREA-BRAIN");
  const dataDir = path.join(temporary, "data");
  await fs.mkdir(root);
  const calls: string[][] = [];
  let fail = false;
  const embed = async (texts: string[]) => {
    calls.push(texts);
    if (fail) throw new Error("mock embedding overflow");
    return texts.map(text => /database|postgres/i.test(text) ? [1, 0, 0] : /giardino|fiore/i.test(text) ? [0, 1, 0] : /identità|descrizione|protagonista|orfano|principessa/i.test(text) ? [0, 0, 1] : [0.2, 0.2, 0.2]);
  };
  const options = { root, dataDir, embed };
  return { root, dataDir, temporary, calls, options, brain: createBrain(options), fail: () => { fail = true; } };
}

test("a method query keeps its subject and does not inject thesis terminology", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "interviste.md"), "# Procedura\nIl metodo di intervista raccoglie risposte aperte senza formule.");
  await f.brain.indexBrain();
  const query = "Descrivi il metodo di intervista";
  const hits = await f.brain.searchBrain(query);
  assert.equal(hits[0].path, "interviste.md");
  assert.ok(f.calls.flat().includes("search_query: descrivi il metodo di intervista"));
  assert.ok(!f.calls.flat().some(text => /dijkstra|heatmap|indegree/i.test(text)));
});

test("identità richiede il nome nel testo, favorisce presentazioni ed esclude lockfile", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "Lyria.txt"), "Lyria, la nostra protagonista, studia sulla Terra.\n" + "\n" + "x".repeat(1400) + "\nIl giardino contiene un fiore.");
  await fs.writeFile(path.join(f.root, "package-lock.json"), "Lyria protagonista studentessa");
  await f.brain.indexBrain();
  const hits = await f.brain.searchBrain("chi è Lyria?");
  assert.match(hits[0].text, /nostra protagonista/);
  assert.ok(hits.every(hit => /Lyria/.test(hit.text)));
  assert.ok(hits.every(hit => !hit.path.includes("package-lock")));
  // A separate writer must invalidate the reader's in-memory snapshot.
  const reader = createBrain(f.options);
  await reader.getBrainStatus();
  await fs.writeFile(path.join(f.root, "new.txt"), "Il giardino contiene un fiore.");
  await f.brain.indexBrain();
  assert.equal((await reader.getBrainStatus()).files, 2);
});

test("query embedding condiviso ma risultati aggiornati dopo reindicizzazione", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "uno.txt"), "Il database Postgres conserva dati.");
  await f.brain.indexBrain();
  const before = f.calls.length;
  await Promise.all([f.brain.searchBrain("database Postgres"), f.brain.searchBrain("database Postgres")]);
  assert.equal(f.calls.length - before, 1);
  await fs.writeFile(path.join(f.root, "due.txt"), "Il database Postgres conserva dati con backup giornalieri.");
  await f.brain.indexBrain();
  assert.ok((await f.brain.searchBrain("database Postgres")).some(hit => hit.path === "due.txt"));
});

test("Micelio misura l'allineamento semantico tra risposta e fonti", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "database.txt"), "Il database Postgres conserva dati con backup giornalieri.");
  await f.brain.indexBrain();
  const hit = (await f.brain.searchBrain("database Postgres"))[0];
  const source = { citation: hit.citation, text: hit.text, retrievalScore: hit.score };
  const supported = await f.brain.assessSemanticSupport("database Postgres", "Il database Postgres conserva i dati.", [source]);
  const unsupported = await f.brain.assessSemanticSupport("database Postgres", "Il giardino contiene un fiore.", [source]);
  assert.equal(supported.checked, true);
  assert.ok(supported.score > unsupported.score);
  assert.equal(supported.sources.length, 1);
  const abstention = await f.brain.assessSemanticSupport("database Postgres", "Le fonti non forniscono informazioni sul database Postgres.", [source]);
  assert.equal(abstention.checked, false);
  assert.equal(abstention.score, 0);
  const partial = await f.brain.assessSemanticSupport("database Postgres", "Il database Postgres conserva dati. Le fonti non contengono dettagli sui backup.", [source]);
  assert.equal(partial.checked, true);
  assert.equal(unsupported.label, "debole");
  const context = {metrics:{},queryVector:[1,0,0]};
  const callsBefore=f.calls.length;
  await f.brain.assessSemanticSupport("database Postgres", "Il database Postgres conserva dati.", [source],context);
  assert.equal(f.calls.length,callsBefore+1);
  assert.equal(f.calls.at(-1)!.length,1,"grounding deve generare solo l'embedding della risposta");
});

test("Micelio costruisce viste raccolta-file-estratti e non marca centrali nodi isolati", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "database-a.txt"), "Database Postgres alpha.");
  await fs.writeFile(path.join(f.root, "database-b.txt"), "Database Postgres beta.");
  await fs.writeFile(path.join(f.root, "giardino.txt"), "Il giardino contiene un fiore.");
  await fs.writeFile(path.join(f.root, "misc.txt"), "Note senza categoria specifica.");
  await f.brain.indexBrain();

  const collections = await f.brain.getBrainGraph({ level: "collections", threshold: 0.95 });
  assert.equal(collections.nodes.length, 1);
  assert.equal(collections.nodes[0].label, "Documenti personali");

  const files = await f.brain.getBrainGraph({ level: "files", scope: "Documenti personali", threshold: 0.95 });
  assert.equal(files.nodes.length, 4);
  assert.equal(files.totals.nodes, files.totals.active + files.totals.passive);
  assert.equal(files.totals.central, files.nodes.filter(node => node.central).length);
  assert.ok(files.nodes.filter(node => node.central).every(node => node.centrality > 0));
  assert.ok(files.edges.every(edge => files.nodes.some(node => node.id === edge.source) && files.nodes.some(node => node.id === edge.target)));
  assert.ok(files.nodes.every(node => [node.score, node.vitality, node.weightedDegree, node.betweenness, node.closeness, node.centrality].every(Number.isFinite)));

  const chunks = await f.brain.getBrainGraph({ level: "chunks", scope: files.nodes[0].path, threshold: 0.95 });
  assert.ok(chunks.nodes.length > 0);
  assert.equal(chunks.nodes.every(node => node.type === "chunk"), true);
});

test("refuso nel nome propone la correzione più vicina", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "nova.txt"), "Arbiter guida la spedizione verso il faro con calma.");
  await f.brain.indexBrain();
  assert.deepEqual(await f.brain.searchBrain("chi è Albiter?"), [], "il refuso non deve produrre risultati");
  assert.deepEqual(await f.brain.suggestCorrection("chi è Albiter?"), ["Arbiter"]);
  assert.deepEqual(await f.brain.suggestCorrection("chi è Zzzqqq?"), []);
  assert.deepEqual(await f.brain.suggestCorrection("chi è?"), []);
});

test("caricamento multiplo indicizza automaticamente e conserva gli omonimi", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "appunti.txt"), "Originale");
  const result = await f.brain.indexBrain([
    { name: "appunti.txt", data: Buffer.from("Il database Postgres conserva dati.").toString("base64") },
    { name: "fiori.md", data: Buffer.from("Il giardino contiene un fiore.").toString("base64") },
  ]);
  assert.equal(result.files, 3);
  assert.equal(await fs.readFile(path.join(f.root, "appunti.txt"), "utf8"), "Originale");
  assert.ok((await f.brain.searchBrain("database Postgres")).some(hit => hit.path === "appunti (1).txt"));
});

test("upload rifiuta percorsi, formati, contenuti e dimensioni non validi prima di scrivere", async t => {
  const f = await fixture(t);
  for (const name of ["../escape.txt", "a\\b.txt", "x.txt:stream", "CON.txt", ".env", "program.exe", "package-lock.json"]) {
    await assert.rejects(f.brain.indexBrain([{ name, data: "YWJj" }]));
  }
  for (const data of ["", "!!!!", "YWJj=", Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64")]) {
    await assert.rejects(f.brain.indexBrain([{ name: "test.txt", data }]));
  }
  await assert.rejects(f.brain.indexBrain([{ name: "valid.txt", data: "YWJj" }, { name: "invalid.exe", data: "YWJj" }]));
  assert.deepEqual(await fs.readdir(f.root), []);
});

test("il pacchetto scelto controlla il caricamento e rifiuta pacchetti sconosciuti", async t => {
  const f = await fixture(t);
  const file = { name: "documento.txt", data: Buffer.alloc(6 * 1024 * 1024, 65).toString("base64") };
  await assert.rejects(f.brain.indexBrain([file], 5), /5 MiB/);
  assert.deepEqual(await fs.readdir(f.root), []);
  await assert.rejects(f.brain.indexBrain([], 999), /Limite di caricamento non valido/);
  // A larger package admits the file; large text is sampled instead of rejected.
  const result = await f.brain.indexBrain([file], 20);
  assert.equal((await fs.stat(path.join(f.root, file.name))).size, 6 * 1024 * 1024);
  assert.ok(result.errors.every(error => !/Testo estratto/.test(error.error)));
  for (const preset of [5, 20, 50, 100]) {
    const status = await f.brain.indexBrain([{ name: `file-${preset}.txt`, data: Buffer.from("Il database Postgres conserva dati.").toString("base64") }], preset);
    assert.ok(status.sources.some(source => source.id === `file-${preset}.txt`));
  }
});

test("chunking mantiene righe, sezioni e limiti anche per codice minificato", () => {
  const chunks = chunkBrainText(`# Database\nPostgres\n\n## Dettagli\n${"x".repeat(5000)}\nfine`, "docs/test.md");
  assert.equal(chunks[0].section, "Database");
  assert.equal(chunks[0].startLine, 1);
  assert.ok(chunks.every(chunk => chunk.text.length <= 1400));
  assert.ok(chunks.filter(chunk => chunk.text.includes("xxx")).every(chunk => chunk.startLine <= 5 && chunk.endLine >= 5));
  assert.equal(chunks.at(-1)?.endLine, 6);
  assert.equal(new Set(chunks.map(chunk => chunk.id)).size, chunks.length);
  assert.deepEqual(chunkBrainText(" \n\n", "empty.txt"), []);
});

test("indice incrementale persistente, retrieval ibrido, filtri e rimozioni", async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, "docs"));
  await fs.writeFile(path.join(f.root, "docs", "db.md"), "# Database\nPostgres conserva i dati.");
  await fs.writeFile(path.join(f.root, "garden.txt"), "Il giardino contiene un fiore.");
  assert.equal((await f.brain.getBrainStatus()).indexedAt, null);
  const status = await f.brain.indexBrain();
  assert.equal(status.files, 2);
  assert.equal(status.chunks, 2);
  const callCount = f.calls.length;
  await f.brain.indexBrain();
  assert.equal(f.calls.length, callCount, "hash invariati non richiedono embedding");
  const reopened = createBrain(f.options);
  const hits = await reopened.searchBrain("database Postgres");
  assert.equal(hits[0].path, "docs/db.md");
  assert.ok(hits[0].lexicalScore > 0 && hits[0].cosineScore > 0);
  assert.equal(hits[0].citation, "docs/db.md:1-2");
  assert.ok(!("embedding" in hits[0]));
  assert.equal((await reopened.searchBrain("Postgres", "docs"))[0].path, "docs/db.md");
  assert.equal((await reopened.searchBrain("Postgres", "docs/db.md")).length, 1);
  assert.deepEqual(await reopened.searchBrain("Postgres", "doc"), []);
  assert.deepEqual(await reopened.searchBrain("Postgres", "garden.txt"), []);
  await assert.rejects(reopened.searchBrain("Postgres", "../outside"), /Filtro/);
  await assert.rejects(reopened.searchBrain("x".repeat(1401)), /massimo/);
  await fs.writeFile(path.join(f.root, "docs", "db.md"), "# Database\nPostgres modificato.");
  await fs.rm(path.join(f.root, "garden.txt"));
  const before = f.calls.length;
  assert.equal((await reopened.indexBrain()).files, 1);
  assert.equal(f.calls.length, before + 1);
  assert.match((await reopened.searchBrain("database"))[0].text, /modificato/);
});

test("domande chi è privilegiano i passaggi biografici rispetto alle scene", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "scena.txt"), "Nova interviene nella riunione e convince il comandante ad accogliere Esita.");
  await fs.writeFile(path.join(f.root, "biografia.txt"), "Nova è il protagonista: un orfano cresciuto su Capler14 e protetto dal droide Sapez.");
  await f.brain.indexBrain();
  const hits = await f.brain.searchBrain("Chi Nova?");
  assert.match(hits[0].text, /protagonista.*orfano/i);
  assert.deepEqual(await f.brain.searchBrain("Chi è Albiter?"), [], "un nome assente non deve produrre falsi risultati semantici");
});

test("domande biografiche privilegiano presentazioni esplicite rispetto alle scene", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "storia.txt"), [
    "Esita arriva sulla nave e parla con Nova durante una scena concitata.",
    "x".repeat(1400),
    "Esita era una principessa ape, timida e introversa, brillante nelle scienze e aspirante riparatrice spaziale.",
  ].join("\n"));
  await f.brain.indexBrain();
  assert.match((await f.brain.searchBrain("Chi è Esita?"))[0].text, /principessa ape/);
});

test("panoramica del personaggio non recupera citazioni di codice come biografia", async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, "server"));
  await fs.writeFile(path.join(f.root, "storia.txt"), "Nova è il protagonista, un orfano cresciuto su Capler14 e protetto dal droide Sapez.");
  await fs.writeFile(path.join(f.root, "server", "brain.ts"), "const prompt = 'Nova'; // riferimento tecnico senza descrizione del personaggio");
  await f.brain.indexBrain();
  const hits = await f.brain.searchBrain("Fammi una panoramica completa del personaggio Nova");
  assert.equal(hits[0].path, "storia.txt");
  assert.match(hits[0].text, /orfano.*Capler14/i);
});

test("profili separano personaggi adiacenti e coprono sezioni lontane", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "romanzo.txt"), [
    "Esita era timida e introversa. Micelia invece era una biologa e un medico eccellente, conosciuta per il suo umorismo nero.",
    "x".repeat(1400),
    ...Array.from({ length: 260 }, () => "riempitivo"),
    "Micelia lavorava come Riparatrice e curò i minatori nella sala medica.",
    ...Array.from({ length: 260 }, () => "altro riempitivo"),
    "Micelia lasciò i Riparatori insieme ai suoi amici.",
  ].join("\n"));
  await f.brain.indexBrain();
  const hits = await f.brain.searchBrain("Chi è Micelia?");
  assert.match(hits[0].text, /biologa.*medico eccellente/i);
  assert.doesNotMatch(hits[0].text, /Esita era timida|introversa/i);
  assert.ok(hits.some(hit => /Riparatrice.*sala medica/i.test(hit.text)));
  assert.ok(hits.some(hit => /lasciò i Riparatori/i.test(hit.text)));
});

test("recupera fatti esatti, repository e uso della PCA", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "romanzo.md"), "Il pianeta Cometa ha la forma di un nastro di Moebius.");
  const petri = path.join(f.root, "progetti", "Langiott--Pipe_Reti_di_Petri");
  await fs.mkdir(petri, { recursive: true });
  await fs.writeFile(path.join(petri, "README.md"), "PIPE è un ambiente per creare reti di Petri e automi per impianti manifatturieri.");
  const satellite = path.join(f.root, "progetti", "Langiott--Immagini-Satellitari");
  await fs.mkdir(satellite, { recursive: true });
  await fs.writeFile(path.join(satellite, "README.md"), "Ho usato PCA per ridurre la dimensionalità delle immagini satellitari Sentinel-2 e classificare specie vegetali.");
  await f.brain.indexBrain();
  assert.match((await f.brain.searchBrain("Che forma ha il pianeta Cometa?"))[0].text, /nastro di Moebius/i);
  assert.match((await f.brain.searchBrain("Esiste un progetto per creare reti di Petri?"))[0].path, /Pipe_Reti_di_Petri/);
  assert.match((await f.brain.searchBrain("Come ho utilizzato la PCA nei progetti?"))[0].text, /immagini satellitari Sentinel-2/i);
});

test("falso DOCX, PDF non valido, binari, segreti e cartelle escluse", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "fake.docx"), "<!doctype html><html>not a zip</html>");
  await fs.writeFile(path.join(f.root, "document.pdf"), "%PDF-1.7\nsynthetic");
  await fs.writeFile(path.join(f.root, "binary.txt"), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(f.root, ".env"), "SYNTHETIC_SECRET=not-real");
  await fs.writeFile(path.join(f.root, "credentials.json"), "{}");
  await fs.writeFile(path.join(f.root, "ok.txt"), "testo pubblico");
  for (const folder of ["node_modules", ".git", "dist", "secrets"]) {
    await fs.mkdir(path.join(f.root, folder));
    await fs.writeFile(path.join(f.root, folder, "ignored.txt"), "ignored");
  }
  const status = await f.brain.indexBrain();
  assert.equal(status.files, 1);
  assert.equal(status.errors.length, 3);
  assert.match(status.errors.find(e => e.path === "fake.docx")!.error, /ZIP/);
  assert.match(status.errors.find(e => e.path === "document.pdf")!.error, /PDF non valido|non estraibile/);
  assert.ok(f.calls.flat().every(text => !text.includes("SYNTHETIC_SECRET") && !text.includes("ignored")));
});

test("ODT e DOCX veri estraggono testo XML in ordine, senza includere attributi", async t => {
  const f = await fixture(t);
  const odt = new AdmZip();
  odt.addFile("content.xml", Buffer.from('<office:document xmlns:office="urn:office" xmlns:text="urn:text"><text:h>Guida</text:h><text:p>Uno &amp; due</text:p><text:p>Tre</text:p></office:document>'));
  await fs.writeFile(path.join(f.root, "guide.odt"), odt.toBuffer());
  const docx = new AdmZip();
  docx.addFile("word/document.xml", Buffer.from('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Database </w:t></w:r><w:r><w:t>Postgres</w:t></w:r></w:p><w:p><w:r><w:t>Secondo paragrafo</w:t></w:r></w:p></w:body></w:document>'));
  await fs.writeFile(path.join(f.root, "database.docx"), docx.toBuffer());
  assert.deepEqual((await f.brain.indexBrain()).errors, []);
  const hit = (await f.brain.searchBrain("database", "database.docx"))[0];
  assert.equal(hit.text.trim(), "Database Postgres\nSecondo paragrafo");
  assert.equal(hit.lineKind, "extracted");
  assert.match(hit.citation, /testo estratto/);
  assert.ok(f.calls.flat().some(text => text.includes("Uno & due\nTre")));
});

test("notebook Jupyter indicizzati rendono cercabile codice Computer Vision", async t => {
  const f = await fixture(t);
  const project = path.join(f.root, "progetti", "Langiott--Computer-Vision-Deep-Learning");
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, "MaskRCNN.ipynb"), JSON.stringify({
    cells: [
      { cell_type: "markdown", source: ["# Computer Vision\n", "Segmentazione istanze"] },
      { cell_type: "code", source: ["from mrcnn.config import Config\n", "MODELLO = 'Mask R-CNN'\n"] },
    ],
  }));
  await f.brain.indexBrain();
  const hit = (await f.brain.searchBrain("Come ho usato modello Mask RCNN nel progetto computer vision?"))[0];
  assert.equal(hit.path, "progetti/Langiott--Computer-Vision-Deep-Learning/MaskRCNN.ipynb");
  assert.match(hit.text, /Mask R-CNN|mrcnn/i);
  assert.equal(hit.lineKind, "extracted");
});

test("notebook vuoti e file tabellari grandi non producono errori rumorosi", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "vuoto.ipynb"), "");
  await fs.writeFile(path.join(f.root, "grande.csv"), `colonna,valore\n${Array.from({ length: 120_000 }, (_, index) => `riga-${index},database`).join("\n")}`);
  const status = await f.brain.indexBrain();
  assert.deepEqual(status.errors, []);
  assert.ok(status.sources.some(source => source.id === "vuoto.ipynb" && source.chunks === 0));
  const hit = (await f.brain.searchBrain("database colonna", "grande.csv"))[0];
  assert.equal(hit.path, "grande.csv");
  assert.match(hit.text, /Estratto indicizzabile|colonna,valore/);
});

test("batch limitati e fallimento embedding preservano indice precedente", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "long.txt"), "x".repeat(1400 * 19));
  await f.brain.indexBrain();
  assert.ok(f.calls.length >= 3);
  assert.ok(f.calls.every(batch => batch.length <= 8));
  const previous = await fs.readFile(path.join(f.dataDir, "index.json"), "utf8");
  await fs.writeFile(path.join(f.root, "long.txt"), "changed");
  f.fail();
  await assert.rejects(f.brain.indexBrain(), /overflow/);
  assert.equal(await fs.readFile(path.join(f.dataDir, "index.json"), "utf8"), previous);
  assert.equal((await f.brain.getBrainStatus()).indexing, false);
  assert.deepEqual((await fs.readdir(f.dataDir)).sort(), ["index.json"]);
});

test("symlink esterno escluso e root symlink rifiutata", async t => {
  const f = await fixture(t);
  const outside = path.join(f.temporary, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "synthetic.txt"), "Non indicizzare");
  await fs.symlink(outside, path.join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await f.brain.indexBrain()).files, 0);
  assert.equal(f.calls.length, 0);
  await assert.rejects(createBrain({ ...f.options, root: path.join(f.root, "linked") }).indexBrain(), /Symlink/);
});

test("URL repository rigorosi, import esplicito e nessuna chiamata git per URL invalidi", async t => {
  const f = await fixture(t);
  for (const url of ["http://github.com/owner/repo", "https://user:pass@github.com/owner/repo", "https://github.com.evil.test/a/b", "https://github.com/a/b?token=secret", "https://github.com/a/b#main", "https://github.com/a/b/tree/main", "file:///tmp/repo", "--upload-pack=evil", "https://github.com/a/-repo", "https://github.com/a/%2e%2e"]) {
    assert.throws(() => validateBrainRepositoryUrl(url));
    await assert.rejects(f.brain.importBrainRepository(url));
  }
  assert.equal(validateBrainRepositoryUrl("https://github.com/owner/repo"), "https://github.com/owner/repo.git");
  assert.equal(validateBrainRepositoryUrl("https://github.com/owner/repo.git/"), "https://github.com/owner/repo.git");
  assert.deepEqual(await fs.readdir(f.root), []);
  assert.throws(() => createBrain({ ...f.options, ollamaUrl: "https://cloud.example" }), /locale/);
});

test("file oltre limite escluso; indice corrotto non viene sovrascritto", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "large.txt"), Buffer.alloc(100 * 1024 * 1024 + 1, 65));
  const status = await f.brain.indexBrain();
  assert.equal(status.files, 0);
  assert.match(status.errors[0].error, /100 MiB/);
  await fs.writeFile(path.join(f.dataDir, "index.json"), "broken JSON");
  await assert.rejects(f.brain.indexBrain());
  assert.equal(await fs.readFile(path.join(f.dataDir, "index.json"), "utf8"), "broken JSON");
});

test("Office minuscolo o con DTD rifiutato; import salta destinazioni esistenti", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "tiny.docx"), Buffer.from([1]));
  const odt = new AdmZip();
  odt.addFile("content.xml", Buffer.from('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///outside">]><x>&secret;</x>'));
  await fs.writeFile(path.join(f.root, "unsafe.odt"), odt.toBuffer());
  const status = await f.brain.indexBrain();
  assert.equal(status.files, 0);
  assert.equal(status.errors.length, 2);
  assert.equal(f.calls.length, 0);
  const destination = path.join(f.root, "progetti", "repo");
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, "keep.txt"), "preserve");
  const imported = await f.brain.importBrainRepository("https://github.com/owner/repo");
  assert.equal(imported.branch, "existing");
  assert.equal(await fs.readFile(path.join(destination, "keep.txt"), "utf8"), "preserve");
});
