/**
 * Verifica lettura delle citazioni Brain e ricerca del tratto citato nel testo renderizzato.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { findPassage, parseCitation, plainWords } from "./cite_focus";

test("la citazione separa documento e righe, anche per i PDF", () => {
  assert.deepEqual(parseCitation("Big_Data_Sergy.md:3428-3432"), { source: "Big_Data_Sergy.md", startLine: 3428, endLine: 3432 });
  assert.deepEqual(parseCitation("Corsi/ML.pdf (pagina 4):10-20 (testo estratto)"), { source: "Corsi/ML.pdf", startLine: 10, endLine: 20 });
  assert.deepEqual(parseCitation("note.md"), { source: "note.md", startLine: 0, endLine: 0 });
});

test("la sintassi Markdown non entra nelle parole", () => {
  assert.deepEqual(plainWords("## Le **reti** [neurali](http://x) e $\\alpha$"), ["le", "reti", "neurali", "e"]);
});

test("il tratto citato viene ritrovato tra parole renderizzate diverse dal sorgente", () => {
  const rendered = plainWords("Introduzione. Una rete neurale è costituita da neuroni artificiali organizzati in strati. Ogni neurone calcola una somma pesata. Fine del capitolo.");
  const snippet = plainWords("$$x$$\nUna **rete neurale** è costituita da neuroni artificiali\norganizzati in strati. Ogni neurone calcola una somma pesata.");
  const found = findPassage(rendered, snippet)!;
  assert.equal(rendered.slice(found.start, found.end + 1).join(" "), "una rete neurale è costituita da neuroni artificiali organizzati in strati ogni neurone calcola una somma pesata");
});

test("senza corrispondenze non viene inventato un tratto", () => {
  assert.equal(findPassage(plainWords("testo del tutto diverso"), plainWords("nessuna parola in comune qui")), null);
});
