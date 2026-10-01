/**
 * Raggruppa e classifica gli embedding Brain per la vista EmbeddingSpace.
 * Tutti i calcoli usano i vettori completi (768 valori), non la proiezione 3D.
 * Algoritmi semplici e deterministici: stessi dati, stessi colori.
 */

export const GROUP_METHODS = ["chapter", "file", "kmeans", "dbscan", "hierarchical", "micelio", "fuzzy", "knn", "naivebayes", "svm", "randomforest"] as const;
export type GroupMethod = typeof GROUP_METHODS[number];

export interface GroupMetric { label: string; value: string; hint: string }
export interface EmbeddingGroups {
  method: GroupMethod;
  kind: "label" | "cluster" | "classifier";
  title: string;
  note: string;
  names: string[];
  labels: number[];           // gruppo di ogni punto, -1 = senza gruppo (rumore o senza capitolo)
  wrong?: boolean[];          // solo classificatori: previsione sbagliata in cross-validation
  truth?: number[];           // solo classificatori: capitolo vero, per colorare l'anello degli errori
  strength?: number[];        // solo fuzzy: grado del tema principale (0-1)
  second?: number[];          // solo fuzzy: secondo tema se il suo grado è almeno 25%, altrimenti -1
  secondStrength?: number[];  // solo fuzzy: grado del secondo tema
  metrics: GroupMetric[];
}
export interface GroupModel { result: EmbeddingGroups; place(vector: number[]): string | undefined }
export interface GroupInput { vectors: number[][]; paths: string[]; sections: string[]; texts: string[] }

type Vec = number[];
const dot = (a: Vec, b: Vec) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum; };
const unit = (v: Vec) => { const norm = Math.sqrt(dot(v, v)) || 1; return v.map(x => x / norm); };
const distance = (a: Vec, b: Vec) => 1 - dot(a, b); // distanza coseno su vettori normalizzati
const percent = (value: number) => `${Math.round(value * 100)}%`;
const fileName = (path: string) => path.split("/").at(-1) ?? path;

/** Generatore pseudo-casuale con seme fisso. */
function random(seed = 7) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

