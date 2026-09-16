import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { chunkBrainText, createBrain, validateBrainRepositoryUrl } from "./brain";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
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
  assert.ok(new Set(hits.map(hit => Math.floor(hit.startLine / 250))).size >= 3);
  assert.ok(hits.some(hit => /Riparatrice.*sala medica/i.test(hit.text)));
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
  await fs.writeFile(path.join(f.root, "large.txt"), Buffer.alloc(5 * 1024 * 1024 + 1, 65));
  const status = await f.brain.indexBrain();
  assert.equal(status.files, 0);
  assert.match(status.errors[0].error, /5 MiB/);
  await fs.writeFile(path.join(f.dataDir, "index.json"), "broken JSON");
  await assert.rejects(f.brain.indexBrain());
  assert.equal(await fs.readFile(path.join(f.dataDir, "index.json"), "utf8"), "broken JSON");
});

test("Office minuscolo o con DTD rifiutato; import non sovrascrive destinazioni esistenti", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, "tiny.docx"), Buffer.from([1]));
  const odt = new AdmZip();
  odt.addFile("content.xml", Buffer.from('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///outside">]><x>&secret;</x>'));
  await fs.writeFile(path.join(f.root, "unsafe.odt"), odt.toBuffer());
  const status = await f.brain.indexBrain();
  assert.equal(status.files, 0);
  assert.equal(status.errors.length, 2);
  assert.equal(f.calls.length, 0);
  const destination = path.join(f.root, "progetti", "owner--repo");
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, "keep.txt"), "preserve");
  await assert.rejects(f.brain.importBrainRepository("https://github.com/owner/repo"), /non sovrascrive/);
  assert.equal(await fs.readFile(path.join(destination, "keep.txt"), "utf8"), "preserve");
});
