/**
 * Controlli fissi dell'Agente: sintassi Python, sintassi JavaScript, tipi TypeScript. Nessun comando libero.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import ts from "typescript";
import type { AgentCheckName } from "../../frontend/types/agent";
import { AgentError, type AgentWorkspace } from "./agent_workspace";

export const AGENT_CHECKS: AgentCheckName[] = ["python_syntax", "typescript", "javascript_syntax"];
const MAX_OUTPUT = 4000;
const extensions: Record<AgentCheckName, RegExp> = { python_syntax: /\.py$/i, javascript_syntax: /\.(?:js|mjs|cjs)$/i, typescript: /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/i };
// Solo "file:riga:colonna SyntaxError: messaggio" e la riga, senza il traceback interno di ast.
const PYTHON_AST = [
  "import ast,sys",
  "try: ast.parse(open(sys.argv[1],encoding='utf-8').read(), sys.argv[1])",
  "except SyntaxError as e: print(f'{e.filename}:{e.lineno}:{e.offset} {type(e).__name__}: {e.msg}', (e.text or '').rstrip(), sep='\\n'); sys.exit(1)",
].join("\n");
const truncate = (text: string) => text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… output troncato` : text;

type Result = { ok: boolean; output: string };
function run(command: string, args: string[], signal?: AbortSignal) {
  return new Promise<Result & { missing?: boolean }>(resolve => {
    execFile(command, args, { shell: false, windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024, signal }, (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      // ENOENT o alias di Microsoft Store (9009): interprete assente.
      if (code === "ENOENT" || (error as { code?: unknown } | null)?.code === 9009) { resolve({ ok: false, output: "", missing: true }); return; }
      const killed = (error as { killed?: boolean } | null)?.killed;
      resolve({ ok: !error, output: truncate(killed ? "Tempo massimo di 20 s superato." : `${stderr}${stdout}`.trim()) });
    });
  });
}

function typescriptCheck(abs: string, rel: string, root: string): Result {
  const program = ts.createProgram([abs], { noEmit: true, strict: true, skipLibCheck: true, allowJs: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true });
  const source = program.getSourceFile(abs);
  if (!source) return { ok: false, output: "File non caricato dal compilatore TypeScript." };
  const diagnostics = ts.getPreEmitDiagnostics(program, source);
  const lines = diagnostics.slice(0, 30).map(d => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    if (!d.file || d.start === undefined) return `${rel} TS${d.code} ${message}`;
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    const file = path.relative(root, d.file.fileName).split(path.sep).join("/") || rel;
    return `${file}:${line + 1}:${character + 1} TS${d.code} ${message}`;
  });
  if (diagnostics.length > 30) lines.push(`… altri ${diagnostics.length - 30} errori`);
  return { ok: diagnostics.length === 0, output: truncate(lines.join("\n") || "Nessun errore TypeScript.") };
}

/** Esegue un controllo fisso su un file che rispetta le regole di lettura. */
export async function runCheck(workspace: AgentWorkspace, check: AgentCheckName, file: unknown, signal?: AbortSignal): Promise<Result> {
  if (!AGENT_CHECKS.includes(check)) throw new AgentError("Controllo sconosciuto.");
  const target = await workspace.resolve(file);
  if (!target.exists) throw new AgentError(`File inesistente: ${target.rel}`, 404);
  if (!extensions[check].test(target.rel)) throw new AgentError(`Il controllo ${check} non si applica a ${target.rel}.`);
  if (check === "typescript") return typescriptCheck(target.abs, target.rel, workspace.root);
  // Nei messaggi il percorso assoluto diventa relativo.
  const relative = (output: string) => output.split(target.abs).join(target.rel);
  if (check === "javascript_syntax") {
    const result = await run(process.execPath, ["--check", target.abs], signal);
    return { ok: result.ok, output: relative(result.output) || (result.ok ? "Sintassi JavaScript corretta." : "Errore di sintassi.") };
  }
  const primary = process.env.AGENT_PYTHON || "python3";
  let result = await run(primary, ["-I", "-c", PYTHON_AST, target.abs], signal);
  if (result.missing && primary !== "python") result = await run("python", ["-I", "-c", PYTHON_AST, target.abs], signal);
  if (result.missing) return { ok: false, output: "Python non disponibile sul server." };
  return { ok: result.ok, output: relative(result.output) || (result.ok ? "Sintassi Python corretta." : "Errore di sintassi.") };
}
