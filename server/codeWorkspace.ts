import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const supported = /\.(?:tsx?|jsx?|mjs|cjs|py)$/i;
const exec = promisify(execFile);
const excluded = /^(?:\..*|node_modules|dist|build|coverage|vendor|runtime|data|secrets?|credentials?)$|(?:secret|credential|password|token|private[-_]?key)|\.(?:pem|key|p12|pfx)$/i;
export interface CodeSymbol { name: string; kind: string; startLine: number; endLine: number; signature: string; references: string[] }
export function parseCode(file: string, text: string) {
  const source = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const symbols: CodeSymbol[] = [], imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))) {
      const refs = new Set<string>();
      const collect = (child: ts.Node) => { if (ts.isCallExpression(child)) refs.add(child.expression.getText(source)); ts.forEachChild(child,collect); };
      collect(node);
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      symbols.push({name:node.name?.getText(source) ?? "default",kind:ts.SyntaxKind[node.kind],startLine:start,
        endLine:source.getLineAndCharacterOfPosition(node.end).line+1,signature:node.getText(source).split(/\r?\n/)[0].slice(0,300),references:[...refs].slice(0,100)});
    }
    ts.forEachChild(node,visit);
  };
  visit(source);
  return {symbols,imports};
}

export class CodeWorkspace {
  private cache = new Map<string,{ stamp:string; parsed:ReturnType<typeof parseCode> }>();
  readonly warnings:string[]=[];
  constructor(readonly root: string, private signal?:AbortSignal) {}
  private async resolve(relative: string) {
    this.signal?.throwIfAborted();
    if (!relative || path.isAbsolute(relative) || relative.includes(":")) throw new Error("Percorso relativo richiesto.");
    const parts = relative.replace(/\\/g,"/").split("/");
    if (parts.some(part => !part || part === ".." || part === "." || excluded.test(part))) throw new Error("Percorso non consentito.");
    const root = path.resolve(this.root);
    // Check the root and every component, including Windows junctions.
    let current = path.parse(root).root;
    for (const part of [...root.slice(current.length).split(path.sep).filter(Boolean), ...parts]) {
      current = path.join(current,part);
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Collegamenti simbolici non consentiti.");
    }
    if (!supported.test(current)) throw new Error("Sono supportati sorgenti TypeScript, JavaScript e Python.");
    const info=await fs.stat(current);
    if (!info.isFile() || info.size>512*1024) throw new Error("File non valido o maggiore di 512 KiB.");
    return current;
  }
  async read(file: string, startLine=1, endLine=160) {
    const absolute=await this.resolve(file);
    const text=await fs.readFile(absolute,"utf8");
    const lines=text.split(/\r?\n/);
    const start=Math.max(1,Math.floor(startLine));
    const end=Math.min(lines.length,start+199,Math.max(start,Math.floor(endLine)));
    return {file,startLine:start,endLine:end,hash:createHash("sha256").update(text).digest("hex"),text:lines.slice(start-1,end).map((line,i)=>`${start+i}: ${line}`).join("\n").slice(0,16000)};
  }
  async catalog() {
    const files:string[]=[];
    const walk=async (dir:string,depth:number):Promise<void> => {
      this.signal?.throwIfAborted();
      if (depth>12 || files.length>=2000) return;
      for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
        if(excluded.test(entry.name)||entry.isSymbolicLink())continue;
        const full=path.join(dir,entry.name);
        if(entry.isDirectory())await walk(full,depth+1);
        else if(supported.test(entry.name)&&files.length<2000)files.push(path.relative(this.root,full).split(path.sep).join("/"));
      }
    };
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw new Error("Workspace simbolico non consentito.");
    await walk(this.root,0);
    const result=[];
    for(const file of files) {
      const absolute=await this.resolve(file);
      const info=await fs.stat(absolute); const stamp=`${info.mtimeMs}:${info.size}`;
      let cached=this.cache.get(file);
      if(cached?.stamp!==stamp) {
        let parsed:ReturnType<typeof parseCode>;
        if(file.endsWith(".py")) {
          try {
            const result=await exec(process.env.DOCTR_PYTHON||"python",["-I",fileURLToPath(new URL("./code_symbols.py",import.meta.url)),absolute],{windowsHide:true,shell:false,timeout:5000,maxBuffer:256000,signal:this.signal});
            parsed=JSON.parse(result.stdout);
          } catch { this.signal?.throwIfAborted();this.warnings.push(`AST Python non disponibile per ${file}`);parsed={symbols:[],imports:[]}; }
        } else parsed=parseCode(file,await fs.readFile(absolute,"utf8"));
        cached={stamp,parsed};this.cache.set(file,cached);
      }
      result.push({file,...cached.parsed});
    }
    for(const key of this.cache.keys())if(!files.includes(key))this.cache.delete(key);
    return result;
  }
  async search(query:string) {
    const terms=query.toLowerCase().split(/\W+/).filter(Boolean);
    if(!terms.length)return [];
    return (await this.catalog()).flatMap(file=>file.symbols.map(symbol=>({file:file.file,...symbol,
      score:terms.reduce((score,term)=>score+(symbol.name.toLowerCase()===term?10:symbol.name.toLowerCase().includes(term)?4:file.file.toLowerCase().includes(term)?1:0),0)})))
      .filter(hit=>hit.score>0).sort((a,b)=>b.score-a.score).slice(0,20);
  }
  async references(symbol:string) {
    return (await this.catalog()).flatMap(file=>file.symbols.filter(item=>item.references.some(ref=>ref===symbol||ref.endsWith(`.${symbol}`))).map(item=>({file:file.file,...item}))).slice(0,30);
  }
  async proposal(file:string,expectedHash:string,before:string,after:string) {
    const absolute=await this.resolve(file); const text=await fs.readFile(absolute,"utf8");
    if(createHash("sha256").update(text).digest("hex")!==expectedHash)throw new Error("File modificato: rileggilo prima di proporre la patch.");
    if(!before||text.split(before).length!==2)throw new Error("Il testo da sostituire deve comparire una sola volta.");
    if(before.length+after.length>16000)throw new Error("Patch troppo grande.");
    return {file,expectedHash,before,after,applied:false};
  }
}
