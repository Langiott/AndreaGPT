import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { localOllamaUrl } from "./local";
import { BRAIN_MAX_FILE_BYTES, brainUploadPreset } from "../src/brainUploadLimits";

const MODEL = "nomic-embed-text";
const VERSION = 2;
const MAX_FILE = BRAIN_MAX_FILE_BYTES;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_TABULAR_SAMPLE = 420 * 1024;
const MAX_CHUNKS = Number.parseInt(process.env.BRAIN_MAX_CHUNKS ?? "100000", 10);
const MAX_FILES = 5_000;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;
// Ollama accetta più testi per richiesta. Un batch più grande riduce molto
// l'overhead HTTP; la concorrenza resta configurabile per non saturare la RAM.
const BATCH_SIZE = Math.max(1, Math.min(64, Number(process.env.BRAIN_EMBED_BATCH ?? 32) || 32));
const EMBED_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.BRAIN_EMBED_CONCURRENCY ?? 3) || 3));
const extensions = new Set(".md .markdown .txt .ts .tsx .js .jsx .mjs .cjs .py .rs .go .java .c .h .cpp .hpp .cs .css .scss .html .xml .json .yaml .yml .toml .sql .sh .ps1 .rb .php .vue .svelte .odt .ods .odp .doc .docx .docm .rtf .epub .ppt .pptx .pps .xls .xlsx .csv .pdf .ipynb".split(" "));
const excluded = /^(?:\..*|node_modules|dist|build|coverage|vendor|__pycache__|secrets?|credentials?)(?:$)|(?:secret|credential|password|token|private[-_]?key)|\.(?:pem|key|p12|pfx|keystore)$|^env(?:\.|$)/i;
const run = promisify(execFile);

export interface BrainChunk {
  id: string;
  path: string;
  text: string;
  startLine: number;
  endLine: number;
  section?: string;
  page?: number;
  lineKind: "source" | "extracted";
  kind?: "content" | "overview";
  repository?: { url: string; branch: string; commit: string };
}
interface StoredChunk extends BrainChunk { embedding: number[] }
interface BrainFile { hash: string; chunks: StoredChunk[] }
interface BrainIndex {
  version: number;
  model: string;
  updatedAt: string | null;
  files: Record<string, BrainFile>;
  errors: { path: string; error: string }[];
}
export interface BrainStatus {
  sources: { id: string; chunks: number }[];
  root: string;
  indexPath: string;
  model: string;
  indexedAt: string | null;
  files: number;
  chunks: number;
  indexing: boolean;
  errors: { path: string; error: string }[];
  progress?: { phase: "scanning" | "extracting" | "embedding" | "saving" | "complete"; completed: number; total: number; current?: string };
  turboVec?: { enabled: boolean; ready: boolean; building: boolean; count?: number; dimension?: number; error?: string };
}
export interface BrainSearchResult extends BrainChunk {
  score: number;
  lexicalScore: number;
  cosineScore: number;
  citation: string;
}
export interface BrainOptions {
  root?: string;
  dataDir?: string;
  ollamaUrl?: string;
  embed?: (texts: string[]) => Promise<number[][]>;
}

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

// Reject links in every existing component, including junctions on Windows.
async function noLinks(target: string) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink non consentito: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export function chunkBrainText(text: string, source: string, lineKind: BrainChunk["lineKind"] = "source"): BrainChunk[] {
  const chunks: BrainChunk[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let buffer = "", start = 1, end = 1, section: string | undefined;
  const flush = () => {
    if (buffer.trim()) chunks.push({
      id: createHash("sha256").update(`${source}:${start}:${end}:${chunks.length}:${buffer}`).digest("hex"),
      path: source, text: buffer, startLine: start, endLine: end, section, lineKind,
    });
    buffer = "";
  };
  lines.forEach((line, index) => {
    const heading = /^#{1,6}\s+(.+)/.exec(line);
    if (heading) { flush(); section = heading[1].trim(); }
    // Prefer sentence boundaries. Long source-code/minified lines still use a
    // hard cap. A short tail overlap preserves facts split at chunk borders.
    const sentences = line.match(/[^.!?\n]+(?:[.!?]+["'»”’)]*|$)/gu) ?? [line];
    const fragments = sentences.flatMap(sentence => sentence.length <= CHUNK_SIZE ? [sentence] : Array.from({ length: Math.ceil(sentence.length / (CHUNK_SIZE - CHUNK_OVERLAP)) }, (_, part) => sentence.slice(part * (CHUNK_SIZE - CHUNK_OVERLAP), part * (CHUNK_SIZE - CHUNK_OVERLAP) + CHUNK_SIZE)));
    for (const fragment of fragments.length ? fragments : [""]) {
      if (buffer.length + fragment.length + 1 > CHUNK_SIZE) {
        const previous = buffer;
        flush();
        const tail = previous.slice(-CHUNK_OVERLAP).replace(/^\S*\s/u, "").trim();
        if (tail && tail.length + fragment.length + 1 <= CHUNK_SIZE) buffer = tail;
      }
      if (!buffer) start = index + 1;
      end = index + 1;
      buffer += (buffer ? "\n" : "") + fragment.trim();
    }
  });
  flush();
  return chunks;
}

function documentOverview(text: string, source: string, lineKind: BrainChunk["lineKind"]): BrainChunk[] {
  if (text.length < 3_000) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const parts: string[] = [`# Panoramica di ${path.basename(source)}`];
  for (let i = 0; i < lines.length && parts.join("\n").length < 4_800; i++) {
    if (/^#{1,6}\s+\S|^\s*(?:cap(?:itolo)?|chapter)\b/i.test(lines[i])) {
      const context = lines.slice(i, Math.min(lines.length, i + 4)).join(" ").replace(/\s+/g, " ").trim();
      if (context) parts.push(context.slice(0, 420));
    }
  }
  if (parts.length === 1) {
    const paragraphs = text.split(/\n\s*\n/u).map(value => value.replace(/\s+/g, " ").trim()).filter(Boolean);
    parts.push(...paragraphs.slice(0, 10).map(value => value.slice(0, 420)));
  }
  return chunkBrainText(parts.join("\n\n"), source, lineKind).map(chunk => ({ ...chunk, kind: "overview" as const, section: "Panoramica documento" }));
}

export function decodeBrainText(buffer: Buffer): string {
  let text: string;
  const bom16 = buffer.length >= 2 && (buffer.readUInt16BE(0) === 0xfffe || buffer.readUInt16BE(0) === 0xfeff);
  if (bom16) text = new TextDecoder(buffer[0] === 0xff ? "utf-16le" : "utf-16be", { fatal: true }).decode(buffer);
  else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch {
      // Legacy source comments are mostly ASCII; never guess arbitrary binary encodings.
      if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || buffer.some(b => b < 32 && ![9, 10, 13].includes(b)) || buffer.filter(b => b >= 128).length / buffer.length > 0.15) throw new Error("Codifica testo non riconosciuta o file binario.");
      text = new TextDecoder("windows-1252", { fatal: true }).decode(buffer);
    }
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) throw new Error("File binario non indicizzabile.");
  return text;
}

function fallbackOfficeMarkdown(buffer: Buffer, extension: string) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error("Documento Office non valido: richiesto ZIP, non HTML rinominato.");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > 2000 || entries.reduce((sum, entry) => sum + entry.header.size, 0) > 20 * 1024 * 1024) throw new Error("Archivio Office troppo grande.");
  const name = extension === ".odt" ? "content.xml" : "word/document.xml";
  const entry = zip.getEntry(name);
  if (!entry || entry.header.size > MAX_TEXT) throw new Error(`XML Office mancante o troppo grande: ${name}`);
  const xml = entry.getData().toString("utf8");
  if (Buffer.byteLength(xml) > MAX_TEXT || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("XML Office non valido o non sicuro.");
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false, processEntities: false });
  const nodes = parser.parse(xml) as Record<string, unknown>[];
  let text = "";
  const walk = (items: Record<string, unknown>[]) => {
    for (const node of items) for (const [tag, value] of Object.entries(node)) {
      if (tag === "#text") text += String(value).replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity]!);
      else if (tag !== ":@" && Array.isArray(value)) {
        if (tag === "text:h") text += "\n# ";
        if (/^(?:w:tab|text:tab|text:s)$/.test(tag)) text += " ";
        walk(value);
        if (/^(?:w:p|text:p|text:h|w:br|text:line-break)$/.test(tag)) text += "\n";
      }
    }
  };
  walk(nodes);
  return text;
}

