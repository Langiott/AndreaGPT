/**
 * Accesso sicuro ai file del progetto per l'Agente: lettura, ricerca, diff, scritture con backup e annullamento.
 * Blocca segreti, cartelle generate, collegamenti simbolici e scritture fuori dalle cartelle consentite.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

/** Errore con stato HTTP suggerito (400 input, 403 vietato, 404 assente, 409 conflitto). */
export class AgentError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// Segmenti mai leggibili né scrivibili: file nascosti, cartelle generate, segreti.
export const FORBIDDEN_SEGMENT = /^(?:\..*|node_modules|dist|build|coverage|runtime|data|__pycache__)$|(?:secret|credential|password|token|private[-_]?key)|\.(?:pem|key|p12|pfx)$/i;
const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|7z|rar|exe|dll|so|dylib|bin|onnx|pt|pth|safetensors|gguf|sqlite3?|db|woff2?|ttf|otf|mp[34]|wav|webm|mov|avi|pyc|class|jar|lock)$/i;
const MAX_TEXT = 512 * 1024;
const MAX_WRITE = 200 * 1024;
const MAX_DIFF = 100_000;

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** Converte un percorso relativo in segmenti validati. Con allowRoot "", "." indicano la radice. */
export function parseRelative(input: unknown, allowRoot = false): string[] {
  if (typeof input !== "string") throw new AgentError("Percorso mancante.");
  let value = input.trim().replace(/\\/g, "/");
  if (allowRoot && (value === "" || value === "." || value === "./")) return [];
  if (!value) throw new AgentError("Percorso vuoto.");
  if (value.length > 500 || value.includes("\0") || value.includes(":") || value.startsWith("/") || path.isAbsolute(value) || path.win32.isAbsolute(value))
    throw new AgentError("Percorso assoluto non consentito: usa un percorso relativo alla radice del progetto.", 403);
  value = value.replace(/^\.\/+/, "").replace(/\/+$/, "");
  const parts = value.split("/");
  for (const part of parts) {
    if (!part) throw new AgentError("Percorso con segmenti vuoti.");
    if (part === "." || part === "..") throw new AgentError("Percorso con \"..\" non consentito.", 403);
    // Nomi brevi 8.3 di Windows e punti/spazi finali aggirerebbero i controlli sui nomi.
    if (FORBIDDEN_SEGMENT.test(part) || /~\d/.test(part) || /[. ]$/.test(part)) throw new AgentError(`Percorso non consentito: ${part}`, 403);
  }
  return parts;
}

/** true se il file sta dentro una delle cartelle scrivibili (confronto per segmenti). */
export function insideWritable(parts: string[], writable: string[]) {
  return writable.some(entry => { const w = entry.split("/"); return parts.length > w.length && w.every((s, i) => parts[i] === s); });
}

const isBinary = (data: Buffer) => data.subarray(0, 8000).includes(0);
const splitLines = (text: string) => { if (!text) return []; const lines = text.replace(/\r\n/g, "\n").split("\n"); if (lines.at(-1) === "") lines.pop(); return lines; };

type Op = { t: " " | "-" | "+"; l: string };
function middleOps(a: string[], b: string[]): Op[] {
  // Oltre ~4M celle niente LCS: tutto rimosso e poi tutto aggiunto.
  if (a.length * b.length > 4_000_000) return [...a.map(l => ({ t: "-" as const, l })), ...b.map(l => ({ t: "+" as const, l }))];
  const w = b.length + 1, dp = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ t: " ", l: a[i] }); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ t: "-", l: a[i++] });
    else ops.push({ t: "+", l: b[j++] });
  }
  while (i < a.length) ops.push({ t: "-", l: a[i++] });
  while (j < b.length) ops.push({ t: "+", l: b[j++] });
  return ops;
}