/** Capitolo di un estratto: numero iniziale della sezione, altrimenti del primo titolo nel testo. */
export function chapterOf(section: string, text: string) {
  const fromSection = section.match(/^(\d+)[.\s]/)?.[1];
  if (fromSection) return fromSection;
  return text.match(/^#{1,6}\s+(\d+)[.\s]/m)?.[1];
}

/** Etichette vere: capitolo (con il file se l'archivio ha più documenti). */
export function chapterLabels(input: GroupInput) {
  const files = new Set(input.paths);
  const titles = new Map<string, string>();
  input.sections.forEach(section => { const match = section.match(/^(\d+)\s+([^\d].*)$/); if (match && !titles.has(match[1])) titles.set(match[1], match[2].trim()); });
  const keys = input.paths.map((path, i) => {
    const chapter = chapterOf(input.sections[i], input.texts[i]);
    if (!chapter) return undefined;
    const name = `Cap. ${chapter}${titles.has(chapter) ? ` · ${titles.get(chapter)}` : ""}`;
    return files.size > 1 ? `${fileName(path)} · ${name}` : name;
  });
  return encode(keys);
}

/** Trasforma chiavi testuali in indici numerici ordinati (undefined → -1). */
function encode(keys: Array<string | undefined>) {
  const names = [...new Set(keys.filter((key): key is string => !!key))].sort((a, b) => a.localeCompare(b, "it", { numeric: true }));
  return { names, labels: keys.map(key => key === undefined ? -1 : names.indexOf(key)) };
}

/* ---------------------------- Metriche ---------------------------- */

/** Silhouette media (6.5.5.1): ~1 gruppi compatti e separati, ~0 al confine, <0 assegnati male. */
function silhouette(rows: Vec[], labels: number[]) {
  const groups = [...new Set(labels.filter(label => label >= 0))];
  if (groups.length < 2) return 0;
  let total = 0, count = 0;
  rows.forEach((row, i) => {
    if (labels[i] < 0) return;
    const sums = new Map<number, { sum: number; n: number }>();
    rows.forEach((other, j) => { if (i === j || labels[j] < 0) return; const entry = sums.get(labels[j]) ?? { sum: 0, n: 0 }; entry.sum += distance(row, other); entry.n++; sums.set(labels[j], entry); });
    const own = sums.get(labels[i]);
    if (!own?.n) return;
    const a = own.sum / own.n;
    const b = Math.min(...[...sums.entries()].filter(([group]) => group !== labels[i]).map(([, entry]) => entry.sum / entry.n));
    total += (b - a) / Math.max(a, b); count++;
  });
  return count ? total / count : 0;
}

/** Purezza: quota di estratti che appartengono al capitolo più frequente del proprio gruppo. */
function purity(labels: number[], truth: number[]) {
  const counts = new Map<number, Map<number, number>>();
  let total = 0;
  labels.forEach((label, i) => {
    if (label < 0 || truth[i] < 0) return;
    const inner = counts.get(label) ?? new Map<number, number>();
    inner.set(truth[i], (inner.get(truth[i]) ?? 0) + 1); counts.set(label, inner); total++;
  });
  return total ? [...counts.values()].reduce((sum, inner) => sum + Math.max(...inner.values()), 0) / total : 0;
}

/** F1 medio tra le classi (6.5.3): non premia chi indovina solo la classe più numerosa. */
function macroF1(predicted: number[], truth: number[], classes: number) {
  let sum = 0;
  for (let c = 0; c < classes; c++) {
    let tp = 0, fp = 0, fn = 0;
    predicted.forEach((p, i) => { if (p === c && truth[i] === c) tp++; else if (p === c) fp++; else if (truth[i] === c) fn++; });
    sum += tp ? 2 * tp / (2 * tp + fp + fn) : 0;
  }
  return sum / classes;
}

/* ----------------------- Raggruppamento automatico ----------------------- */

/** K-Means con inizializzazione k-means++ (6.5.4.2). Restituisce gruppi e centroidi. */
function kmeans(rows: Vec[], k: number) {
  const next = random(11);
  const centroids: Vec[] = [rows[Math.floor(next() * rows.length)]];
  while (centroids.length < k) {
    const weights = rows.map(row => Math.min(...centroids.map(c => distance(row, c))) ** 2);
    let target = next() * weights.reduce((a, b) => a + b, 0), index = 0;
    while (target > weights[index] && index < rows.length - 1) target -= weights[index++];
    centroids.push(rows[index]);
  }
  let labels = rows.map(() => 0);
  for (let step = 0; step < 50; step++) {
    const updated = rows.map(row => { let best = 0; centroids.forEach((c, j) => { if (distance(row, c) < distance(row, centroids[best])) best = j; }); return best; });
    const changed = updated.some((label, i) => label !== labels[i]);
    labels = updated;
    centroids.forEach((_, j) => {
      const members = rows.filter((_, i) => labels[i] === j);
      if (members.length) centroids[j] = unit(members[0].map((_, d) => members.reduce((sum, m) => sum + m[d], 0) / members.length));
    });
    if (!changed) break;
  }
  return labels;
}

/** DBSCAN (6.5.4.3): eps scelto dalla curva delle k-distanze (mediana), MinPts = 5. */
function dbscan(rows: Vec[], minPts = 5) {
  const near = rows.map(row => rows.map(other => distance(row, other)));
  const kDistances = near.map(list => [...list].sort((a, b) => a - b)[minPts]).sort((a, b) => a - b);
  const eps = kDistances[Math.floor(kDistances.length / 2)];
  const core = near.map(list => list.filter(d => d <= eps).length > minPts);
  const labels = rows.map(() => -1);
  let cluster = 0;
  rows.forEach((_, i) => {
    if (!core[i] || labels[i] >= 0) return;
    const queue = [i]; labels[i] = cluster;
    while (queue.length) {
      const current = queue.pop()!;
      if (!core[current]) continue; // i punti di bordo entrano nel gruppo ma non lo estendono
      near[current].forEach((d, j) => { if (d <= eps && labels[j] < 0) { labels[j] = cluster; queue.push(j); } });
    }
    cluster++;
  });
  return { labels, eps };
}

/** Clustering gerarchico agglomerativo a legame medio (6.5.4.1), tagliato a k gruppi. */
function hierarchical(rows: Vec[], k: number) {
  const n = rows.length;
  const d = rows.map(row => rows.map(other => distance(row, other)));
  const size = rows.map(() => 1), alive = rows.map(() => true), owner = rows.map((_, i) => i);
  for (let clusters = n; clusters > k; clusters--) {
    let a = -1, b = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (alive[i]) for (let j = i + 1; j < n; j++) if (alive[j] && d[i][j] < best) { best = d[i][j]; a = i; b = j; }
    for (let x = 0; x < n; x++) if (alive[x] && x !== a && x !== b) d[a][x] = d[x][a] = (size[a] * d[a][x] + size[b] * d[b][x]) / (size[a] + size[b]);
    size[a] += size[b]; alive[b] = false;
    owner.forEach((o, i) => { if (o === b) owner[i] = a; });
  }
  const roots = [...new Set(owner)];
  return owner.map(o => roots.indexOf(o));
}

/** Micelio: grafo dei vicini più forti sopra soglia, comunità per propagazione delle etichette. */
function micelio(rows: Vec[], neighbors = 8, threshold = 0.6) {
  const links = rows.map((row, i) => rows.map((other, j) => ({ j, s: i === j ? -1 : dot(row, other) })).filter(e => e.s >= threshold).sort((a, b) => b.s - a.s).slice(0, neighbors));
  // Grafo non orientato: se A sceglie B, anche B è collegato ad A.
  const graph = rows.map(() => new Map<number, number>());
  links.forEach((list, i) => list.forEach(({ j, s }) => { graph[i].set(j, s); graph[j].set(i, s); }));
  let labels = rows.map((_, i) => i);
  for (let step = 0; step < 30; step++) {
    let changed = false;
    labels = labels.map((label, i) => {
      const votes = new Map<number, number>();
      graph[i].forEach((s, j) => votes.set(labels[j], (votes.get(labels[j]) ?? 0) + s));
      if (!votes.size) return label;
      const winner = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      if (winner !== label) changed = true;
      return winner;
    });
    if (!changed) break;
  }
  // Le comunità con meno di 3 estratti restano "senza gruppo".
  const counts = new Map<number, number>(); labels.forEach(l => counts.set(l, (counts.get(l) ?? 0) + 1));
  const kept = [...counts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return labels.map(l => kept.indexOf(l));
}

/**
 * Fuzzy c-means: ogni estratto appartiene a tutti i temi con un grado da 0 a 1 (somma 1).
 * Parte dai gruppi del K-Means e alterna: centri pesati dai gradi, poi gradi dalle distanze.
 * Con la distanza coseno (proporzionale al quadrato della distanza euclidea su vettori unitari)
 * l'esponente è 1/(m-1). m vicino a 1 = temi netti; m grande = tutto uguale a tutto.
 */
export function fuzzyCMeans(rows: Vec[], c: number, m: number, iterations = 60) {
  const hard = kmeans(rows, c);
  let u: number[][] = rows.map((_, i) => Array.from({ length: c }, (_, k) => hard[i] === k ? 1 : 0));
  let centers: Vec[] = [];
  for (let step = 0; step < iterations; step++) {
    centers = Array.from({ length: c }, (_, k) => {
      const weights = u.map(row => row[k] ** m), total = weights.reduce((a, b) => a + b, 0) || 1;
      return unit(rows[0].map((_, d) => rows.reduce((sum, row, i) => sum + weights[i] * row[d], 0) / total));
    });
    let change = 0;
    u = rows.map((row, i) => {
      const next = memberships(row, centers, m);
      next.forEach((value, k) => { change = Math.max(change, Math.abs(value - u[i][k])); });
      return next;
    });
    if (change < 1e-4) break;
  }
  return { u, centers };
}

/** Gradi di appartenenza di un vettore ai temi: vale per gli estratti e per la domanda. */
export function memberships(row: Vec, centers: Vec[], m: number) {
  const dist = centers.map(center => Math.max(1e-9, distance(row, center)));
  return dist.map(dk => 1 / dist.reduce((sum, dj) => sum + (dk / dj) ** (1 / (m - 1)), 0));
}

/** Nettezza della partizione (coefficiente di Bezdek): 1/c = tutto uguale, 1 = temi netti. */
export const partitionCoefficient = (u: number[][]) => u.reduce((sum, row) => sum + row.reduce((s, value) => s + value * value, 0), 0) / u.length;

/**
 * Sceglie m: il valore più morbido tra 1,30 e 1,05 che tiene i temi distinti (nettezza ≥ 0,5).
 * Misurato sul Brain reale: da m = 1,2 in su, in 768 dimensioni, i gradi diventano tutti uguali.
 */
function fuzzyAuto(rows: Vec[], c: number) {
  for (const m of [1.3, 1.2, 1.15, 1.1]) { const run = fuzzyCMeans(rows, c, m); if (partitionCoefficient(run.u) >= 0.5) return { ...run, m }; }
  return { ...fuzzyCMeans(rows, c, 1.05), m: 1.05 };
}

/** Parole comuni che non descrivono un argomento. */
const COMMON_WORDS = new Set("sono essere viene vengono questo questa questi queste quello quella anche come dove quando quindi perché perche mentre ogni tutti tutte tutto altri altre altro della delle degli dello dalla dalle sulla sulle nella nelle negli alla alle agli molto più piu meno essere stato stata possono può puo deve devono fare fatto esempio caso casi tipo modo base parte dati data cioè cioe ovvero oppure sempre solo anche tale tali loro però pero dove sotto sopra dopo prima viene sezione documento indice".split(" "));

/** Nome di un tema: le 3 parole frequenti nel tema e tipiche soprattutto di quel tema. */
function topicNames(texts: string[], u: number[][], c: number) {
  const docs = texts.map(text => new Set((text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter(word => !COMMON_WORDS.has(word))));
  const total = new Map<string, number>(); docs.forEach(words => words.forEach(word => total.set(word, (total.get(word) ?? 0) + 1)));
  return Array.from({ length: c }, (_, k) => {
    const weighted = new Map<string, number>();
    docs.forEach((words, i) => words.forEach(word => weighted.set(word, (weighted.get(word) ?? 0) + u[i][k])));
    const best = [...weighted.entries()].filter(([word]) => (total.get(word) ?? 0) >= 4)
      .map(([word, w]) => ({ word, score: w * (w / total.get(word)!) ** 2 })) // frequenza nel tema × (quota del tema)²
      .sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.word);
    return `Tema ${k + 1} · ${best.join(", ")}`;
  });
}

/* ----------------------------- Classificatori ----------------------------- */

interface Classifier { predict(row: Vec): number }
type Trainer = (rows: Vec[], labels: number[], classes: number) => Classifier;

/** k-NN (6.4.5): voto dei 5 estratti più simili. */
const knn: Trainer = (rows, labels, classes) => ({ predict(row) {
  const votes = new Array(classes).fill(0);
  rows.map((r, i) => ({ s: dot(r, row), label: labels[i] })).sort((a, b) => b.s - a.s).slice(0, 5).forEach(v => votes[v.label] += v.s);
  return votes.indexOf(Math.max(...votes));
} });

/** Naive Bayes gaussiano (6.4.3.3): ogni valore del vettore trattato come indipendente. */
const naiveBayes: Trainer = (rows, labels, classes) => {
  const dims = rows[0].length;
  const stats = Array.from({ length: classes }, (_, c) => {
    const members = rows.filter((_, i) => labels[i] === c);
    const mean = Array.from({ length: dims }, (_, d) => members.reduce((s, m) => s + m[d], 0) / members.length);
    const variance = mean.map((mu, d) => members.reduce((s, m) => s + (m[d] - mu) ** 2, 0) / members.length + 1e-4);
    return { prior: Math.log(members.length / rows.length), mean, variance };
  });
  return { predict(row) {
    const scores = stats.map(({ prior, mean, variance }) => prior - 0.5 * row.reduce((s, x, d) => s + (x - mean[d]) ** 2 / variance[d] + Math.log(variance[d]), 0));
    return scores.indexOf(Math.max(...scores));
  } };
};

/** SVM lineare one-versus-all (6.4.11.5), addestrata con discesa del gradiente sull'hinge loss. */
const svm: Trainer = (rows, labels, classes) => {
  const next = random(5), lambda = 1e-4, dims = rows[0].length;
  const models = Array.from({ length: classes }, (_, c) => {
    const w = new Array(dims).fill(0); let b = 0, t = 0;
    for (let epoch = 0; epoch < 15; epoch++) for (let k = 0; k < rows.length; k++) {
      const i = Math.floor(next() * rows.length), y = labels[i] === c ? 1 : -1, eta = 1 / (lambda * (++t + 100));
      const margin = y * (dot(w, rows[i]) + b);
      for (let d = 0; d < dims; d++) w[d] *= 1 - eta * lambda;
      if (margin < 1) { for (let d = 0; d < dims; d++) w[d] += eta * y * rows[i][d]; b += eta * y * 0.1; }
    }
    return { w, b };
  });
  return { predict(row) { const scores = models.map(m => dot(m.w, row) + m.b); return scores.indexOf(Math.max(...scores)); } };
};

/** Random Forest (6.4.10.8): 40 alberi su campioni bootstrap e sottoinsiemi casuali di valori. */
const randomForest: Trainer = (rows, labels, classes) => {
  const next = random(3), dims = rows[0].length, tried = Math.round(Math.sqrt(dims));
  type Node = { leaf: number } | { dim: number; cut: number; left: Node; right: Node };
  const majority = (idx: number[]) => { const c = new Array(classes).fill(0); idx.forEach(i => c[labels[i]]++); return c.indexOf(Math.max(...c)); };
  const gini = (counts: number[], n: number) => 1 - counts.reduce((s, c) => s + (c / n) ** 2, 0);
  const grow = (idx: number[], depth: number): Node => {
    const first = labels[idx[0]];
    if (depth >= 10 || idx.length < 4 || idx.every(i => labels[i] === first)) return { leaf: majority(idx) };
    let best: { dim: number; cut: number; score: number } | undefined;
    for (let f = 0; f < tried; f++) {
      const dim = Math.floor(next() * dims), sorted = [...idx].sort((a, b) => rows[a][dim] - rows[b][dim]);
      const left = new Array(classes).fill(0), right = new Array(classes).fill(0);
      sorted.forEach(i => right[labels[i]]++);
      for (let k = 0; k < sorted.length - 1; k++) {
        left[labels[sorted[k]]]++; right[labels[sorted[k]]]--;
        const a = rows[sorted[k]][dim], b = rows[sorted[k + 1]][dim];
        if (a === b) continue;
        const nl = k + 1, nr = sorted.length - nl, score = (nl * gini(left, nl) + nr * gini(right, nr)) / sorted.length;
        if (!best || score < best.score) best = { dim, cut: (a + b) / 2, score };
      }
    }
    if (!best) return { leaf: majority(idx) };
    const { dim, cut } = best;
    const leftIdx = idx.filter(i => rows[i][dim] <= cut), rightIdx = idx.filter(i => rows[i][dim] > cut);
    if (!leftIdx.length || !rightIdx.length) return { leaf: majority(idx) };
    return { dim, cut, left: grow(leftIdx, depth + 1), right: grow(rightIdx, depth + 1) };
  };
  const trees = Array.from({ length: 40 }, () => grow(Array.from({ length: rows.length }, () => Math.floor(next() * rows.length)), 0));
  const walk = (node: Node, row: Vec): number => "leaf" in node ? node.leaf : walk(row[node.dim] <= node.cut ? node.left : node.right, row);
  return { predict(row) { const votes = new Array(classes).fill(0); trees.forEach(tree => votes[walk(tree, row)]++); return votes.indexOf(Math.max(...votes)); } };
};

const CLASSIFIERS: Record<"knn" | "naivebayes" | "svm" | "randomforest", { title: string; train: Trainer; note: string }> = {
  knn: { title: "k-NN (5 vicini)", train: knn, note: "Ogni estratto prende il capitolo dei 5 estratti più simili." },
  naivebayes: { title: "Naive Bayes", train: naiveBayes, note: "Stima una gaussiana per capitolo trattando i 768 valori come indipendenti." },
  svm: { title: "SVM lineare", train: svm, note: "Un iperpiano per capitolo (one-versus-all): vince il capitolo col margine più alto." },
  randomforest: { title: "Random Forest", train: randomForest, note: "40 alberi di decisione su campioni diversi: vince il voto di maggioranza." },
};

/** Cross-validation a 5 fold (6.4.6.2): ogni estratto è previsto da un modello che non l'ha visto. */
function crossValidate(rows: Vec[], labels: number[], classes: number, train: Trainer, folds = 5) {
  const order = rows.map((_, i) => i).filter(i => labels[i] >= 0);
  const next = random(17);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const predicted = rows.map(() => -1);
  for (let f = 0; f < folds; f++) {
    const test = order.filter((_, k) => k % folds === f), trainIdx = order.filter((_, k) => k % folds !== f);
    const model = train(trainIdx.map(i => rows[i]), trainIdx.map(i => labels[i]), classes);
    test.forEach(i => { predicted[i] = model.predict(rows[i]); });
  }
  return predicted;
}

/* -------------------------------- Ingresso -------------------------------- */

/** Calcola gruppi, metriche e un modo per collocare la domanda nello stesso schema. */
export function groupEmbeddings(input: GroupInput, method: GroupMethod): GroupModel {
  const rows = input.vectors.map(unit);
  const truth = chapterLabels(input);
  const labeled = truth.labels.filter(label => label >= 0).length;
  const nearestPoint = (vector: number[]) => { const v = unit(vector); let best = 0; rows.forEach((row, i) => { if (dot(row, v) > dot(rows[best], v)) best = i; }); return best; };
  const clusterModel = (result: EmbeddingGroups): GroupModel => ({ result, place: vector => { const label = result.labels[nearestPoint(vector)]; return label >= 0 ? result.names[label] : undefined; } });
  const clusterMetrics = (labels: number[]): GroupMetric[] => [
    { label: "Gruppi trovati", value: String(new Set(labels.filter(l => l >= 0)).size), hint: "Quanti gruppi ha formato l'algoritmo da solo." },
    { label: "Silhouette", value: silhouette(rows, labels).toFixed(2), hint: "Da -1 a 1: vicino a 1 gruppi compatti e ben separati, vicino a 0 gruppi che si toccano." },
    { label: "Purezza rispetto ai capitoli", value: percent(purity(labels, truth.labels)), hint: "Quanti estratti stanno in un gruppo dominato dal loro capitolo vero." },
  ];

  if (method === "chapter") return clusterModel({ method, kind: "label", title: "Capitolo vero", names: truth.names, labels: truth.labels, metrics: [{ label: "Estratti con capitolo", value: `${labeled} su ${rows.length}`, hint: "Gli altri (indice, titolo) non hanno un numero di capitolo." }, { label: "Silhouette dei capitoli", value: silhouette(rows, truth.labels).toFixed(2), hint: "Quanto i capitoli sono già separati nello spazio degli embedding." }], note: "" });
  if (method === "file") { const files = encode(input.paths.map(fileName)); return clusterModel({ method, kind: "label", title: "File", ...files, metrics: [{ label: "File", value: String(files.names.length), hint: "Documenti indicizzati nel Brain." }], note: "Un colore per ogni documento dell'archivio." }); }

  const k = Math.max(2, truth.names.length || 6);
  if (method === "kmeans") { const labels = kmeans(rows, k); return clusterModel({ method, kind: "cluster", title: "K-Means", names: Array.from({ length: k }, (_, i) => `Gruppo ${i + 1}`), labels, metrics: clusterMetrics(labels), note: `Divide gli estratti in ${k} gruppi (tanti quanti i capitoli) attorno a ${k} centroidi.` }); }
  if (method === "hierarchical") { const labels = hierarchical(rows, k); return clusterModel({ method, kind: "cluster", title: "Gerarchico (legame medio)", names: Array.from({ length: k }, (_, i) => `Gruppo ${i + 1}`), labels, metrics: clusterMetrics(labels), note: `Unisce passo dopo passo i gruppi più vicini finché ne restano ${k}.` }); }
  if (method === "dbscan") {
    const { labels, eps } = dbscan(rows);
    const groups = new Set(labels.filter(l => l >= 0)).size, noise = labels.filter(l => l < 0).length;
    return clusterModel({ method, kind: "cluster", title: "DBSCAN", names: Array.from({ length: groups }, (_, i) => `Gruppo ${i + 1}`), labels, metrics: [...clusterMetrics(labels), { label: "Rumore", value: `${noise} estratti`, hint: "Estratti in zone poco dense: restano grigi, senza gruppo." }], note: `Trova zone dense senza sapere quanti gruppi ci sono (MinPts 5, eps ${eps.toFixed(3)} dalla curva delle k-distanze).` });
  }
  if (method === "micelio") {
    const labels = micelio(rows);
    const groups = new Set(labels.filter(l => l >= 0)).size;
    return clusterModel({ method, kind: "cluster", title: "Micelio (comunità del grafo)", names: Array.from({ length: groups }, (_, i) => `Comunità ${i + 1}`), labels, metrics: clusterMetrics(labels), note: "Collega ogni estratto ai suoi 8 vicini più forti (coseno ≥ 0,60) e raggruppa le comunità del grafo." });
  }

  if (method === "fuzzy") {
    const c = Math.max(3, Math.min(12, Math.round(Math.sqrt(rows.length / 8))));
    const { u, centers, m } = fuzzyAuto(rows, c);
    const names = topicNames(input.texts, u, c);
    const ranked = u.map(row => row.map((value, k) => ({ k, value })).sort((a, b) => b.value - a.value));
    const second = ranked.map(r => r[1].value >= 0.25 ? r[1].k : -1);
    const bridges = second.filter(k => k >= 0).length;
    return {
      result: {
        method, kind: "cluster", title: "Fuzzy (temi sfumati)", names, labels: ranked.map(r => r[0].k),
        strength: ranked.map(r => r[0].value), second, secondStrength: ranked.map(r => r[1].value),
        metrics: [
          { label: "Temi", value: String(c), hint: "Scelti in automatico dal numero di estratti; il nome sono le 3 parole più tipiche del tema." },
          { label: "Nettezza", value: partitionCoefficient(u).toFixed(2), hint: `Da ${(1 / c).toFixed(2)} (tutto uguale a tutto) a 1 (ogni estratto in un solo tema).` },
          { label: "Estratti ponte", value: `${bridges} (${percent(bridges / rows.length)})`, hint: "Almeno il 25% in un secondo tema: collegano due argomenti. Anello tratteggiato = colore del secondo tema." },
        ],
        note: `Ogni estratto appartiene a tutti i temi con un grado. Colore = tema principale, trasparenza = quanto è sicuro. m = ${m.toLocaleString("it")} scelto in automatico.`,
      },
      // Profilo della domanda: i temi che tocca, con il loro grado.
      place: vector => memberships(unit(vector), centers, m).map((value, k) => ({ value, k })).sort((a, b) => b.value - a.value)
        .filter((item, i) => i === 0 || item.value >= 0.15).slice(0, 3).map(item => `${names[item.k]} ${percent(item.value)}`).join(" · "),
    };
  }

  const spec = CLASSIFIERS[method];
  if (truth.names.length < 2) return clusterModel({ method, kind: "classifier", title: spec.title, names: [], labels: rows.map(() => -1), metrics: [], note: "Servono almeno 2 capitoli con estratti per addestrare un classificatore." });
  const predicted = crossValidate(rows, truth.labels, truth.names.length, spec.train);
  const scored = predicted.map((p, i) => ({ p, t: truth.labels[i] })).filter(x => x.t >= 0);
  const accuracy = scored.filter(x => x.p === x.t).length / scored.length;
  const counts = truth.names.map((_, c) => scored.filter(x => x.t === c).length);
  const final = spec.train(rows.filter((_, i) => truth.labels[i] >= 0), truth.labels.filter(l => l >= 0), truth.names.length);
  return {
    result: {
      method, kind: "classifier", title: spec.title, names: truth.names, labels: predicted,
      wrong: predicted.map((p, i) => truth.labels[i] >= 0 && p !== truth.labels[i]),
      truth: truth.labels,
      metrics: [
        { label: "Accuratezza (5 fold)", value: percent(accuracy), hint: "Estratti a cui il modello ha dato il capitolo giusto senza averli visti in addestramento." },
        { label: "F1 medio per capitolo", value: percent(macroF1(scored.map(x => x.p), scored.map(x => x.t), truth.names.length)), hint: "Media tra i capitoli: non si alza indovinando solo il capitolo più grande." },
        { label: "Riferimento: sempre il capitolo più grande", value: percent(Math.max(...counts) / scored.length), hint: "Un modello utile deve stare sopra questo valore." },
      ],
      note: `${spec.note} Gli anelli segnano gli errori: il colore dell'anello è il capitolo vero.`,
    },
    place: vector => truth.names[final.predict(unit(vector))],
  };
}