function sampledLargeText(text: string, source: string) {
  if (Buffer.byteLength(text) <= MAX_TEXT) return text;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const parts = [`# Estratto indicizzabile di ${path.basename(source)}`, `File grande: ${lines.length.toLocaleString("it-IT")} righe. Brain indicizza intestazione e prime righe per evitare un indice enorme.`];
  if (lines[0]) parts.push(`Intestazione:\n${lines[0].slice(0, 8_000)}`);
  let size = Buffer.byteLength(parts.join("\n\n"));
  for (const line of lines.slice(1)) {
    const next = `${line}\n`;
    size += Buffer.byteLength(next);
    if (size > MAX_TABULAR_SAMPLE) break;
    parts.push(line);
  }
  return parts.join("\n");
}

function extractNotebookMarkdown(buffer: Buffer) {
  if (!buffer.length) return "";
  const notebook = JSON.parse(decodeBrainText(buffer)) as { cells?: Array<{ cell_type?: string; source?: string | string[] }> };
  if (!Array.isArray(notebook.cells)) throw new Error("Notebook Jupyter non valido: celle mancanti.");
  const parts: string[] = [];
  notebook.cells.forEach((cell, index) => {
    if (cell.cell_type !== "markdown" && cell.cell_type !== "code") return;
    const source = Array.isArray(cell.source) ? cell.source.join("") : typeof cell.source === "string" ? cell.source : "";
    const clean = source.replace(/\r\n?/g, "\n").trim();
    if (!clean) return;
    parts.push(cell.cell_type === "markdown" ? `# Cella ${index + 1} markdown\n${clean}` : `# Cella ${index + 1} codice\n\`\`\`python\n${clean}\n\`\`\``);
  });
  if (!parts.length) return "";
  return parts.join("\n\n");
}

async function extract(buffer: Buffer, extension: string, source = ""): Promise<{ text: string; lineKind: BrainChunk["lineKind"]; pages?: { num: number; text: string }[] }> {
  if (extension === ".csv") return { text: sampledLargeText(decodeBrainText(buffer), source), lineKind: "source" };
  if (/^\.(?:odt|ods|odp|doc|docx|docm|rtf|epub|ppt|pptx|pps|xls|xlsx|pdf)$/i.test(extension)) {
    try {
      const { toMarkdownBytes, formatFromExtension } = await import("@firecrawl/anydoc/anydoc.js");
      const markdown = await toMarkdownBytes(buffer, formatFromExtension(extension), { ocr: "reject" });
      if (!markdown.trim()) throw new Error("Documento senza testo estraibile.");
      return { text: markdown, lineKind: "extracted" };
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if ((extension === ".odt" || extension === ".docx") && ["unsupported", "malformed", "missingPart"].includes(code ?? "")) return { text: fallbackOfficeMarkdown(buffer, extension), lineKind: "extracted" };
      if (code === "needsOcr") throw new Error("PDF senza testo estraibile: OCR necessario (disattivato per privacy). ");
      if (extension === ".pdf" && code === "malformed") throw new Error("PDF non valido o non estraibile.");
      throw new Error(`Conversione Markdown fallita${code ? ` (${code})` : ""}: ${(error as Error).message}`);
    }
  }
  if (extension === ".ipynb") return { text: extractNotebookMarkdown(buffer), lineKind: "extracted" };
  const text = sampledLargeText(decodeBrainText(buffer), source);
  return { text, lineKind: "source" };
}

export function validateBrainRepositoryUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("URL repository GitHub HTTPS non valido."); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\/?$/.test(url.pathname)) {
    throw new Error("Usare https://github.com/owner/repo senza credenziali, query o frammenti.");
  }
  const repoPath = url.pathname.replace(/\/$/, "").replace(/\.git$/, "");
  return `https://github.com${repoPath}.git`;
}
export interface BrainDiagnostics { root: string; dataDir: string; documentsOnDisk: number; indexedFiles: number; indexedChunks: number; index: { present: boolean; valid: boolean; updatedAt: string | null; errors: number; embeddingDimension?: number }; embeddings: { checked: number; valid: number; invalid: number; dimensions: number[] }; backups: { path: string; present: boolean }[]; turboVec: NonNullable<BrainStatus["turboVec"]>; verdict: string[]; }
interface BrainFeedback { id: string; query: string; terms: string[]; sources: string[]; rating: 1 | -1; createdAt: string }
export interface BrainGraphNode {
  id: string;
  label: string;
  type: "collection" | "file" | "chunk";
  path: string;
  chunks: number;
  files: number;
  score: number;
  vitality: number;
  active: boolean;
  preview?: string;
}
export interface BrainGraphEdge { source: string; target: string; similarity: number; flow: number }
export interface BrainGraph {
  level: "collections" | "files" | "chunks";
  scope: string;
  query: string;
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  truncated: boolean;
  totals: { nodes: number; edges: number; active: number };
}

export function validateBrainProfileUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("URL profilo GitHub HTTPS non valido."); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/?$/.test(url.pathname)) {
    throw new Error("Usare https://github.com/utente senza credenziali, query o frammenti.");
  }
  return `https://github.com${url.pathname.replace(/\/$/, "")}`;
}

function tokens(text: string) { return text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []; }
function identityExcerpt(text: string, names: string[]) {
  const lower = text.toLocaleLowerCase("it");
  const positions = names.map(name => lower.indexOf(name.toLocaleLowerCase("it"))).filter(position => position >= 0);
  if (!positions.length) return text;
  const entity = Math.min(...positions);
  // Start at the sentence that introduces the requested entity. This prevents
  // traits belonging to the previous character from leaking into its profile.
  const before = text.slice(Math.max(0, entity - 240), entity);
  const boundary = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"));
  const start = Math.max(0, entity - 240) + boundary + 1;
  const desiredEnd = Math.min(text.length, start + 1050);
  const tail = text.slice(Math.min(start + 650, desiredEnd), desiredEnd);
  const after = tail.search(/[.!?](?:\s|$)/u);
  const end = after >= 0 ? Math.min(text.length, start + 650 + after + 1) : desiredEnd;
  return text.slice(start, end).trim();
}

