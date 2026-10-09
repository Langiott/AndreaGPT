/**
 * Albero dei file del progetto con un riassunto di una riga per file.
 * Il riassunto è il commento in testa al file; se manca, i simboli esportati.
 */
import fs from "node:fs/promises";
import path from "node:path";

export interface CodeNode { name: string; path: string; summary?: string; lines?: number; children?: CodeNode[] }

const codeFile = /\.(?:tsx?|jsx?|mjs|cjs|py|ps1|bat|css|ya?ml)$|^Dockerfile$/i;
const skipped = /^(?:\..*|node_modules|dist|build|coverage|runtime|data|__pycache__|ANDREA-BRAIN|OCR|OUTPUT|img|public|DRAW|certs)$|(?:secret|credential|password|token|private[-_]?key)/i;

/** Estrae la prima frase utile dal commento in testa al file. */
export function headerSummary(text: string) {
  const body = text.replace(/^﻿/, "");
  const block = body.match(/^\s*\/\*\*?([\s\S]*?)\*\//)?.[1]
    ?? body.match(/^\s*(?:#![^\n]*\n)?\s*(?:"""|''')([\s\S]*?)(?:"""|''')/)?.[1]
    ?? body.match(/^(?:\s*(?:\/\/|#|::|rem\s)[^\n]*\n)+/i)?.[0];
  const line = block?.split(/\r?\n/).map(row => row.replace(/^\s*(?:\*|\/{2,}|#|::|rem\s)?\s*/i, "").trim()).find(row => row && !/^(?:@|!|<reference|eslint|ts-|type:)/i.test(row));
  if (line) return line.slice(0, 220);
  const exported = [...body.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type)\s+(\w+)/gm)].map(match => match[1]);
  return exported.length ? `Esporta ${exported.slice(0, 6).join(", ")}${exported.length > 6 ? "…" : ""}` : undefined;
}

/** Costruisce l'albero: cartelle prima, poi file; scarta le cartelle senza codice. */
export async function codeTree(root: string, label = path.basename(root)) {
  let count = 0;
  const walk = async (dir: string, depth: number): Promise<CodeNode[]> => {
    if (depth > 10 || count >= 3000) return [];
    const entries = (await fs.readdir(dir, { withFileTypes: true })).filter(entry => !skipped.test(entry.name) && !entry.isSymbolicLink())
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const nodes: CodeNode[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        const children = await walk(full, depth + 1);
        if (children.length) nodes.push({ name: entry.name, path: relative, children });
      } else if (codeFile.test(entry.name) && count < 3000) {
        const info = await fs.stat(full);
        if (info.size > 1024 * 1024) continue;
        const text = await fs.readFile(full, "utf8");
        count++;
        const tested = entry.name.match(/^(.+?)[._]test\.\w+$/)?.[1];
        nodes.push({ name: entry.name, path: relative, summary: headerSummary(text) ?? (tested && `Test di ${tested}`), lines: text.split(/\r?\n/).length });
      }
    }
    return nodes;
  };
  return { root: label, children: await walk(path.resolve(root), 0), files: count };
}
