import assert from "node:assert/strict";
import { test } from "node:test";
import { retrievalTokens, selectPassages, oneEditApart } from "./retrieval";

test("correzione limitata a una modifica, incluse inserzioni e cancellazioni",()=>{
  for(const [a,b] of [["retrival","retrieval"],["retrieval","retrival"],["abcdef","abcxef"],["abcdef","abcdefg"]])assert.equal(oneEditApart(a,b),true);
  for(const [a,b] of [["abc","abc"],["abcdef","abcxyf"],["abc","abcdef"]])assert.equal(oneEditApart(a,b),false);
});

test("retrieval normalizza accenti e separatori degli identificatori", () => {
  assert.deepEqual(retrievalTokens("AFFIDABILITÀ reti_di_Petri"), ["affidabilita", "reti", "di", "petri"]);
});

test("selezione rimuove duplicati e riempie gli slot con nuove prove", () => {
  const hits = [
    { id: "1", path: "a", text: "Postgres conserva dati persistenti su disco", score: 1 },
    { id: "2", path: "b", text: "Postgres conserva dati persistenti\nsu disco", score: 0.99 },
    { id: "3", path: "a", text: "Il backup viene eseguito ogni notte", score: 0.8 },
  ];
  assert.deepEqual(selectPassages(hits, 2).map(hit => hit.id), ["1", "3"]);
  assert.equal(hits.length, 3);
  assert.deepEqual(selectPassages([], 5), []);
});

test("selezione conserva prove diverse anche nello stesso documento", () => {
  const hits = [
    { id: "1", path: "a", text: "Il backup parte alle ore venti", score: 1 },
    { id: "2", path: "a", text: "Il backup non parte alle ore venti", score: 0.99 },
  ];
  assert.equal(selectPassages(hits).length, 2);
});

test("passaggi quasi uguali mantengono numeri e negazioni diversi", () => {
  const prefix = "Il servizio di backup del database principale viene eseguito automaticamente ogni notte alle ";
  const hits = ["03:00", "04:00", "03:00 ma non nei festivi"].map((end, i) => ({
    id: String(i), path: "config", text: prefix + end, score: 1 - i * 0.01,
  }));
  assert.equal(selectPassages(hits).length, 3);
});
