/**
 * Legge l'indice SQLite creato dal Brain.
 * Fornisce ricerca lessicale, vettori, fonti e collegamenti tra chunk.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BrainChunk } from "./brain";
import { retrievalTokens } from "../retrieval/retrieval";

export interface StoreManifest {
  schema: number; generation: string; updatedAt: string; model: string;
  sourceSize: number; sourceMtimeMs: number; dimension: number; count: number; files: number;
  errors: Array<{ path: string; error: string }>; variants: Record<string, { bytes: number; variance: number }>; graph: boolean;
}
export class BrainStore {
  private db?: DatabaseSync;
  private generation = "";
  constructor(readonly root: string, readonly source: string) {}
  async open(): Promise<StoreManifest | undefined> {
    try {
      const [raw, source] = await Promise.all([fs.readFile(path.join(this.root, "active.json"), "utf8"), fs.stat(this.source)]);
      const meta = JSON.parse(raw) as StoreManifest;
      if (meta.schema !== 1 || !/^store-[a-f0-9]{32}$/.test(meta.generation) || meta.sourceSize !== source.size || Math.abs(meta.sourceMtimeMs - source.mtimeMs) > 1) return undefined;
      if (this.generation !== meta.generation) {
        this.close();
        this.db = new DatabaseSync(path.join(this.root, meta.generation, "brain.sqlite"), { readOnly: true });
        this.generation = meta.generation;
      }
      return meta;
    } catch { return undefined; }
  }
  close() { this.db?.close(); this.db = undefined; this.generation = ""; }
  files() { return this.db!.prepare("SELECT path AS id,count AS chunks FROM files ORDER BY path").all() as unknown as Array<{ id: string; chunks: number }>; }
  lexical(terms: string[], filter?: string, limit = 96) {
    const query = [...new Set(terms.flatMap(retrievalTokens))].slice(0, 40).map(term => `"${term}"`).join(" OR ");
    if (!query) return [];
    const rows = this.db!.prepare(`SELECT passages.rowid AS id,bm25(passages) AS score FROM passages
      WHERE passages MATCH ? ${filter ? "AND (path = ? OR substr(path,1,?) = ?)" : ""} ORDER BY rank LIMIT ?`)
      .all(query, ...(filter ? [filter, filter.length + 1, `${filter}/`] : []), limit);
    return rows.map(row => ({ id: Number(row.id), score: Math.max(0, -Number(row.score)) }));
  }
  vocabulary() { return this.db!.prepare("SELECT term FROM vocabulary WHERE length(term)>=4").all().map(row => String(row.term)); }
  allowed(filter: string) { return this.db!.prepare("SELECT id FROM chunks WHERE path=? OR substr(path,1,?)=?").all(filter,filter.length+1,`${filter}/`).map(row => Number(row.id)); }
  chunks(ids: number[]) {
    const selected=[...new Set(ids)];
    if(!selected.length)return [];
    const rows=this.db!.prepare(`SELECT id,data,vector FROM chunks WHERE id IN (${selected.map(()=>"?").join(",")})`).all(...selected);
    return rows.map(row => {
      const bytes = row.vector as Uint8Array;
      const vector = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      return { chunk: { ...JSON.parse(String(row.data)) as BrainChunk, embedding: Array.from(vector) }, turboId: Number(row.id) };
    });
  }
  sources(citations: string[]) {
    const result = new Map<string, number[]>();
    for (const citation of citations) {
      const match = /^(.*?)(?: \(pagina \d+\))?:(\d+)-(\d+)/u.exec(citation);
      if (!match) continue;
      const rows = this.db!.prepare("SELECT id FROM chunks WHERE path=? AND json_extract(data,'$.startLine')=? AND json_extract(data,'$.endLine')=?").all(match[1],Number(match[2]),Number(match[3]));
      const found = this.chunks(rows.slice(0,1).map(row => Number(row.id)))[0];
      if (found) result.set(citation,found.chunk.embedding);
    }
    return result;
  }
  edges(ids: number[]) {
    const allowed = new Set(ids);
    const result=new Map<number,Array<{id:number;similarity:number}>>(ids.map(id=>[id,[]]));
    if(!ids.length)return result;
    const rows=this.db!.prepare(`SELECT source,target,similarity FROM edges WHERE source IN (${ids.map(()=>"?").join(",")})`).all(...ids);
    for(const row of rows)if(allowed.has(Number(row.target)))result.get(Number(row.source))!.push({id:Number(row.target),similarity:Number(row.similarity)});
    return result;
  }
}
