/**
 * Centro e dispersione di una selezione di documenti nello spazio degli embedding.
 *
 * Il server manda, per ogni file, quanti chunk ha e la somma dei loro vettori
 * normalizzati: bastano per ricalcolare in modo esatto centro e varianza di
 * qualunque selezione nelle dimensioni complete, senza altre richieste.
 * Per vettori di lunghezza 1 la varianza totale vale 1 − ‖centro‖² e si divide
 * esattamente in una parte dentro i documenti e una tra i documenti.
 */
export interface FileSum { path: string; count: number; sum: number[] }
export interface SpreadStats { files: number; count: number; centroid: number[]; total: number; within: number; between: number }
export interface Ellipsoid { center: number[]; axes: number[][]; radii: number[] }

/** Quantile 90% del chi-quadro con 3 gradi di libertà: l'ellissoide contiene circa il 90% dei punti se fossero gaussiani. */
const CHI2_3_90 = 6.251;

function dot(a: number[], b: number[]) { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum; }

export function spreadStats(files: FileSum[]): SpreadStats | null {
  const used = files.filter(file => file.count > 0 && file.sum.length);
  const count = used.reduce((sum, file) => sum + file.count, 0);
  if (!count) return null;
  const centroid = new Array(used[0].sum.length).fill(0) as number[];
  for (const file of used) for (let j = 0; j < centroid.length; j++) centroid[j] += file.sum[j] / count;
  const total = Math.max(0, 1 - dot(centroid, centroid));
  // Dentro ogni file: 1 − ‖centro del file‖², pesato con il numero di chunk.
  const within = Math.min(total, used.reduce((sum, file) => sum + file.count * Math.max(0, 1 - dot(file.sum, file.sum) / file.count ** 2), 0) / count);
  return { files: used.length, count, centroid, total, within, between: Math.max(0, total - within) };
}

/** Spostamento del centro da A a B, anche in rapporto alla distanza tipica di un chunk dal centro di A. */
export function centroidShift(before: SpreadStats, after: SpreadStats) {
  const distance = Math.sqrt(before.centroid.reduce((sum, value, j) => sum + (value - after.centroid[j]) ** 2, 0));
  const typical = Math.sqrt(before.total);
  const relative = typical > 0 ? distance / typical : 0;
  const verdict = relative < 0.1 ? "quasi fermo" : relative < 0.3 ? "piccolo" : relative < 0.7 ? "medio" : "grande";
  return { distance, typical, relative, verdict };
}

/** Autovalori e autovettori di una matrice simmetrica 3×3 (metodo di Jacobi). */
function eigenSymmetric3(input: number[][]) {
  const a = input.map(row => [...row]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: [0, 1, 2].map(i => [v[0][i], v[1][i], v[2][i]]) };
}

/** Centro ed ellissoide al 90% dei punti 3D (coordinate PCA). */
export function ellipsoid(points: number[][]): Ellipsoid | null {
  if (points.length < 4) return null;
  const center = [0, 1, 2].map(j => points.reduce((sum, point) => sum + point[j], 0) / points.length);
  const covariance = [0, 1, 2].map(i => [0, 1, 2].map(j => points.reduce((sum, point) => sum + (point[i] - center[i]) * (point[j] - center[j]), 0) / (points.length - 1)));
  const { values, vectors } = eigenSymmetric3(covariance);
  return { center, axes: vectors, radii: values.map(value => Math.sqrt(Math.max(0, value) * CHI2_3_90)) };
}

/** Tre anelli dell'ellissoide (uno per ogni coppia di assi), pronti da disegnare. */
export function ellipsoidRings(shape: Ellipsoid, segments = 64) {
  return [[0, 1], [0, 2], [1, 2]].map(([i, j]) => Array.from({ length: segments + 1 }, (_, step) => {
    const angle = (step / segments) * Math.PI * 2, a = Math.cos(angle) * shape.radii[i], b = Math.sin(angle) * shape.radii[j];
    return [0, 1, 2].map(k => shape.center[k] + a * shape.axes[i][k] + b * shape.axes[j][k]);
  }));
}
