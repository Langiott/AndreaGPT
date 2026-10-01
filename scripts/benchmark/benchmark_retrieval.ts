import fs from "node:fs/promises";
import path from "node:path";
import { createBrain, type BrainSearchContext } from "../../backend/brain/brain";

const queries = [
  { query: "Parlami metodi retrival", expected: "Agentic_Design|APPROCCI_MODERNI" },
  { query: "Quali sono i metodi di retrieval nel RAG?", expected: "Agentic_Design|APPROCCI_MODERNI" },
  { query: "Chi è Nova?", expected: "nova|Nova" },
  { query: "Chi è Micelia?", expected: "nova|Nova" },
  { query: "Esiste un progetto per creare reti di Petri?", expected: "Petri" },
  { query: "Come ho utilizzato la PCA nei progetti?", expected: "Sentinel|Satellite|satellit|PCA" },
  { query: "Come ho usato Mask RCNN nel progetto computer vision?", expected: "Computer_Vision|computer.vision|Deep_Learning" },
  { query: "Dove viene implementata searchBrain nel codice AndreaGPT?", expected: "AndreaGPT" },
];
const output = path.resolve(process.argv[2] ?? "runtime/benchmarks/retrieval.json");
const shared = new Map<string, Promise<number[]>>();
const embed = async (texts: string[]) => Promise.all(texts.map(text => {
  if (!shared.has(text)) shared.set(text, fetch(`${process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"}/api/embed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", input: [text], truncate: false, keep_alive: "30m" }), signal: AbortSignal.timeout(120000),
  }).then(async response => { if (!response.ok) throw new Error(`Embedding HTTP ${response.status}`); return ((await response.json()) as { embeddings: number[][] }).embeddings[0]; }));
  return shared.get(text)!;
}));
const runs: unknown[] = [];
const vectors: unknown[] = [];
for (const mode of ["legacy", "sqlite", "sqlite-graph", "pca384", "pca256"]) {
  process.env.BRAIN_PRECOMPUTED_GRAPH = mode === "sqlite-graph" ? "1" : "0";
  if (mode.startsWith("pca")) process.env.BRAIN_PCA_DIM = mode.slice(3); else delete process.env.BRAIN_PCA_DIM;
  const brain = createBrain({ backend: mode === "legacy" ? "legacy" : "sqlite", embed, turbo: true });
  try {
    for (const item of queries) {
      const context: BrainSearchContext = { metrics: {} };
      const cold = await brain.searchBrain(item.query, undefined, context);
      const timings: number[] = [];
      for (let i=0;i<3;i++) {
        const warm: BrainSearchContext = { metrics: {} };
        await brain.searchBrain(item.query, undefined, warm);
        timings.push(warm.metrics.retrievalTotalMs);
      }
      const result = { mode, ...item, expectedSourceFound: cold.some(hit => new RegExp(item.expected,"i").test(hit.path)),
        hits: cold.map(hit => ({id:hit.id,path:hit.path})), metrics: context.metrics, warmMs: timings };
      runs.push(result);
      if (mode === "legacy") vectors.push({ query:item.query, vector: context.queryVector });
      console.log(JSON.stringify({mode,query:item.query,found:result.expectedSourceFound,warmMs:timings.map(Math.round)}));
    }
  } finally { brain.close(); }
}
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify({at:new Date().toISOString(),notes:"Provisional document labels; not a human-judged claim benchmark. Shared query embeddings isolate retrieval cost.",runs},null,2));
await fs.writeFile(output.replace(/\.json$/, "-queries.json"),JSON.stringify(vectors));
