import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CodeWorkspace, parseCode } from "./code_workspace";
import { runCodeAgent } from "./code_agent";

test("indice AST distingue commenti, definizioni, import e chiamate",()=>{
  const parsed=parseCode("a.ts",`import {read} from './io';\n// function falsa() {}\nexport function load(x: string) { return read(x); }\nconst next = () => load('a');`);
  assert.deepEqual(parsed.imports,["./io"]);
  assert.deepEqual(parsed.symbols.map(s=>s.name),["load","next"]);
  assert.deepEqual(parsed.symbols[0].references,["read"]);
  assert.equal(parsed.symbols[0].startLine,3);
});

test("workspace aggiorna simboli, blocca traversal e valida patch senza scrivere",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"andreagpt-code-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const original="export function first() { return 1; }";
  await fs.writeFile(path.join(root,"a.ts"),original);
  const workspace=new CodeWorkspace(root);
  assert.equal((await workspace.search("first"))[0].name,"first");
  await assert.rejects(workspace.read("../a.ts"));
  await assert.rejects(workspace.read(".env"));
  const read=await workspace.read("a.ts");
  const patch=await workspace.proposal("a.ts",read.hash,"return 1","return 2");
  assert.equal(patch.applied,false);
  assert.equal(await fs.readFile(path.join(root,"a.ts"),"utf8"),original);
  await fs.writeFile(path.join(root,"a.ts"),"export function second() { return 20; }");
  await assert.rejects(workspace.proposal("a.ts",read.hash,"return 1","return 2"),/modificato/);
  assert.equal((await workspace.search("second"))[0].name,"second");
  assert.deepEqual(await workspace.search("first"),[]);
});

test("agente rifiuta comandi sconosciuti e rispetta budget di iterazioni",async()=>{
  let calls=0;
  const result=await runCodeAgent({question:"analizza",model:"mock",workspace:new CodeWorkspace("."),signal:new AbortController().signal,
    chat:async()=>{calls++;return {message:{tool_calls:[{function:{name:"exec_shell",arguments:{command:"del *"}}}]}};}});
  assert.equal(calls,6);
  assert.equal(result.completed,false);
  assert.ok(result.trace.every(item=>!item.ok));
});

test("agente annullato non chiama il modello",async()=>{
  await assert.rejects(runCodeAgent({question:"x",model:"mock",workspace:new CodeWorkspace("."),signal:AbortSignal.abort(),chat:async()=>{throw new Error("Unexpected model call");}}),/abort/i);
});

test("indice Python legge AST senza eseguire il modulo",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"andreagpt-python-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,"vision.py"),"raise RuntimeError('must not execute')\nimport torch\ndef predict(image):\n    return model(image)\n");
  const workspace=new CodeWorkspace(root);
  const hits=await workspace.search("predict");
  assert.equal(hits[0].name,"predict");assert.equal(hits[0].startLine,3);
  assert.equal((await workspace.references("model"))[0].file,"vision.py");
});