/** Diff unificato a righe con 3 righe di contesto e intestazioni "@@ -a,b +c,d @@". */
export function unifiedDiff(before: string, after: string, context = 3) {
  const a = splitLines(before), b = splitLines(after);
  let pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const ops: Op[] = [...a.slice(0, pre).map(l => ({ t: " " as const, l })), ...middleOps(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf)), ...a.slice(a.length - suf).map(l => ({ t: " " as const, l }))];
  const changes = ops.flatMap((op, i) => op.t === " " ? [] : [i]);
  if (!changes.length) return "";
  const groups: number[][] = [];
  for (const i of changes) { const last = groups.at(-1); if (last && i - last[1] <= 2 * context) last[1] = i; else groups.push([i, i]); }
  // Righe vecchie/nuove prima di ogni posizione.
  const oldBefore = [0], newBefore = [0];
  ops.forEach((op, i) => { oldBefore[i + 1] = oldBefore[i] + (op.t !== "+" ? 1 : 0); newBefore[i + 1] = newBefore[i] + (op.t !== "-" ? 1 : 0); });
  const out: string[] = [];
  for (const [first, last] of groups) {
    const s = Math.max(0, first - context), e = Math.min(ops.length, last + context + 1);
    const oldLen = oldBefore[e] - oldBefore[s], newLen = newBefore[e] - newBefore[s];
    out.push(`@@ -${oldLen ? oldBefore[s] + 1 : oldBefore[s]},${oldLen} +${newLen ? newBefore[s] + 1 : newBefore[s]},${newLen} @@`);
    for (let i = s; i < e; i++) out.push(ops[i].t + ops[i].l);
  }
  const diff = out.join("\n");
  return diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n@@ diff troncato @@` : diff;
}

/** Scrittura atomica: file temporaneo nella stessa cartella e rinomina. */
async function atomicWrite(target: string, data: string | Buffer) {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.agent-${randomBytes(4).toString("hex")}.tmp`);
  try { await fs.writeFile(temp, data, { flag: "wx" }); await fs.rename(temp, target); }
  catch (error) { await fs.rm(temp, { force: true }); throw error; }
}

export interface PreparedWrite { file: string; kind: "edit" | "create"; diff: string; apply(): Promise<{ backupId: string }> }
interface BackupMeta { file: string; kind: "edit" | "create"; createdAt: string; originalHash?: string; writtenHash: string; createdDir?: string; undoneAt?: string }

export class AgentWorkspace {
  readonly root: string;
  readonly writable: string[];
  readonly toolsRoot: string;
  private signal?: AbortSignal;
  constructor(root: string, options: { toolsRoot: string; writable: string[]; signal?: AbortSignal }) {
    this.root = path.resolve(root); this.toolsRoot = options.toolsRoot; this.writable = options.writable; this.signal = options.signal;
  }
  get backupsRoot() { return path.join(this.toolsRoot, "agent", "backups"); }

