/**
 * Verifica raggruppamenti e classificatori della vista EmbeddingSpace su dati sintetici.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chapterOf, fuzzyCMeans, groupEmbeddings, GROUP_METHODS, partitionCoefficient } from "./embedding_ml";

/** Tre capitoli ben separati in 12 dimensioni, 20 estratti ciascuno, con rumore deterministico. */
function corpus() {
  const vectors: number[][] = [], sections: string[] = [], texts: string[] = [];
  for (let i = 0; i < 60; i++) {
    const chapter = Math.floor(i / 20);
    vectors.push(Array.from({ length: 12 }, (_, d) => (d === chapter * 4 ? 1 : 0) + Math.sin(i * 12.9898 + d * 78.233) * 0.15));
    sections.push(i % 20 === 0 ? `${chapter + 1} Capitolo ${chapter + 1}` : `${chapter + 1}.${(i % 3) + 1} Paragrafo`);
    texts.push("testo");
  }
  return { vectors, sections, texts, paths: vectors.map(() => "doc.md") };
}

test("il capitolo viene letto dalla sezione o dal primo titolo del testo", () => {
  assert.equal(chapterOf("6.3.6 Classificazione", ""), "6");
  assert.equal(chapterOf("Panoramica documento", "### 1. 1 Big Data Introduzione"), "1");
  assert.equal(chapterOf("Indice", "## Indice - 1 Big Data"), undefined);
});

test("ogni metodo produce un'etichetta per estratto e metriche leggibili", () => {
  const input = corpus();
  for (const method of GROUP_METHODS) {
    const { result } = groupEmbeddings(input, method);
    assert.equal(result.labels.length, 60, method);
    if (method !== "chapter") assert.ok(result.note.length > 0, method);
  }
});

test("i gruppi automatici ritrovano i capitoli quando sono ben separati", () => {
  const input = corpus();
  for (const method of ["kmeans", "hierarchical"] as const) {
    const purity = groupEmbeddings(input, method).result.metrics.find(metric => metric.label.startsWith("Purezza"))!.value;
    assert.equal(purity, "100%", method);
  }
});

test("i classificatori riconoscono il capitolo in cross-validation e collocano la domanda", () => {
  const input = corpus();
  for (const method of ["knn", "naivebayes", "svm", "randomforest"] as const) {
    const model = groupEmbeddings(input, method);
    const accuracy = Number(model.result.metrics[0].value.replace("%", ""));
    assert.ok(accuracy >= 90, `${method}: ${accuracy}%`);
    assert.equal(model.place(Array.from({ length: 12 }, (_, d) => d === 8 ? 1 : 0)), "Cap. 3 · Capitolo 3", method);
  }
});

test("fuzzy: gradi che sommano a 1, temi distinti e profilo della domanda", () => {
  const input = corpus();
  const rows = input.vectors.map(v => { const n = Math.hypot(...v); return v.map(x => x / n); });
  const { u } = fuzzyCMeans(rows, 3, 1.1);
  u.forEach(row => assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9));
  assert.ok(partitionCoefficient(u) > 0.8, "con capitoli ben separati i temi sono netti");
  const model = groupEmbeddings(input, "fuzzy");
  assert.equal(model.result.strength?.length, 60);
  assert.match(model.place(Array.from({ length: 12 }, (_, d) => d === 8 ? 1 : 0)) ?? "", /^Tema \d · .* \d+%/);
});
