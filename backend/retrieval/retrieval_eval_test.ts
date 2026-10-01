/**
 * Verifica sezioni, corrispondenza delle righe e calcolo di recall@5, MRR e copertura.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreQuestion, sectionRange, summarize } from "./retrieval_eval";

const DOC = ["# Titolo", "## 3 Hadoop", "testo", "### 3.2 HDFS", "#### 3.2.1 Architettura", "a", "#### 3.2.2 Dati", "b", "### 3.3 Calcolo", "c"].join("\n");

test("una sezione va dal suo titolo al prossimo titolo dello stesso livello, sottosezioni incluse", () => {
  assert.deepEqual(sectionRange("doc.md", DOC, "3.2"), { file: "doc.md", start: 4, end: 8, label: "3.2 HDFS" });
  assert.deepEqual(sectionRange("doc.md", DOC, "3.2.1"), { file: "doc.md", start: 5, end: 6, label: "3.2.1 Architettura" });
  assert.throws(() => sectionRange("doc.md", DOC, "9.9"), /non trovata/);
});

test("recall@5, MRR e copertura sui primi 5 risultati", () => {
  const hdfs = sectionRange("doc.md", DOC, "3.2.1"), calcolo = sectionRange("doc.md", DOC, "3.3");
  const hit = (start: number, end: number) => ({ path: "doc.md", startLine: start, endLine: end });
  const first = scoreQuestion("q1", "diretta", [hdfs], [hit(5, 6), hit(9, 10)]);
  const second = scoreQuestion("q2", "due temi", [hdfs, calcolo], [hit(1, 2), hit(9, 10)]);
  const missed = scoreQuestion("q3", "diretta", [hdfs], [hit(1, 2), hit(1, 2), hit(1, 2), hit(1, 2), hit(1, 2), hit(5, 6)]);
  assert.equal(first.firstRank, 1);
  assert.equal(second.firstRank, 2);
  assert.equal(second.coverage, 0.5);
  assert.equal(missed.firstRank, 0, "la fonte giusta in sesta posizione non conta");
  const summary = summarize([first, second, missed]);
  assert.equal(summary.recallAt5, 2 / 3);
  assert.equal(summary.mrr, (1 + 0.5 + 0) / 3);
  assert.equal(summary.coverage, 0.5);
});
