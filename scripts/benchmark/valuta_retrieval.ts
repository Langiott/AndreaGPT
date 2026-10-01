/**
 * Valuta il retrieval Brain sulle domande di prova (scripts/benchmark/domande_brain.json).
 *   npm run valuta:brain                 → misura la configurazione attuale
 *   npm run valuta:brain -- --confronta  → confronta con e senza la spinta Micelio
 * Non usa il modello di chat: misura solo quali fonti arrivano tra le prime 5.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createBrain } from "../../backend/brain/brain";
import { scoreQuestion, sectionRange, summarize, type LineRange, type QuestionResult } from "../../backend/retrieval/retrieval_eval";

type Expected = string | { file: string; sezione?: string; righe?: [number, number] };
interface QuestionSet { documento: string; domande: Array<{ domanda: string; attese: Expected[]; tipo?: string }> }

const args = process.argv.slice(2);
const setPath = path.resolve(args.find(arg => arg.endsWith(".json")) ?? "scripts/benchmark/domande_brain.json");
const root = path.resolve(process.env.BRAIN_ROOT ?? "ANDREA-BRAIN");
const set = JSON.parse(await fs.readFile(setPath, "utf8")) as QuestionSet;

// Le sezioni attese diventano intervalli di righe, letti dal documento attuale.
const documents = new Map<string, string>();
const read = async (file: string) => { if (!documents.has(file)) documents.set(file, await fs.readFile(path.join(root, file), "utf8")); return documents.get(file)!; };
async function expectedRanges(items: Expected[]): Promise<LineRange[]> {
  return Promise.all(items.map(async item => {
    const spec = typeof item === "string" ? { file: set.documento, sezione: item } : item;
    if (spec.righe) return { file: spec.file, start: spec.righe[0], end: spec.righe[1], label: `righe ${spec.righe.join("-")}` };
    return sectionRange(spec.file, await read(spec.file), spec.sezione!);
  }));
}
/** Sezione che contiene una riga: serve a capire dove sono finite le fonti sbagliate. */
async function sectionAt(citation: string) {
  const [, file, start] = citation.match(/^(.*):(\d+)-\d+$/) ?? [];
  if (!file) return citation;
  const lines = (await read(file).catch(() => "")).split(/\r?\n/).slice(0, Number(start));
  const heading = [...lines].reverse().find(line => /^#{1,6}\s/.test(line));
  return heading ? heading.replace(/^#+\s*/, "").slice(0, 45) : citation;
}

// --confronta prova tutte le combinazioni; la prima è la configurazione di riferimento (Micelio acceso, fuzzy spento).
const variants = args.includes("--confronta")
  ? [{ name: "Micelio", micelio: true, fuzzy: false }, { name: "nessuno", micelio: false, fuzzy: false }, { name: "Fuzzy", micelio: false, fuzzy: true }, { name: "Micelio + Fuzzy", micelio: true, fuzzy: true }]
  : [{ name: "attuale", micelio: process.env.BRAIN_MICELIO === "1", fuzzy: process.env.BRAIN_FUZZY === "1" }];
const percent = (value: number) => `${Math.round(value * 100)}%`;
const report: Array<{ variant: string; summary: ReturnType<typeof summarize>; results: QuestionResult[] }> = [];

for (const variant of variants) {
  const brain = createBrain({ micelio: variant.micelio, fuzzy: variant.fuzzy });
  const results: QuestionResult[] = [];
  try {
    for (const item of set.domande) {
      const expected = await expectedRanges(item.attese);
      const hits = await brain.searchBrain(item.domanda);
      results.push(scoreQuestion(item.domanda, item.tipo ?? "diretta", expected, hits));
    }
  } finally { brain.close(); }
  report.push({ variant: variant.name, summary: summarize(results), results });
}

console.log(`\nVALUTAZIONE RETRIEVAL BRAIN · ${set.domande.length} domande · ${path.relative(process.cwd(), setPath)}\n`);
console.log("Come leggere i numeri:");
console.log("  Recall@5  = su 100 domande, in quante almeno una fonte giusta arriva tra le prime 5. Più alto è meglio.");
console.log("  MRR       = quanto in alto sta la prima fonte giusta: 1 = sempre prima, 0,5 = in media seconda, 0,33 = terza.");
console.log("  Copertura = solo domande a due temi: quante delle parti richieste sono state trovate.\n");
for (const { variant, summary } of report) {
  console.log(`${variant.padEnd(24)} Recall@5 ${percent(summary.recallAt5).padStart(4)}   MRR ${summary.mrr.toFixed(2)}   Copertura ${summary.coverage === null ? "—" : percent(summary.coverage)}`);
  for (const [type, block] of Object.entries(summary.byType)) console.log(`   ${type.padEnd(21)} Recall@5 ${percent(block.recallAt5).padStart(4)}   MRR ${block.mrr.toFixed(2)}   (${block.questions} domande)`);
}

const main = report[0];
const missed = main.results.filter(r => r.firstRank === 0);
const partial = main.results.filter(r => r.type === "due temi" && r.firstRank > 0 && r.coverage < 1);
if (missed.length) {
  console.log(`\nDomande senza nessuna fonte giusta tra le prime 5 (${missed.length}):`);
  for (const r of missed) console.log(`  ✗ ${r.question}\n      attese: ${r.expected.map(e => e.label).join(" | ")}\n      arrivate: ${(await Promise.all(r.top.slice(0, 3).map(sectionAt))).join(" | ")}`);
}
if (partial.length) {
  console.log(`\nDomande a due temi coperte solo in parte (${partial.length}):`);
  for (const r of partial) console.log(`  ◐ ${r.question}  → ${percent(r.coverage)} delle parti (attese: ${r.expected.map(e => e.label).join(" | ")})`);
}
if (report.length > 1) {
  // Ogni variante confrontata con la prima, domanda per domanda.
  const [base, ...others] = report;
  for (const other of others) {
    const changed = base.results.map((r, i) => ({ q: r.question, base: r, other: other.results[i] }))
      .filter(x => x.base.firstRank !== x.other.firstRank || x.base.coverage !== x.other.coverage);
    console.log(`\n${other.variant} rispetto a ${base.variant}: ${changed.length} domande cambiano`);
    for (const x of changed) {
      const better = (x.other.firstRank && (!x.base.firstRank || x.other.firstRank < x.base.firstRank)) || x.other.coverage > x.base.coverage;
      console.log(`  ${better ? "▲ meglio " : "▼ peggio "} ${x.q}  (prima giusta ${x.base.firstRank || "—"} → ${x.other.firstRank || "—"}, copertura ${percent(x.base.coverage)} → ${percent(x.other.coverage)})`);
    }
  }
  // La migliore: prima conta trovare la fonte (recall), poi coprire i due temi, poi la posizione (MRR).
  const best = [...report].sort((a, b) => b.summary.recallAt5 - a.summary.recallAt5 || (b.summary.coverage ?? 0) - (a.summary.coverage ?? 0) || b.summary.mrr - a.summary.mrr)[0];
  console.log(`\nCONFIGURAZIONE MIGLIORE: ${best.variant} (Recall@5 ${percent(best.summary.recallAt5)}, copertura ${best.summary.coverage === null ? "—" : percent(best.summary.coverage)}, MRR ${best.summary.mrr.toFixed(2)})`);
}

const output = path.resolve("runtime/benchmarks/valutazione-retrieval.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ domande: path.relative(process.cwd(), setPath), varianti: report }, null, 2));
console.log(`\nDettaglio completo: ${path.relative(process.cwd(), output)}`);
