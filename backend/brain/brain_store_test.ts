/**
 * Verifica la lettura dell'indice SQLite del Brain.
 * Controlla fonti, vettori, filtri e generazioni obsolete.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BrainStore } from "./brain_store";

test("snapshot FTS filtra percorsi, preserva vettori e rifiuta generazioni obsolete",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"andreagpt-store-"));
  const source=path.join(root,"index.json");await fs.writeFile(source,"{}");
  const generation="store-"+"a".repeat(32);await fs.mkdir(path.join(root,generation));
  const db=new DatabaseSync(path.join(root,generation,"brain.sqlite"));
  db.exec("CREATE TABLE chunks(id INTEGER PRIMARY KEY,path TEXT,data TEXT,vector BLOB); CREATE VIRTUAL TABLE passages USING fts5(path,section,text);");
  for(const [id,file] of ["docs/a.ts","docs-other/b.ts"].entries()) {
    db.prepare("INSERT INTO chunks VALUES(?,?,?,?)").run(id,file,JSON.stringify({id:String(id),path:file,text:"retrieval",startLine:1,endLine:1}),new Uint8Array(new Float32Array([1,0]).buffer));
    db.prepare("INSERT INTO passages(rowid,path,section,text) VALUES(?,?,?,?)").run(id,file,"","retrieval");
  }
  db.close();const info=await fs.stat(source);
  await fs.writeFile(path.join(root,"active.json"),JSON.stringify({schema:1,generation,sourceSize:info.size,sourceMtimeMs:info.mtimeMs}));
  const store=new BrainStore(root,source);t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});
  assert.ok(await store.open());assert.equal(store.lexical(["retrieval"],"docs").length,1);
  assert.equal(store.lexical(['" OR * --']).length,0);
  assert.deepEqual(store.allowed("docs"),[0]);assert.deepEqual(store.chunks([0])[0].chunk.embedding,[1,0]);
  await fs.writeFile(source,"{\"updated\":true}");assert.equal(await store.open(),undefined);
});
