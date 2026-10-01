import assert from "node:assert/strict";
import { test } from "node:test";
import { centroidShift, ellipsoid, spreadStats, type FileSum } from "./embedding_selection";

function unit(vector: number[]) { const norm = Math.hypot(...vector); return vector.map(value => value / norm); }
function fileOf(path: string, vectors: number[][]): FileSum {
  const rows = vectors.map(unit);
  return { path, count: rows.length, sum: rows[0].map((_, j) => rows.reduce((sum, row) => sum + row[j], 0)) };
}
/** Varianza totale calcolata direttamente: distanza quadratica media dal centro. */
function directVariance(vectors: number[][]) {
  const rows = vectors.map(unit), center = rows[0].map((_, j) => rows.reduce((sum, row) => sum + row[j], 0) / rows.length);
  return rows.reduce((sum, row) => sum + row.reduce((acc, value, j) => acc + (value - center[j]) ** 2, 0), 0) / rows.length;
}

const sameTopic = [[1, 0.1, 0], [1, 0, 0.1], [1, 0.05, 0.05], [1, -0.05, 0]];
const otherTopic = [[0, 1, 0.1], [0.1, 1, 0], [0, 1, -0.1], [0.05, 1, 0.05]];

test("la varianza dalle somme per file coincide con quella calcolata sui vettori", () => {
  const stats = spreadStats([fileOf("a.md", sameTopic), fileOf("b.md", otherTopic)])!;
  assert.ok(Math.abs(stats.total - directVariance([...sameTopic, ...otherTopic])) < 1e-9);
  assert.ok(Math.abs(stats.within + stats.between - stats.total) < 1e-9);
});

test("un documento solo non ha varianza tra documenti; uno diverso la fa crescere", () => {
  const alone = spreadStats([fileOf("a.md", sameTopic)])!;
  const mixed = spreadStats([fileOf("a.md", sameTopic), fileOf("b.md", otherTopic)])!;
  assert.equal(alone.between, 0);
  assert.ok(alone.total < 0.02);
  assert.ok(mixed.total > 0.2 && mixed.between / mixed.total > 0.9);
  const shift = centroidShift(alone, mixed);
  assert.ok(shift.distance > 0.3);
  assert.equal(shift.verdict, "grande");
});

test("selezione vuota: nessuna statistica", () => {
  assert.equal(spreadStats([]), null);
});

test("l'ellissoide segue gli assi e la dispersione dei punti", () => {
  const points = Array.from({ length: 200 }, (_, i) => [Math.cos(i) * 0.5, Math.sin(i * 1.7) * 0.1, 0.2 + Math.sin(i * 2.3) * 0.02]);
  const shape = ellipsoid(points)!;
  assert.ok(Math.abs(shape.center[2] - 0.2) < 0.01);
  const longest = shape.radii.indexOf(Math.max(...shape.radii));
  assert.ok(Math.abs(shape.axes[longest][0]) > 0.99);
  assert.equal(ellipsoid(points.slice(0, 3)), null);
});