  /** Valida il percorso e controlla ogni componente: niente collegamenti simbolici o junction. */
  async resolve(relative: unknown, allowRoot = false) {
    this.signal?.throwIfAborted();
    const parts = parseRelative(relative, allowRoot);
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw new AgentError("Radice del progetto simbolica non consentita.", 403);
    let current = this.root, missing = -1;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new AgentError("Collegamenti simbolici non consentiti.", 403); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { missing = index; break; } throw error; }
    }
    // missing = indice del primo segmento inesistente (-1 se il percorso esiste).
    return { parts, rel: parts.join("/"), abs: path.join(this.root, ...parts), exists: missing < 0, missing };
  }

  private async readText(relative: unknown) {
    const target = await this.resolve(relative);
    if (!target.exists) throw new AgentError(`File inesistente: ${target.rel}`, 404);
    const info = await fs.stat(target.abs);
    if (!info.isFile()) throw new AgentError(`Non è un file: ${target.rel}`);
    if (info.size > MAX_TEXT) throw new AgentError(`File troppo grande (${Math.round(info.size / 1024)} KB, massimo 512 KB).`);
    const data = await fs.readFile(target.abs);
    if (BINARY_EXT.test(target.rel) || isBinary(data)) throw new AgentError(`File binario: ${target.rel}`);
    return { ...target, data, text: data.toString("utf8") };
  }

  /** Albero delle voci consentite fino a profondità 3, massimo 300 voci. */
  async listDir(dir: unknown = "", depth = 2) {
    const target = await this.resolve(dir, true);
    if (!target.exists || !(await fs.stat(target.abs)).isDirectory()) throw new AgentError(`Cartella inesistente: ${target.rel || "."}`, 404);
    const lines: string[] = []; let truncated = false;
    const walk = async (abs: string, level: number) => {
      this.signal?.throwIfAborted();
      const entries = (await fs.readdir(abs, { withFileTypes: true }))
        .filter(e => !FORBIDDEN_SEGMENT.test(e.name) && !e.isSymbolicLink() && (e.isDirectory() || e.isFile()))
        .sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name));
      for (const entry of entries) {
        if (lines.length >= 300) { truncated = true; return; }
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) { lines.push(`${"  ".repeat(level)}${entry.name}/`); if (level + 1 < depth) await walk(full, level + 1); }
        else { const size = (await fs.stat(full)).size; lines.push(`${"  ".repeat(level)}${entry.name} (${size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`})`); }
      }
    };
    await walk(target.abs, 0);
    return { dir: target.rel || ".", entries: lines.length, truncated, tree: lines.join("\n") || "(vuota)" };
  }

  /** Cerca testo (o regex) nei file di testo consentiti; le definizioni compaiono per prime. */
  async searchText(query: string, dir: unknown = "", regex = false) {
    if (!query || query.length > 200) throw new AgentError("Query vuota o più lunga di 200 caratteri.");
    let pattern: RegExp | undefined;
    if (regex) { try { pattern = new RegExp(query, "i"); } catch { throw new AgentError("Espressione regolare non valida."); } }
    const needle = query.toLowerCase();
    const match = (line: string) => pattern ? pattern.test(line) : line.toLowerCase().includes(needle);
    const definition = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|def|interface|type|enum|const|let)\s+([\w$]+)/;
    const target = await this.resolve(dir, true);
    if (!target.exists) throw new AgentError(`Cartella inesistente: ${target.rel || "."}`, 404);
    const hits: Array<{ file: string; line: number; text: string; definition?: boolean }> = [];
    let files = 0, truncated = false;
    const scan = async (abs: string, rel: string) => {
      if (BINARY_EXT.test(rel)) return;
      const info = await fs.stat(abs); if (info.size > MAX_TEXT) return;
      const data = await fs.readFile(abs); if (isBinary(data)) return;
      files++;
      splitLines(data.toString("utf8")).forEach((line, i) => {
        if (!match(line)) return;
        const name = line.match(definition)?.[1];
        hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 200), ...(name && (pattern ? pattern.test(name) : name.toLowerCase().includes(needle)) ? { definition: true } : {}) });
      });
    };
    const walk = async (abs: string, rel: string, level: number): Promise<void> => {
      this.signal?.throwIfAborted();
      if (level > 12 || files >= 3000) { truncated = true; return; }
      for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
        if (FORBIDDEN_SEGMENT.test(entry.name) || entry.isSymbolicLink()) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(abs, entry.name), childRel, level + 1);
        else if (entry.isFile()) await scan(path.join(abs, entry.name), childRel);
        if (hits.length > 400) { truncated = true; return; }
      }
    };
    if ((await fs.stat(target.abs)).isDirectory()) await walk(target.abs, target.rel, 0);
    else await scan(target.abs, target.rel);
    const sorted = [...hits.filter(h => h.definition), ...hits.filter(h => !h.definition)];
    return { query, dir: target.rel || ".", filesScanned: files, total: hits.length, truncated: truncated || hits.length > 40, hits: sorted.slice(0, 40) };
  }

  /** Legge al massimo 200 righe numerate, con hash sha256 e numero totale di righe. */
  async readFile(file: unknown, startLine = 1, endLine?: number) {
    const { rel, data, text } = await this.readText(file);
    const lines = splitLines(text);
    const start = Math.max(1, Math.floor(startLine));
    const end = Math.min(lines.length, start + 199, Math.max(start, Math.floor(endLine ?? start + 199)));
    return { file: rel, startLine: start, endLine: end, totalLines: lines.length, hash: sha256(data),
      text: lines.slice(start - 1, end).map((line, i) => `${start + i}: ${line}`).join("\n").slice(0, 40_000) };
  }

  private checkWritable(parts: string[], rel: string) {
    if (!insideWritable(parts, this.writable)) throw new AgentError(`Scrittura non consentita in ${rel}: cartelle scrivibili ${this.writable.join(", ") || "nessuna"}.`, 403);
  }

  /** Prepara la sostituzione di un testo che compare una sola volta. Non scrive finché apply() non viene chiamato. */
  async prepareEdit(file: unknown, oldText: string, newText: string): Promise<PreparedWrite> {
    const target = await this.resolve(file);
    this.checkWritable(target.parts, target.rel);
    const { data, text } = await this.readText(file);
    const crlf = text.includes("\r\n");
    const lf = crlf ? text.replace(/\r\n/g, "\n") : text;
    const before = oldText.replace(/\r\n/g, "\n"), after = newText.replace(/\r\n/g, "\n");
    if (!before) throw new AgentError("old_text vuoto.");
    if (before === after) throw new AgentError("old_text e new_text sono identici.");
    const count = lf.split(before).length - 1;
    if (count === 0) throw new AgentError("old_text non trovato nel file: rileggi il file e copia il testo esatto.");
    if (count > 1) throw new AgentError(`old_text compare ${count} volte: aggiungi righe di contesto per renderlo unico.`);
    const index = lf.indexOf(before);
    const resultLf = lf.slice(0, index) + after + lf.slice(index + before.length);
    const result = crlf ? resultLf.replace(/\n/g, "\r\n") : resultLf;
    if (Buffer.byteLength(result) > MAX_WRITE) throw new AgentError("Il file risultante supera 200 KB.");
    const originalHash = sha256(data);
    return { file: target.rel, kind: "edit", diff: unifiedDiff(lf, resultLf), apply: async () => {
      const again = await this.resolve(target.rel);
      const current = again.exists ? await fs.readFile(again.abs) : null;
      if (!current || sha256(current) !== originalHash) throw new AgentError("Il file è cambiato dopo la proposta: modifica non applicata.", 409);
      const backupId = await this.backup({ file: target.rel, kind: "edit", createdAt: new Date().toISOString(), originalHash, writtenHash: sha256(result) }, current);
      await atomicWrite(again.abs, result);
      return { backupId };
    } };
  }

  /** Prepara un file nuovo: non deve esistere e deve stare in una cartella scrivibile. */
  async prepareCreate(file: unknown, content: string): Promise<PreparedWrite> {
    const target = await this.resolve(file);
    this.checkWritable(target.parts, target.rel);
    if (target.exists) throw new AgentError(`Il file esiste già: ${target.rel}. Usa edit_file.`, 409);
    if (Buffer.byteLength(content) > MAX_WRITE) throw new AgentError("Contenuto oltre 200 KB.");
    return { file: target.rel, kind: "create", diff: unifiedDiff("", content), apply: async () => {
      const again = await this.resolve(target.rel);
      if (again.exists) throw new AgentError("Il file è stato creato nel frattempo: non sovrascritto.", 409);
      const createdDir = again.missing >= 0 && again.missing < again.parts.length - 1 ? again.parts.slice(0, again.missing + 1).join("/") : undefined;
      await fs.mkdir(path.dirname(again.abs), { recursive: true });
      await this.resolve(target.rel); // ricontrolla i collegamenti dopo la creazione delle cartelle
      const backupId = await this.backup({ file: target.rel, kind: "create", createdAt: new Date().toISOString(), writtenHash: sha256(content),
        ...(createdDir ? { createdDir } : {}) });
      await atomicWrite(again.abs, content);
      return { backupId };
    } };
  }

  private async backup(meta: BackupMeta, original?: Buffer) {
    const backupId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const dir = path.join(this.backupsRoot, backupId);
    await fs.mkdir(dir, { recursive: true });
    if (original) await fs.writeFile(path.join(dir, "original"), original);
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
    return backupId;
  }

  /** Annulla una scrittura: ripristina l'originale o elimina il file creato, solo se il file è ancora quello scritto dall'agente. */
  async undo(backupId: unknown) {
    if (typeof backupId !== "string" || !/^\d{13}-[0-9a-f]{8}$/.test(backupId)) throw new AgentError("Backup non valido.");
    const dir = path.join(this.backupsRoot, backupId);
    let meta: BackupMeta;
    try { meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")); }
    catch { throw new AgentError("Backup inesistente.", 404); }
    if (meta.undoneAt) throw new AgentError("Modifica già annullata.", 409);
    const target = await this.resolve(meta.file);
    const current = target.exists ? sha256(await fs.readFile(target.abs)) : null;
    if (current !== meta.writtenHash) throw new AgentError("Il file è cambiato dopo la modifica dell'agente: annullamento rifiutato.", 409);
    if (meta.kind === "edit") await atomicWrite(target.abs, await fs.readFile(path.join(dir, "original")));
    else {
      await fs.rm(target.abs);
      // Rimuove le cartelle create per il file, se ora vuote.
      if (meta.createdDir) {
        const stop = path.join(this.root, ...parseRelative(meta.createdDir));
        for (let current = path.dirname(target.abs); current.length >= stop.length && current.startsWith(stop); current = path.dirname(current)) {
          try { await fs.rmdir(current); } catch { break; }
        }
      }
    }
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify({ ...meta, undoneAt: new Date().toISOString() }, null, 2));
    return { file: meta.file };
  }
}
