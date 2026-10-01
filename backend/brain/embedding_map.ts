/**
 * Proiezione PCA 3D degli embedding Brain.
 * I vettori vengono normalizzati (come nella ricerca a coseno), centrati e
 * proiettati sui tre assi con la varianza maggiore. Un'unica scala per tutti gli
 * assi conserva le proporzioni reali della nuvola di punti.
 */
export interface EmbeddingProjection { mean: number[]; axes: number[][]; points: number[][]; explained: number[]; scale: number }

function dot(a: number[], b: number[]) { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum; }
function normalize(vector: number[]) { const norm = Math.sqrt(dot(vector, vector)) || 1; return vector.map(value => value / norm); }

/** Calcola i primi assi principali con power iteration, senza costruire la matrice di covarianza. */
export function projectEmbeddings(vectors: number[][], components = 3, iterations = 80): EmbeddingProjection {
  const n = vectors.length, d = vectors[0]?.length ?? 0;
  if (n < 3 || !d) throw new Error("Servono almeno 3 estratti indicizzati per la mappa 3D.");
  const rows = vectors.map(normalize);
  const mean = new Array(d).fill(0) as number[];
  for (const row of rows) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  const centered = rows.map(row => row.map((value, j) => value - mean[j]));
  const total = centered.reduce((sum, row) => sum + dot(row, row), 0);
  const axes: number[][] = [], explained: number[] = [];
  let seed = 7; // seme fisso: la mappa resta uguale tra un'apertura e l'altra
  for (let c = 0; c < components; c++) {
    let axis = normalize(Array.from({ length: d }, () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5));
    for (let step = 0; step < iterations; step++) {
      const next = new Array(d).fill(0) as number[];
      for (const row of centered) { const score = dot(row, axis); for (let j = 0; j < d; j++) next[j] += row[j] * score; }
      for (const previous of axes) { const overlap = dot(next, previous); for (let j = 0; j < d; j++) next[j] -= overlap * previous[j]; }
      axis = normalize(next);
    }
    axes.push(axis);
    explained.push(total ? centered.reduce((sum, row) => sum + dot(row, axis) ** 2, 0) / total : 0);
  }
  const raw = centered.map(row => axes.map(axis => dot(row, axis)));
  const scale = Math.max(1e-9, ...raw.flat().map(Math.abs));
  return { mean, axes, explained, scale, points: raw.map(point => point.map(value => value / scale)) };
}

/** Porta un nuovo vettore (per esempio la domanda) nello stesso spazio 3D. */
export function projectPoint(projection: EmbeddingProjection, vector: number[]) {
  const centered = normalize(vector).map((value, j) => value - projection.mean[j]);
  return projection.axes.map(axis => dot(centered, axis) / projection.scale);
}
