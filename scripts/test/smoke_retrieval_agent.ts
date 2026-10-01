import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const reports=[];
for(const test of [
  {name:"retrieval",brain:true,codeAgent:false,question:"Parlami metodi retrival"},
  {name:"code-agent",brain:false,codeAgent:true,question:"Usa search_code per trovare assessSemanticSupport. Rispondi soltanto con file e intervallo di righe, senza leggere altri file."},
]) {
  const start=performance.now();
  const reply=await fetch("http://127.0.0.1:3000/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({conversationId:randomUUID(),provider:"ollama",model:"qwen3:14b",brain:test.brain,codeAgent:test.codeAgent,
      maxTokens:256,numCtx:4096,messages:[{role:"user",content:test.question}]}),signal:AbortSignal.timeout(150000)});
  if(!reply.ok)throw new Error(`${test.name}: HTTP ${reply.status} ${await reply.text()}`);
  const events=(await reply.text()).split("\n").filter(line=>line.startsWith("data: {")).map(line=>JSON.parse(line.slice(6)));
  assert.ok(!events.some(event=>event.error));
  const answer=events.map(event=>event.choices?.[0]?.delta?.content??"").join("");
  const metrics=events.filter(event=>event.metrics).at(-1)?.metrics;
  const sources=events.find(event=>event.brainSources)?.brainSources?.map((s:{source:string})=>s.source);
  if(test.brain) {assert.equal(metrics.sqliteBackend,1);assert.ok(sources.some((source:string)=>/Agentic_Design|APPROCCI_MODERNI/.test(source)));assert.ok(metrics.groundingMs>=0);}
  else {assert.ok(metrics.codeToolCalls>=1);assert.match(answer,/brain\.ts/);}
  const report={test:test.name,ms:performance.now()-start,answer,sources,metrics};reports.push(report);console.log(JSON.stringify(report));
}
await fs.mkdir("runtime/benchmarks",{recursive:true});
await fs.writeFile("runtime/benchmarks/smoke.json",JSON.stringify(reports,null,2));