function sentenceWindow(text: string, terms: string[]) {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+["'»”’)]*|$)/gu)?.map(value => value.trim()).filter(Boolean) ?? [text];
  let best = 0, bestCoverage = 0;
  sentences.forEach((sentence, index) => {
    const words = new Set(tokens(sentence));
    const coverage = terms.filter(term => words.has(term)).length;
    if (coverage > bestCoverage) { best = index; bestCoverage = coverage; }
  });
  const windowText = sentences.slice(Math.max(0, best - 1), Math.min(sentences.length, best + 2)).join(" ").slice(0, CHUNK_SIZE);
  const windowWords = new Set(tokens(windowText));
  return { text: windowText, coverage: terms.length ? terms.filter(term => windowWords.has(term)).length / terms.length : 0 };
}
function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) throw new Error("Dimensioni embedding cambiate: ricreare l'indice.");
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return dot / Math.sqrt(aa * bb);
}

export function createBrain(options: BrainOptions = {}) {
  const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const root = path.resolve(options.root ?? process.env.BRAIN_ROOT ?? path.join(workspace, "ANDREA-BRAIN"));
  const dataDir = path.resolve(options.dataDir ?? process.env.BRAIN_DATA_DIR ?? path.join(root, ".index"));
  const indexPath = path.join(dataDir, "index.json");
  const turboIndexPath = path.join(dataDir, "index.tvim");
  const turboMetaPath = path.join(dataDir, "index.turbovec.json");
  const feedbackPath = path.join(dataDir, "feedback.json");
  const backupPaths = [path.join(dataDir, "index.backup.json"), path.join(dataDir, "index.previous.json")];
  const turboScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "turbovec_bridge.py");
  const turboEnabled = process.env.BRAIN_TURBOVEC !== "0" && !options.embed;
  const ollama = new URL(localOllamaUrl(options.ollamaUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"));
  let indexing = false;
  let importing = false;
  let progress: BrainStatus["progress"];
  let turboBuilding = false;
  let turboInfo: NonNullable<BrainStatus["turboVec"]> = { enabled: turboEnabled, ready: false, building: false };
  const empty = (): BrainIndex => ({ version: VERSION, model: MODEL, updatedAt: null, files: {}, errors: [] });
  let cachedIndex: { stamp: string; value: BrainIndex } | undefined;
  const lexicalCache = new WeakMap<BrainIndex, Map<string, { chunk: StoredChunk; turboId: number; words: string[]; body: Set<string>; counts: Map<string, number> }[]>>();
  const noiseFile = (name: string) => /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock)$/i.test(name);

  async function loadFeedback(): Promise<BrainFeedback[]> {
    try {
      await noLinks(feedbackPath);
      const parsed = JSON.parse(await fs.readFile(feedbackPath, "utf8"));
      return Array.isArray(parsed) ? parsed.slice(-2000) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  function feedbackBoost(feedback: BrainFeedback[], query: string, sourcePath: string) {
    const queryTerms = new Set(tokens(query).filter(term => term.length > 2));
    if (!queryTerms.size) return 0;
    let weighted = 0, weight = 0;
    for (const entry of feedback) {
      const exactChunk = /:\d+(?:-\d+)?/u.test(sourcePath);
      if (!entry.sources.some(source => exactChunk ? source === sourcePath : source === sourcePath || source.startsWith(`${sourcePath}/`) || sourcePath.startsWith(`${source}/`))) continue;
      const overlap = entry.terms.filter(term => queryTerms.has(term)).length / Math.max(queryTerms.size, entry.terms.length, 1);
      if (overlap < 0.2) continue;
      weighted += entry.rating * overlap; weight += overlap;
    }
    return weight ? Math.max(-0.14, Math.min(0.14, weighted / weight * 0.10)) : 0;
  }

  async function recordBrainFeedback(input: { query: string; rating: 1 | -1; sources: string[] }) {
    const query = input.query.trim().slice(0, 600);
    const sources = [...new Set(input.sources.map(source => source.replace(/\\/g, "/").trim()).filter(source => source && !source.includes("..") && !path.isAbsolute(source)))].slice(0, 8);
    if (!query || !sources.length) throw new Error("Feedback senza domanda o fonti.");
    const feedback = await loadFeedback();
    feedback.push({ id: randomUUID(), query, terms: [...new Set(tokens(query).filter(term => term.length > 2))].slice(0, 16), sources, rating: input.rating, createdAt: new Date().toISOString() });
    await fs.mkdir(dataDir, { recursive: true });
    const temporary = `${feedbackPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(feedback.slice(-2000), null, 2), { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, feedbackPath);
    return { saved: true, count: Math.min(feedback.length, 2000) };
  }

  async function load(): Promise<BrainIndex> {
    await noLinks(indexPath);
    try {
      const info = await fs.stat(indexPath);
      if (info.size > 256 * 1024 * 1024) throw new Error("Indice troppo grande.");
      const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`;
      if (cachedIndex?.stamp === stamp) return cachedIndex.value;
      const index = JSON.parse(await fs.readFile(indexPath, "utf8")) as BrainIndex;
      if (index.version !== VERSION || index.model !== MODEL || !index.files || !Array.isArray(index.errors)) return empty();
      cachedIndex = { stamp, value: index };
      return index;
    } catch (error) {
      cachedIndex = undefined;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        for (const backup of backupPaths) {
          try {
            const backupIndex = JSON.parse(await fs.readFile(backup, "utf8")) as BrainIndex;
            if (backupIndex.version === VERSION && backupIndex.model === MODEL && backupIndex.files && Array.isArray(backupIndex.errors)) return backupIndex;
          } catch { /* prova il backup successivo */ }
        }
        return empty();
      }
      throw error;
    }
  }

  async function embed(texts: string[]): Promise<number[][]> {
    const batchSize = options.embed ? 8 : BATCH_SIZE;
    const batches = Array.from({ length: Math.ceil(texts.length / batchSize) }, (_, i) => texts.slice(i * batchSize, (i + 1) * batchSize));
    const vectors: number[][][] = new Array(batches.length);
    for (let offset = 0; offset < batches.length; offset += EMBED_CONCURRENCY) {
      const active = batches.slice(offset, offset + EMBED_CONCURRENCY).map(async (batch, worker) => {
      let values: number[][];
      if (options.embed) values = await options.embed(batch);
      else {
        const response = await fetch(new URL("/api/embed", ollama), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: MODEL, input: batch, truncate: false, keep_alive: "30m" }),
          signal: AbortSignal.timeout(300_000), redirect: "error",
        });
        if (!response.ok) throw new Error(`Ollama embedding HTTP ${response.status}. Verificare nomic-embed-text; overflow non troncato, indice precedente conservato.`);
        values = (await response.json() as { embeddings: number[][] }).embeddings;
      }
      if (!Array.isArray(values) || values.length !== batch.length || values.some(v => !Array.isArray(v) || !v.length || v.length > 8192 || v.some(n => !Number.isFinite(n)) || !v.some(n => n !== 0))) throw new Error("Risposta embedding non valida.");
        vectors[offset + worker] = values;
      });
      await Promise.all(active);
    }
    const flattened = vectors.flat();
    if (flattened.length && flattened.some(v => v.length !== flattened[0].length)) throw new Error("Dimensioni embedding incoerenti.");
    return flattened;
  }

  function status(index: BrainIndex): BrainStatus {
    return { sources: Object.entries(index.files).map(([id, file]) => ({ id, chunks: file.chunks.length })), root, indexPath, model: MODEL, indexedAt: index.updatedAt, files: Object.keys(index.files).length, chunks: Object.values(index.files).reduce((sum, file) => sum + file.chunks.length, 0), indexing, errors: index.errors, progress, turboVec: { ...turboInfo, building: turboBuilding } };
  }

  async function getBrainStatus() { return status(await load()); }
  async function diagnose(): Promise<BrainDiagnostics> {
    const verdict: string[] = []; let index = empty(); let present = false;
    try { await fs.access(indexPath); present = true; index = await load(); } catch { verdict.push("Indice principale assente o non leggibile."); }
    let documentsOnDisk = 0;
    const walk = async (directory: string): Promise<void> => { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { if (entry.name === ".index") continue; const full = path.join(directory, entry.name); if (entry.isDirectory()) await walk(full); else if (extensions.has(path.extname(entry.name).toLowerCase())) documentsOnDisk++; } };
    try { await walk(root); } catch { verdict.push("Archivio documenti non raggiungibile."); }
    const chunks = Object.values(index.files).flatMap(file => file.chunks); const dimensions = [...new Set(chunks.map(chunk => chunk.embedding?.length ?? 0))].sort((a, b) => a - b); const invalid = chunks.filter(chunk => !Array.isArray(chunk.embedding) || !chunk.embedding.length || chunk.embedding.some(value => !Number.isFinite(value))).length;
    if (!present || !index.updatedAt) verdict.push("Eseguire la reindicizzazione: non esiste un indice completo.");
    if (documentsOnDisk > Object.keys(index.files).length) verdict.push("Più documenti sul disco che nell'indice: archivio parzialmente indicizzato.");
    if (invalid) verdict.push("Embedding vuoti o non validi."); if (dimensions.length > 1) verdict.push("Dimensioni embedding non uniformi."); if (!turboInfo.ready) verdict.push("TurboVec non pronto: attivo il fallback JSON/ibrido."); if (!verdict.length) verdict.push("Estrazione, embedding, indice e TurboVec coerenti.");
    const backups = await Promise.all(backupPaths.map(async backup => { try { await fs.access(backup); return { path: backup, present: true }; } catch { return { path: backup, present: false }; } }));
    return { root, dataDir, documentsOnDisk, indexedFiles: Object.keys(index.files).length, indexedChunks: chunks.length, index: { present, valid: present && Boolean(index.updatedAt), updatedAt: index.updatedAt, errors: index.errors.length, embeddingDimension: dimensions.length === 1 ? dimensions[0] : undefined }, embeddings: { checked: chunks.length, valid: chunks.length - invalid, invalid, dimensions }, backups, turboVec: { ...turboInfo, building: turboBuilding }, verdict };
  }

  async function getBrainGraph(input: { level?: "collections" | "files" | "chunks"; scope?: string; query?: string; threshold?: number; limit?: number } = {}): Promise<BrainGraph> {
    const level = input.level ?? "collections";
    const scope = (input.scope ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const query = (input.query ?? "").trim().slice(0, 600);
    const threshold = Math.max(0.35, Math.min(0.95, input.threshold ?? 0.60));
    const limit = Math.max(12, Math.min(140, input.limit ?? (level === "collections" ? 60 : 100)));
    if (scope.split("/").some(part => part === "." || part === "..") || scope.includes(":")) throw new Error("Ambito Micelio non valido.");
    const index = await load();
    type Candidate = { id: string; label: string; type: BrainGraphNode["type"]; path: string; chunks: StoredChunk[]; files: number; preview?: string; vector: number[] };
    const centroid = (chunks: StoredChunk[]) => {
      const usable = chunks.filter(chunk => chunk.embedding.length).slice(0, 240);
      if (!usable.length) return [];
      const vector = new Array(usable[0].embedding.length).fill(0) as number[];
      for (const chunk of usable) for (let i = 0; i < vector.length; i++) vector[i] += chunk.embedding[i] / usable.length;
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      return vector.map(value => value / norm);
    };
    const collectionPath = (filePath: string) => {
      const match = /^progetti\/([^/]+)/.exec(filePath);
      return match ? `progetti/${match[1]}` : "Documenti personali";
    };
    let candidates: Candidate[] = [];
    if (level === "collections") {
      const groups = new Map<string, Array<[string, BrainFile]>>();
      for (const entry of Object.entries(index.files)) {
        const group = collectionPath(entry[0]);
        groups.set(group, [...(groups.get(group) ?? []), entry]);
      }
      candidates = [...groups.entries()].map(([group, files]) => {
        const chunks = files.flatMap(([, file]) => file.chunks);
        return { id: `collection:${group}`, label: group === "Documenti personali" ? group : group.slice("progetti/".length), type: "collection", path: group, chunks, files: files.length, vector: centroid(chunks) };
      });
    } else if (level === "files") {
      if (!scope) throw new Error("Scegli una raccolta per esplorare i file.");
      candidates = Object.entries(index.files).filter(([filePath]) => collectionPath(filePath) === scope).map(([filePath, file]) => ({ id: `file:${filePath}`, label: filePath.split("/").at(-1) ?? filePath, type: "file", path: filePath, chunks: file.chunks, files: 1, vector: centroid(file.chunks), preview: file.chunks[0]?.text.slice(0, 260) }));
    } else {
      const file = index.files[scope];
      if (!file) throw new Error("File Micelio non trovato nell'indice.");
      const source = file.chunks;
      const selected = source.length <= limit ? source : Array.from({ length: limit }, (_, i) => source[Math.floor(i * (source.length - 1) / Math.max(1, limit - 1))]);
      candidates = selected.map((chunk, i) => ({ id: `chunk:${chunk.id}:${i}`, label: chunk.section || `Estratto ${i + 1}`, type: "chunk", path: chunk.path, chunks: [chunk], files: 1, vector: centroid([chunk]), preview: chunk.text.slice(0, 320) }));
    }
    const originalTotal = candidates.length;
    if (candidates.length > limit) candidates = candidates.sort((a, b) => b.chunks.length - a.chunks.length || a.label.localeCompare(b.label)).slice(0, limit);
    candidates = candidates.filter(candidate => candidate.vector.length);
    const similarities = candidates.map(() => new Map<number, number>());
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
      const similarity = cosine(candidates[i].vector, candidates[j].vector);
      if (similarity >= threshold) { similarities[i].set(j, similarity); similarities[j].set(i, similarity); }
    }
    const edgeMap = new Map<string, BrainGraphEdge>();
    similarities.forEach((neighbors, i) => {
      [...neighbors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([j, similarity]) => {
        const a = Math.min(i, j), b = Math.max(i, j), key = `${a}:${b}`;
        edgeMap.set(key, { source: candidates[a].id, target: candidates[b].id, similarity, flow: similarity });
      });
    });
    const edges = [...edgeMap.values()];
    const degree = candidates.map(candidate => edges.filter(edge => edge.source === candidate.id || edge.target === candidate.id).length);
    const maxDegree = Math.max(1, ...degree);
    const maxChunks = Math.max(1, ...candidates.map(candidate => candidate.chunks.length));
    let direct = candidates.map(() => 0);
    if (query) {
      const [queryVector] = await embed([`search_query: ${query}`]);
      const queryTerms = new Set(tokens(query));
      direct = candidates.map(candidate => {
        const semantic = Math.max(0, cosine(queryVector, candidate.vector));
        const words = new Set(tokens(`${candidate.path} ${candidate.label} ${candidate.preview ?? ""}`));
        const lexical = queryTerms.size ? [...queryTerms].filter(term => words.has(term)).length / queryTerms.size : 0;
        return Math.min(1, semantic * 0.72 + lexical * 0.28);
      });
    }
    const propagated = candidates.map(() => 0), propagatedWeight = candidates.map(() => 0);
    edges.forEach(edge => {
      const a = candidates.findIndex(candidate => candidate.id === edge.source), b = candidates.findIndex(candidate => candidate.id === edge.target);
      if (a >= 0 && b >= 0) {
        propagated[a] += direct[b] * edge.similarity; propagatedWeight[a] += edge.similarity;
        propagated[b] += direct[a] * edge.similarity; propagatedWeight[b] += edge.similarity;
      }
    });
    propagated.forEach((value, i) => { propagated[i] = propagatedWeight[i] ? value / propagatedWeight[i] : 0; });
    const learnedFeedback = query ? await loadFeedback() : [];
    const rawScores = candidates.map((candidate, i) => query ? Math.max(0, 2.5 * direct[i] + 0.45 * propagated[i] + 0.05 * degree[i] / maxDegree - 0.08 * candidate.chunks.length / maxChunks + feedbackBoost(learnedFeedback, query, candidate.path)) : 0);
    const maxScore = Math.max(0, ...rawScores);
    // Come nel FactoryMicelio originale: una piccola "working set" evita che
    // l'intera rete diventi attiva e consumi inutilmente il budget di contesto.
    const activeIds = new Set(query ? rawScores.map((score, i) => ({ score, i })).filter(item => item.score >= maxScore * 0.46).sort((a, b) => b.score - a.score).slice(0, 7).map(item => item.i) : []);
    const nodes = candidates.map((candidate, i): BrainGraphNode => ({ id: candidate.id, label: candidate.label, type: candidate.type, path: candidate.path, chunks: candidate.chunks.length, files: candidate.files, score: maxScore ? rawScores[i] / maxScore : 0, vitality: 0.65 * degree[i] / maxDegree + 0.35 * Math.min(1, candidate.chunks.length / maxChunks), active: activeIds.has(i), preview: candidate.preview }));
    const activeNodeIds = new Set(nodes.filter(node => node.active).map(node => node.id));
    for (const edge of edges) edge.flow = query && activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target) ? Math.min(1, edge.similarity * 0.65 + 0.35) : edge.similarity * 0.35;
    return { level, scope, query, nodes, edges, truncated: originalTotal > candidates.length, totals: { nodes: nodes.length, edges: edges.length, active: activeIds.size } };
  }

  async function indexBrain(uploads: Array<{ name: string; data: string }> = [], presetId = 20): Promise<BrainStatus> {
    const preset = brainUploadPreset(presetId);
    const uploadLimit = preset.fileMiB * 1024 * 1024;
    if (uploads.length > 50) throw new Error("Massimo 50 file per caricamento.");
    const decoded = uploads.map(file => {
      if (!file.name || file.name.length > 180 || /[<>:"/\\|?*\x00-\x1f]/.test(file.name) || /[. ]$/.test(file.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name) || excluded.test(file.name) || noiseFile(file.name) || !extensions.has(path.extname(file.name).toLowerCase())) throw new Error(`Nome o formato non supportato: ${file.name}`);
      if (file.data.length > 4 * Math.ceil(uploadLimit / 3) || /[^A-Za-z0-9+/=]/.test(file.data)) throw new Error(`File non valido o maggiore di ${preset.fileMiB} MiB: ${file.name}`);
      const buffer = Buffer.from(file.data, "base64");
      if (buffer.toString("base64") !== file.data) throw new Error(`Contenuto non valido: ${file.name}`);
      if (!buffer.length || buffer.length > uploadLimit) throw new Error(`File vuoto o maggiore di ${preset.fileMiB} MiB: ${file.name}`);
      return { name: file.name, buffer };
    });
    if (decoded.reduce((sum, file) => sum + file.buffer.length, 0) > preset.totalMiB * 1024 * 1024) throw new Error(`Massimo ${preset.totalMiB} MiB per caricamento.`);
    if (indexing || importing) throw new Error("Operazione brain gia in corso.");
    indexing = true;
    let lock: fs.FileHandle | undefined;
    const lockPath = path.join(dataDir, "index.lock");
    const temporary = path.join(dataDir, `index-${randomUUID()}.tmp`);
    try {
      await noLinks(root); await noLinks(dataDir);
      if (decoded.length) await fs.mkdir(root, { recursive: true });
      await fs.access(root); await fs.mkdir(dataDir, { recursive: true });
      lock = await fs.open(lockPath, "wx", 0o600);
      for (const file of decoded) {
        const extension = path.extname(file.name);
        const stem = file.name.slice(0, -extension.length);
        for (let suffix = 0; ; suffix++) {
          const destination = path.join(root, suffix ? `${stem} (${suffix})${extension}` : file.name);
          try { await fs.writeFile(destination, file.buffer, { flag: "wx", mode: 0o600 }); break; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        }
      }
      const previous = await load();
      const next = empty();
      let fileCount = 0, chunkCount = 0, visited = 0;
      const pending: StoredChunk[] = [];
      progress = { phase: "scanning", completed: 0, total: 0 };
      async function countFiles(directory: string): Promise<number> {
        let count = 0;
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink() || excluded.test(entry.name)) continue;
          const absolute = path.join(directory, entry.name);
          if (inside(dataDir, absolute)) continue;
          if (entry.isDirectory()) count += await countFiles(absolute);
          else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()) && !noiseFile(path.relative(root, absolute).split(path.sep).join("/"))) count++;
        }
        return count;
      }
      progress.total = await countFiles(root);
      async function walk(directory: string) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (++visited > 50_000) throw new Error("Troppi elementi nella cartella brain.");
          if (entry.isSymbolicLink() || excluded.test(entry.name)) continue;
          const absolute = path.join(directory, entry.name);
          if (inside(dataDir, absolute)) continue;
          await noLinks(absolute);
          if (!inside(root, await fs.realpath(absolute))) throw new Error("Percorso fuori dalla root brain.");
          if (entry.isDirectory()) { await walk(absolute); continue; }
          if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
          if (++fileCount > MAX_FILES) throw new Error("Troppi documenti: massimo 5000.");
          const relative = path.relative(root, absolute).split(path.sep).join("/");
          if (noiseFile(relative)) continue;
          progress = { phase: "extracting", completed: fileCount, total: progress?.total ?? fileCount, current: relative };
          let chunks: BrainChunk[], hash: string;
          try {
            const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            let buffer: Buffer;
            try {
              const info = await handle.stat();
              if (!info.isFile() || info.size > MAX_FILE) throw new Error("File non regolare o maggiore di 100 MiB.");
              buffer = Buffer.alloc(Math.min(MAX_FILE + 1, info.size + 1));
              const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
              if (bytesRead > MAX_FILE) throw new Error("File maggiore di 100 MiB.");
              buffer = buffer.subarray(0, bytesRead);
            } finally { await handle.close(); }
            hash = createHash("sha256").update(buffer).digest("hex");
            if (previous.files[relative]?.hash === hash) {
              next.files[relative] = previous.files[relative];
              chunkCount += previous.files[relative].chunks.length;
              if (chunkCount > MAX_CHUNKS) throw new Error(`Troppi chunk: massimo ${MAX_CHUNKS}.`);
              continue;
            }
            const extracted = await extract(buffer, path.extname(entry.name).toLowerCase(), relative);
            if (Buffer.byteLength(extracted.text) > MAX_TEXT) throw new Error("Testo estratto maggiore di 2 MiB.");
            chunks = extracted.pages ? extracted.pages.flatMap(page => chunkBrainText(page.text, relative, "extracted").map(chunk => ({ ...chunk, page: page.num, id: createHash("sha256").update(`${chunk.id}:page:${page.num}`).digest("hex") }))) : chunkBrainText(extracted.text, relative, extracted.lineKind);
            chunks = chunks.map(chunk => ({ ...chunk, kind: "content" as const }));
            chunks.push(...documentOverview(extracted.text, relative, extracted.lineKind));
          } catch (error) {
            next.errors.push({ path: relative, error: error instanceof Error ? error.message : String(error) });
            continue;
          }
          chunkCount += chunks.length;
          if (chunkCount > MAX_CHUNKS) throw new Error(`Troppi chunk: massimo ${MAX_CHUNKS}.`);
          const stored = chunks.map(chunk => ({ ...chunk, embedding: [] as number[] }));
          next.files[relative] = { hash, chunks: stored };
          pending.push(...stored);
        }
      }
      await walk(root);
      const projects = new Map<string, Array<[string, BrainFile]>>();
      for (const [filePath, file] of Object.entries(next.files)) {
        const match = /^(progetti\/[^/]+)\//.exec(filePath);
        if (match) projects.set(match[1], [...(projects.get(match[1]) ?? []), [filePath, file]]);
      }
      for (const [project, files] of projects) {
        const readme = files.filter(([filePath]) => /\/readme(?:\.[^/]*)?$/i.test(filePath)).flatMap(([, file]) => file.chunks.filter(chunk => chunk.kind !== "overview").map(chunk => chunk.text)).join("\n").slice(0, 3_000);
        const tree = files.map(([filePath]) => filePath.slice(project.length + 1)).sort().slice(0, 180).join("\n");
        const text = `# Progetto ${project.replace(/^progetti\/Langiott--/, "")}\n\n## File principali\n${tree}\n\n## README\n${readme}`;
        const syntheticPath = `${project}/__panoramica_progetto.md`;
        const synthetic = chunkBrainText(text, syntheticPath, "extracted").map(chunk => ({ ...chunk, kind: "overview" as const, section: "Panoramica progetto", embedding: [] as number[] }));
        const hash = createHash("sha256").update(text).digest("hex");
        next.files[syntheticPath] = { hash, chunks: synthetic };
        pending.push(...synthetic);
        chunkCount += synthetic.length;
      }
      // Embedding failures abort the entire transaction, rather than losing a usable index.
      for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
        progress = { phase: "embedding", completed: offset, total: pending.length };
        const batch = pending.slice(offset, offset + BATCH_SIZE);
        const vectors = await embed(batch.map(chunk => `search_document: Percorso: ${chunk.path}\n${chunk.section ? `Sezione: ${chunk.section}\n` : ""}${chunk.text}`));
        batch.forEach((chunk, i) => { chunk.embedding = vectors[i]; });
      }
      const all = Object.values(next.files).flatMap(file => file.chunks);
      if (all.some(chunk => chunk.embedding.length !== all[0].embedding.length)) throw new Error("Dimensioni embedding cambiate: ricreare l'indice.");
      next.updatedAt = new Date().toISOString();
      const serialized = JSON.stringify(next);
      progress = { phase: "saving", completed: all.length, total: all.length };
      if (Buffer.byteLength(serialized) > 256 * 1024 * 1024) throw new Error("Indice maggiore di 256 MiB.");
      const output = await fs.open(temporary, "wx", 0o600);
      try { await output.writeFile(serialized); await output.sync(); } finally { await output.close(); }
      await fs.rm(backupPaths[1], { force: true });
      try { await fs.rename(backupPaths[0], backupPaths[1]); } catch { /* primo indice: nessun backup precedente */ }
      try { await fs.rename(indexPath, backupPaths[0]); } catch { /* primo indice: nessun indice precedente */ }
      await fs.rename(temporary, indexPath);
      cachedIndex = undefined;
      progress = { phase: "complete", completed: all.length, total: all.length };
      void rebuildTurboIndex().catch(() => undefined);
      return { ...status(next), indexing: false };
    } finally {
      indexing = false;
      await fs.rm(temporary, { force: true });
      if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }); }
    }
  }

  async function rebuildTurboIndex() {
    if (!turboEnabled) return turboInfo;
    if (turboBuilding) return { ...turboInfo, building: true };
    turboBuilding = true;
    const temporaryIndex = path.join(dataDir, `turbovec-${randomUUID()}.tvim`);
    const temporaryMeta = path.join(dataDir, `turbovec-${randomUUID()}.json`);
    try {
      const index = await load();
      const count = Object.values(index.files).reduce((sum, file) => sum + file.chunks.length, 0);
      if (!count || !index.updatedAt) { turboInfo = { enabled: true, ready: false, building: false }; return turboInfo; }
      try {
        const existing = JSON.parse(await fs.readFile(turboMetaPath, "utf8")) as { updatedAt?: string; count?: number; dimension?: number };
        await fs.access(turboIndexPath);
        if (existing.updatedAt === index.updatedAt && existing.count === count) {
          turboInfo = { enabled: true, ready: true, building: false, count, dimension: existing.dimension };
          return turboInfo;
        }
      } catch { /* Indice TurboVec assente o non aggiornato. */ }
      await fs.mkdir(dataDir, { recursive: true });
      const python = process.env.TURBOVEC_PYTHON || process.env.DOCTR_PYTHON || "python";
      await run(python, [turboScript, "build", "--source", indexPath, "--output", temporaryIndex, "--metadata", temporaryMeta], { shell: false, windowsHide: true, timeout: 10 * 60_000, maxBuffer: 2_000_000 });
      const metadata = JSON.parse(await fs.readFile(temporaryMeta, "utf8")) as { count: number; dimension: number };
      await fs.rename(temporaryIndex, turboIndexPath);
      await fs.rename(temporaryMeta, turboMetaPath);
      turboInfo = { enabled: true, ready: true, building: false, count: metadata.count, dimension: metadata.dimension };
      return turboInfo;
    } catch (error) {
      turboInfo = { enabled: true, ready: false, building: false, error: error instanceof Error ? error.message.slice(0, 220) : String(error) };
      return turboInfo;
    } finally {
      turboBuilding = false;
      await fs.rm(temporaryIndex, { force: true });
      await fs.rm(temporaryMeta, { force: true });
    }
  }

  async function turboSearch(index: BrainIndex, vector: number[], allowlist?: number[]) {
    if (!turboEnabled) return undefined;
    try {
      const metadata = JSON.parse(await fs.readFile(turboMetaPath, "utf8")) as { updatedAt?: string; count?: number };
      if (metadata.updatedAt !== index.updatedAt) return undefined;
      const requestPath = path.join(dataDir, `turbo-query-${randomUUID()}.json`);
      try {
        await fs.writeFile(requestPath, JSON.stringify({ vector, allowlist, k: 512 }), { flag: "wx", mode: 0o600 });
        const python = process.env.TURBOVEC_PYTHON || process.env.DOCTR_PYTHON || "python";
        const result = await run(python, [turboScript, "search", "--index", turboIndexPath, "--request", requestPath], { shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
        const parsed = JSON.parse(result.stdout) as { results: Array<{ id: number; score: number }> };
        return new Map(parsed.results.map(item => [item.id, item.score]));
      } finally { await fs.rm(requestPath, { force: true }); }
    } catch { return undefined; }
  }

  async function searchBrain(query: string, sourceFilter?: string): Promise<BrainSearchResult[]> {
    if (!query.trim() || query.length > CHUNK_SIZE) throw new Error("Query richiesta, massimo 1400 caratteri.");
    const filter = sourceFilter?.replace(/\\/g, "/").replace(/\/$/, "");
    if (filter && (filter.startsWith("/") || filter.split("/").some(part => part === ".." || part === ".") || filter.includes(":"))) throw new Error("Filtro sorgente non valido: usare un percorso relativo.");
    const index = await load();
    let prepared = lexicalCache.get(index);
    if (!prepared) { prepared = new Map(); lexicalCache.set(index, prepared); }
    const key = filter ?? "";
    let entries = prepared.get(key);
    if (!entries) {
      entries = Object.values(index.files).flatMap(file => file.chunks).map((chunk, turboId) => ({ chunk, turboId }))
        .filter(({ chunk }) => !noiseFile(chunk.path) && (!filter || chunk.path === filter || chunk.path.startsWith(`${filter}/`)))
        .map(({ chunk, turboId }) => {
          const words = tokens(`${chunk.path} ${chunk.section ?? ""} ${chunk.text}`);
          const counts = new Map<string, number>();
          for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
          return { chunk, turboId, words, counts, body: new Set(tokens(chunk.text)) };
        });
      if (prepared.size >= 8) prepared.clear();
      prepared.set(key, entries);
    }
    const chunks = entries.map(entry => entry.chunk);
    if (!chunks.length) return [];
    // Anche le ricerche telegrafiche ("chi Nova?") sono domande biografiche.
    const identityQuestion = /^\s*chi\b(?:\s+(?:e|è|sia))?[\s:,-]+\S/iu.test(query);
    const roleQuestion = /\b(?:lavoro|professione|mestiere|occupazione|ruolo|che\s+cosa\s+fa)\b/iu.test(query);
    const stopWords = new Set(["chi", "cosa", "che", "come", "dove", "quando", "quale", "quali", "tipo", "fa", "lavoro", "professione", "mestiere", "occupazione", "ruolo", "sono", "essere", "sia", "ha", "hai", "ho", "un", "una", "uno", "il", "lo", "la", "i", "gli", "le", "di", "del", "della", "dei", "delle", "nel", "nella", "nei", "nelle", "per", "progetto", "progetti", "usato", "usata", "utilizzato", "utilizzata", "esiste", "creare", "trova", "trovami", "scrivi", "scrivimi", "codice", "modello"]);
    const queryLower = query.toLocaleLowerCase("it");
    const maskRcnnIntent = /\bmask\b/iu.test(queryLower) && /\b(?:r\s*-?\s*cnn|rcnn|mrcnn)\b/iu.test(queryLower);
    const expandedQuery = maskRcnnIntent ? `${query} mrcnn r-cnn maskrcnn detectron2 defaultpredictor pred_masks instances segmentation segmentazione` : query;
    const terms = [...new Set(tokens(expandedQuery).filter(term => !stopWords.has(term)))];
    const identityTerms = identityQuestion ? terms : [];
    const factualQuestion = !identityQuestion && /^\s*(?:che|quale|quali|dove|quando|quanto|quanta|quanti|quante)\b/iu.test(query);
    // Espansione generica dell'intento: migliora l'embedding delle domande
    // brevissime senza conoscere in anticipo nomi, ruoli o risposte.
    const semanticQuery = identityQuestion
      ? `Identità, descrizione, caratteristiche, storia e ruolo di ${identityTerms.join(" ")}. Domanda: ${query}`
      : roleQuestion ? `Professione, lavoro, ruolo, incarico e organizzazione del soggetto. Domanda: ${query}`
      : query;
    const overviewQuestion = /\b(?:riassum|panoramica|in generale|parla di|contiene|quali progetti|che progetti|cosa ho fatto|come ho usato|come ho utilizzato|come ho realizzato|come ho creato|come ho costruito|nel mio progetto)\b/iu.test(query);
    const [vector] = await embed([`search_query: ${semanticQuery}`]);
    const turboScores = await turboSearch(index, vector, filter ? entries.map(entry => entry.turboId) : undefined);
    const documentTokens = entries.map(entry => entry.words);
    const documents = entries.map(entry => entry.counts);
    const averageLength = documentTokens.reduce((sum, words) => sum + words.length, 0) / documentTokens.length || 1;
    const weights = terms.map(term => Math.log(1 + (chunks.length - documents.filter(doc => doc.has(term)).length + 0.5) / (documents.filter(doc => doc.has(term)).length + 0.5)));
    const learnedFeedback = await loadFeedback();
    const ranked = chunks.map((chunk, i) => {
      const bm25 = terms.reduce((sum, term, j) => {
        const frequency = documents[i].get(term) ?? 0;
        if (!frequency) return sum;
        const saturation = frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * documentTokens[i].length / averageLength));
        return sum + weights[j] * saturation;
      }, 0);
      const lexicalScore = bm25 / (1 + bm25);
      const cosineScore = turboScores ? (turboScores.get(entries![i].turboId) ?? -1) : cosine(vector, chunk.embedding);
      const { embedding: _embedding, ...source } = chunk;
      const entityMatch = !identityQuestion || identityTerms.some(term => entries![i].body.has(term));
      // Prefer descriptions of the requested entity over repeated dialogue mentions.
      // Match within a sentence, never merely the document's filename.
      const description = identityQuestion && chunk.text.split(/[.!?\n]/u).some(sentence => {
        const words = tokens(sentence);
        return identityTerms.some(term => words.some((word, position) => word === term &&
          words.slice(position + 1, position + 5).some(next => /^(?:protagonista|studente|studentessa|personaggio|fondatore|fondatrice|autore|autrice)$/.test(next))));
      });
      const window = factualQuestion ? sentenceWindow(chunk.text, terms) : { text: chunk.text, coverage: 0 };
      const focused = identityQuestion ? identityExcerpt(chunk.text, identityTerms) : window.text;
      const roleEvidence = roleQuestion && chunk.text.split(/[.!?\n]/u).some(sentence => {
        const sentenceTerms = new Set<string>(tokens(sentence));
        return /\b(?:lavora|lavorare|cadett\w*|riparator\w*|membro|incarico|missione)\b/iu.test(sentence) && terms.some(term => sentenceTerms.has(term));
      });
      const entityPosition = identityQuestion ? Math.min(...identityTerms.map(term => chunk.text.toLocaleLowerCase("it").indexOf(term)).filter(position => position >= 0)) : 0;
      const rankLine = chunk.startLine + (entityPosition > 0 ? (chunk.text.slice(0, entityPosition).match(/\n/g) ?? []).length : 0);
      const profileFacts = identityQuestion ? new Set(focused.toLocaleLowerCase("it").match(/\b(?:protagonista|amic[oa]|riparator\w*|medic\w*|biolog\w*|coltivator\w*|ingegner\w*|scienziat\w*|pilot\w*|principessa|principe|orfan[oa]|lavora|professione|ruolo)\b/giu) ?? []).size : 0;
      const profileBoost = Math.min(0.40, profileFacts * 0.10);
      const overviewRelevant = terms.length === 0 || terms.some(term => entries![i].body.has(term));
      const overviewBoost = overviewQuestion && chunk.kind === "overview" && overviewRelevant ? 0.12 : 0;
      const maskRcnnBoost = maskRcnnIntent && (/(?:computer[-_ ]vision|deep[-_ ]learning|detection|segmentazione|segmentation)/iu.test(chunk.path) || /\b(?:detectron2|defaultpredictor|pred_masks|instances|mrcnn|mask\s*r\s*-?\s*cnn)\b/iu.test(chunk.text)) ? 0.16 : 0;
      const citation = `${chunk.path}${chunk.page ? ` (pagina ${chunk.page})` : ""}:${chunk.startLine}-${chunk.endLine}${chunk.lineKind === "extracted" ? " (testo estratto)" : ""}`;
      return { ...source, text: focused, lexicalScore, cosineScore, entityMatch, roleEvidence, rankLine, score: 0.45 * lexicalScore + 0.55 * Math.max(0, cosineScore) + (description ? 0.25 : 0) + (roleEvidence ? 0.65 : 0) + profileBoost + overviewBoost + maskRcnnBoost + window.coverage * 0.15 + feedbackBoost(learnedFeedback, query, citation), citation };
    }).filter(hit => hit.entityMatch && (hit.lexicalScore > 0 || hit.cosineScore > 0.25)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const selected: typeof ranked = [];
    if (roleQuestion) {
      const sections = new Set<string>();
      for (const hit of ranked.filter(item => item.roleEvidence)) {
        const section = `${hit.path}:${Math.floor(hit.rankLine / 180)}`;
        if (!sections.has(section)) { selected.push(hit); sections.add(section); }
        if (selected.length === 3) break;
      }
    }
    if (identityQuestion) {
      // One strong passage per distant section gives long books broad coverage
      // instead of returning five near-duplicate scenes from the same chapter.
      const sections = new Set<string>();
      for (const hit of ranked) {
        const section = `${hit.path}:${Math.floor(hit.rankLine / 250)}`;
        if (!sections.has(section)) { selected.push(hit); sections.add(section); }
        if (selected.length === 5) break;
      }
    }
    for (const hit of ranked) {
      if (selected.length === 5) break;
      if (!selected.includes(hit)) selected.push(hit);
    }
    return selected.map(({ entityMatch: _entityMatch, roleEvidence: _roleEvidence, rankLine: _rankLine, ...hit }) => hit);
  }

  async function importBrainRepository(input: string): Promise<{ path: string; url: string; branch: string; commit: string }> {
    const url = validateBrainRepositoryUrl(input);
    if (indexing || importing) throw new Error("Operazione brain gia in corso.");
    importing = true;
    const projects = path.join(root, "progetti");
    const repo = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "repository";
    const destination = path.join(projects, repo.replace(/\.git$/, ""));
    const staging = path.join(projects, `.import-${randomUUID()}`);
    const isolated = path.join(staging, "config");
    const checkout = path.join(staging, "repo");
    try {
      progress = { phase: "scanning", completed: 0, total: 0, current: `Importazione GitHub: ${repo}` };
      await noLinks(projects); await noLinks(destination);
      await fs.mkdir(projects, { recursive: true });
      try {
        await fs.lstat(destination);
        progress = { phase: "complete", completed: 1, total: 1, current: `Repository già presente, saltato: ${repo}` };
        return { path: path.relative(root, destination).split(path.sep).join("/"), url, branch: "existing", commit: "existing" };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await fs.mkdir(isolated, { recursive: true });
      // Never inherit Git config, credential helpers, hooks, filters, or an interactive prompt.
      const env: NodeJS.ProcessEnv = {};
      for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key];
      Object.assign(env, { HOME: isolated, USERPROFILE: isolated, XDG_CONFIG_HOME: isolated, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(isolated, "absent"), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_LFS_SKIP_SMUDGE: "1" });
      const args = ["-c", "credential.helper=", "-c", "core.hooksPath=" + isolated, "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "http.followRedirects=false", "-c", "core.autocrlf=false"];
      await run("git", [...args, "clone", "--depth=1", "--single-branch", "--no-tags", "--template=" + isolated, "--", url, checkout], { shell: false, timeout: 120_000, maxBuffer: 1024 * 1024, env, windowsHide: true });
      const commit = (await run("git", ["-C", checkout, "rev-parse", "HEAD"], { shell: false, timeout: 10_000, env })).stdout.trim();
      const branch = (await run("git", ["-C", checkout, "symbolic-ref", "--short", "HEAD"], { shell: false, timeout: 10_000, env })).stdout.trim();
      await fs.rename(checkout, destination);
      progress = { phase: "complete", completed: 1, total: 1, current: `Repository importato: ${repo}` };
      return { path: path.relative(root, destination).split(path.sep).join("/"), url, branch, commit };
    } finally {
      importing = false;
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
  // Quando una domanda su un nome non trova nulla, propone i termini
  // indicizzati più vicini (refusi come "albiter" -> "Arbiter").
  async function suggestCorrection(query: string): Promise<string[]> {
    const stopWords = new Set(["chi", "cosa", "che", "come", "dove", "quando", "quale", "quali", "quanto", "quanta", "quanti", "quante", "e", "ed", "è", "sia", "essere", "sono", "ha", "hai", "ho", "un", "una", "uno", "il", "lo", "la", "i", "gli", "le", "di", "del", "della", "dei", "delle", "al", "allo", "alla", "ai", "agli", "alle", "dal", "dallo", "dalla", "dai", "dagli", "dalle", "nel", "nella", "nei", "nelle", "sul", "sulla", "sui", "sulle", "per", "con", "come", "non", "nome", "persona", "personaggio"]);
    const terms = [...new Set(tokens(query).filter((term) => !stopWords.has(term) && term.length >= 4))];
    if (!terms.length) return [];
    const index = await load();
    const vocab = new Set<string>();
    for (const file of Object.values(index.files)) {
      for (const chunk of file.chunks) {
        for (const word of tokens(`${chunk.path} ${chunk.text}`)) {
          if (word.length >= 4) vocab.add(word);
        }
      }
    }
    const suggestions: string[] = [];
    for (const term of terms) {
      let best = "";
      let bestDistance = 3;
      for (const word of vocab) {
        if (word === term) { best = ""; break; }
        if (Math.abs(word.length - term.length) > 2) continue;
        const distance = editDistance(term, word);
        if (distance < bestDistance) { bestDistance = distance; best = word; }
      }
      if (best) suggestions.push(best.charAt(0).toLocaleUpperCase("it") + best.slice(1));
      if (suggestions.length >= 3) break;
    }
    return [...new Set(suggestions)];
  }
  return { getBrainStatus, diagnose, getBrainGraph, indexBrain, searchBrain, suggestCorrection, importBrainRepository, rebuildTurboIndex, recordBrainFeedback };
}

function editDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = current;
    }
  }
  return previous[b.length];
}

const brain = createBrain();
export const { getBrainStatus, getBrainGraph, indexBrain, searchBrain, importBrainRepository, rebuildTurboIndex, recordBrainFeedback } = brain;
