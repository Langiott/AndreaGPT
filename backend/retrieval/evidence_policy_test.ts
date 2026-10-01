import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceFormatBoost, evidenceIntent, isDefinitionQuery, isSmallTalk, mathSpans, selectEvidence } from "./evidence_policy";

test("saluti e ringraziamenti non avviano la ricerca; le domande vere sì", () => {
  for (const q of ["CIAO", "buongiorno", "salve", "grazie mille", "ok", "perfetto grazie", "ciao come stai?"]) assert.equal(isSmallTalk(q), true, q);
  for (const q of ["ciao, cos'è HDFS?", "Cos'è HDFS?", "come si valuta un classificatore?", "Spark e RDD", "", "?"]) assert.equal(isSmallTalk(q), false, q);
});

test("a descriptive procedure needs no equations; a math request prefers actual formulas", () => {
  assert.deepEqual(evidenceIntent("Descrivi il metodo di intervista"), { detailed: true, formulas: false });
  assert.equal(evidenceFormatBoost("Descrivi il metodo di intervista", "$$x=y$$"), 0);
  assert.equal(evidenceFormatBoost("Riporta le equazioni", "$$x=y$$"), 0.12);
  assert.equal(evidenceFormatBoost("Riporta le equazioni", "attention softmax config=true"), 0);
  assert.deepEqual(mathSpans("```js\nx='$money$'\n```\n$$x=1$$"), ["$$x=1$$"]);
});

test("recognizes concise method definitions without rewriting descriptive method queries", () => {
  assert.equal(isDefinitionQuery("Definisci in breve il metodo di analisi"), true);
  assert.equal(isDefinitionQuery("Descrivi il metodo di intervista"), false);
});

test("summaries and their continuation remain available regardless of filename and numbering", () => {
  const hits = [
    { id: "a", path: "interviste.md", section: "9 Sintesi", text: "Si raccolgono le risposte.", score: 1 },
    { id: "b", path: "interviste.md", section: "9 Sintesi", text: "Poi si confrontano i risultati.", score: 0.95 },
    { id: "c", path: "altro.md", section: "9 Sintesi", text: "Una procedura diversa.", score: 0.9 },
  ];
  const before = JSON.stringify(hits);
  const selected = selectEvidence(hits, "Descrivi tutta la procedura", true);
  assert.deepEqual(selected.map(hit => hit.id), ["a", "b", "c"]);
  assert.equal(JSON.stringify(hits), before);
});
