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
const BATCH_SIZE = 8;
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
  const dataDir = path.resolve(options.dataDir ?? process.env.BRAIN_DATA_DIR ?? path.join(workspace, "data/brain"));
  const indexPath = path.join(dataDir, "index.json");
  const ollama = new URL(localOllamaUrl(options.ollamaUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"));
  let indexing = false;
  let importing = false;
  let progress: BrainStatus["progress"];
  const empty = (): BrainIndex => ({ version: VERSION, model: MODEL, updatedAt: null, files: {}, errors: [] });
  let cachedIndex: { stamp: string; value: BrainIndex } | undefined;
  const lexicalCache = new WeakMap<BrainIndex, Map<string, { chunk: StoredChunk; words: string[]; body: Set<string>; counts: Map<string, number> }[]>>();
  const noiseFile = (name: string) => /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock)$/i.test(name);

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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }

  async function embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const batch = texts.slice(offset, offset + BATCH_SIZE);
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
      vectors.push(...values);
    }
    if (vectors.some(v => v.length !== vectors[0].length)) throw new Error("Dimensioni embedding incoerenti.");
    return vectors;
  }

  function status(index: BrainIndex): BrainStatus {
    return { sources: Object.entries(index.files).map(([id, file]) => ({ id, chunks: file.chunks.length })), root, indexPath, model: MODEL, indexedAt: index.updatedAt, files: Object.keys(index.files).length, chunks: Object.values(index.files).reduce((sum, file) => sum + file.chunks.length, 0), indexing, errors: index.errors, progress };
  }

  async function getBrainStatus() { return status(await load()); }

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
      await fs.rename(temporary, indexPath);
      cachedIndex = undefined;
      progress = { phase: "complete", completed: all.length, total: all.length };
      return { ...status(next), indexing: false };
    } finally {
      indexing = false;
      await fs.rm(temporary, { force: true });
      if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }); }
    }
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
      entries = Object.values(index.files).flatMap(file => file.chunks)
        .filter(chunk => !noiseFile(chunk.path) && (!filter || chunk.path === filter || chunk.path.startsWith(`${filter}/`)))
        .map(chunk => {
          const words = tokens(`${chunk.path} ${chunk.section ?? ""} ${chunk.text}`);
          const counts = new Map<string, number>();
          for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
          return { chunk, words, counts, body: new Set(tokens(chunk.text)) };
        });
      if (prepared.size >= 8) prepared.clear();
      prepared.set(key, entries);
    }
    const chunks = entries.map(entry => entry.chunk);
    if (!chunks.length) return [];
    // Anche le ricerche telegrafiche ("chi Nova?") sono domande biografiche.
    const identityQuestion = /^\s*chi\b(?:\s+(?:e|è|sia))?[\s:,-]+\S/iu.test(query);
    const stopWords = new Set(["chi", "cosa", "che", "come", "dove", "quando", "quale", "quali", "sono", "essere", "sia", "ha", "hai", "ho", "un", "una", "uno", "il", "lo", "la", "i", "gli", "le", "di", "del", "della", "dei", "delle", "nel", "nella", "nei", "nelle", "per", "progetto", "progetti", "usato", "usata", "utilizzato", "utilizzata", "esiste", "creare", "trova", "trovami", "scrivi", "scrivimi", "codice", "modello"]);
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
      : query;
    const overviewQuestion = /\b(?:riassum|panoramica|in generale|parla di|contiene|quali progetti|che progetti|cosa ho fatto|come ho usato|come ho utilizzato|come ho realizzato|come ho creato|come ho costruito|nel mio progetto)\b/iu.test(query);
    const [vector] = await embed([`search_query: ${semanticQuery}`]);
    const documentTokens = entries.map(entry => entry.words);
    const documents = entries.map(entry => entry.counts);
    const averageLength = documentTokens.reduce((sum, words) => sum + words.length, 0) / documentTokens.length || 1;
    const weights = terms.map(term => Math.log(1 + (chunks.length - documents.filter(doc => doc.has(term)).length + 0.5) / (documents.filter(doc => doc.has(term)).length + 0.5)));
    const ranked = chunks.map((chunk, i) => {
      const bm25 = terms.reduce((sum, term, j) => {
        const frequency = documents[i].get(term) ?? 0;
        if (!frequency) return sum;
        const saturation = frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * documentTokens[i].length / averageLength));
        return sum + weights[j] * saturation;
      }, 0);
      const lexicalScore = bm25 / (1 + bm25);
      const cosineScore = cosine(vector, chunk.embedding);
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
      const entityPosition = identityQuestion ? Math.min(...identityTerms.map(term => chunk.text.toLocaleLowerCase("it").indexOf(term)).filter(position => position >= 0)) : 0;
      const rankLine = chunk.startLine + (entityPosition > 0 ? (chunk.text.slice(0, entityPosition).match(/\n/g) ?? []).length : 0);
      const profileFacts = identityQuestion ? new Set(focused.toLocaleLowerCase("it").match(/\b(?:protagonista|amic[oa]|riparator\w*|medic\w*|biolog\w*|coltivator\w*|ingegner\w*|scienziat\w*|pilot\w*|principessa|principe|orfan[oa]|lavora|professione|ruolo)\b/giu) ?? []).size : 0;
      const profileBoost = Math.min(0.40, profileFacts * 0.10);
      const overviewRelevant = terms.length === 0 || terms.some(term => entries![i].body.has(term));
      const overviewBoost = overviewQuestion && chunk.kind === "overview" && overviewRelevant ? 0.12 : 0;
      const maskRcnnBoost = maskRcnnIntent && (/(?:computer[-_ ]vision|deep[-_ ]learning|detection|segmentazione|segmentation)/iu.test(chunk.path) || /\b(?:detectron2|defaultpredictor|pred_masks|instances|mrcnn|mask\s*r\s*-?\s*cnn)\b/iu.test(chunk.text)) ? 0.16 : 0;
      return { ...source, text: focused, lexicalScore, cosineScore, entityMatch, rankLine, score: 0.45 * lexicalScore + 0.55 * Math.max(0, cosineScore) + (description ? 0.25 : 0) + profileBoost + overviewBoost + maskRcnnBoost + window.coverage * 0.15, citation: `${chunk.path}${chunk.page ? ` (pagina ${chunk.page})` : ""}:${chunk.startLine}-${chunk.endLine}${chunk.lineKind === "extracted" ? " (testo estratto)" : ""}` };
    }).filter(hit => hit.entityMatch && (hit.lexicalScore > 0 || hit.cosineScore > 0.25)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const selected: typeof ranked = [];
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
    return selected.map(({ entityMatch: _entityMatch, rankLine: _rankLine, ...hit }) => hit);
  }

  async function importBrainRepository(input: string): Promise<{ path: string; url: string; branch: string; commit: string }> {
    const url = validateBrainRepositoryUrl(input);
    if (indexing || importing) throw new Error("Operazione brain gia in corso.");
    importing = true;
    const projects = path.join(root, "progetti");
    const [, owner, repo] = new URL(url).pathname.split("/");
    const destination = path.join(projects, `${owner}--${repo.replace(/\.git$/, "")}`);
    const staging = path.join(projects, `.import-${randomUUID()}`);
    const isolated = path.join(staging, "config");
    const checkout = path.join(staging, "repo");
    try {
      await noLinks(projects); await noLinks(destination);
      await fs.mkdir(projects, { recursive: true });
      try { await fs.lstat(destination); throw new Error("Repository gia presente; import non sovrascrive file."); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
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
  return { getBrainStatus, indexBrain, searchBrain, suggestCorrection, importBrainRepository };
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
export const { getBrainStatus, indexBrain, searchBrain, importBrainRepository } = brain;
