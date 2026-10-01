/**
 * Verifica la proiezione PCA 3D usata dalla vista "Spazio degli embedding".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEmbeddings, projectPoint } from "./embedding_map";

/** Due gruppi ben separati in 8 dimensioni, con un po' di rumore deterministico. */
function clusters() {
  const vectors: number[][] = [];
  for (let i = 0; i < 40; i++) {
    const noise = (k: number) => Math.sin(i * 12.9898 + k * 78.233) * 0.05;
    const base = i < 20 ? [1, 0, 0, 0, 0, 0, 0, 0] : [0, 1, 0, 0, 0, 0, 0, 0];
    vectors.push(base.map((value, k) => value + noise(k)));
  }
  return vectors;
}

test("la PCA separa due gruppi distinti sul primo asse e spiega quasi tutta la varianza", () => {
  const projection = projectEmbeddings(clusters());
  const first = projection.points.slice(0, 20).map(point => point[0]), second = projection.points.slice(20).map(point => point[0]);
  assert.ok(Math.max(...first) < Math.min(...second) || Math.min(...first) > Math.max(...second), "i gruppi devono stare ai due lati del primo asse");
  assert.ok(projection.explained[0] > 0.9, `varianza PC1 troppo bassa: ${projection.explained[0]}`);
  assert.ok(projection.explained.every((value, i) => i === 0 || value <= projection.explained[i - 1] + 1e-9), "la varianza deve decrescere");
  assert.ok(projection.points.flat().every(value => Math.abs(value) <= 1 + 1e-9), "coordinate entro [-1, 1]");
  const [a, b, c] = projection.axes;
  for (const [u, v] of [[a, b], [a, c], [b, c]]) assert.ok(Math.abs(u.reduce((sum, x, i) => sum + x * v[i], 0)) < 1e-6, "assi ortogonali");
});

test("un nuovo vettore viene proiettato vicino al suo gruppo", () => {
  const projection = projectEmbeddings(clusters());
  const point = projectPoint(projection, [1, 0, 0, 0, 0, 0, 0, 0]);
  const group = projection.points.slice(0, 20), other = projection.points.slice(20);
  const distance = (p: number[]) => Math.hypot(...p.map((x, i) => x - point[i]));
  assert.ok(Math.min(...group.map(distance)) < Math.min(...other.map(distance)));
});

test("rifiuta input troppo piccoli", () => {
  assert.throws(() => projectEmbeddings([[1, 0]]), /almeno 3/);
});
