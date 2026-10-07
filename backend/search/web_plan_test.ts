/** Verifica la validazione del piano di ricerca prodotto dal modello e la fusione dei risultati. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fuseRankings, parseRelevant, parseWebPlan, relaxWebPlan } from "./web_plan";

test("un piano valido passa intatto, senza varianti duplicate", () => {
  assert.deepEqual(parseWebPlan('{"queries":["Ferrari Formula 1","Ferrari Formula 1","Scuderia Ferrari"],"language":"IT","category":"news","time_range":"week"}', "x"),
    { queries: ["Ferrari Formula 1", "Scuderia Ferrari"], category: "news", timeRange: "week", language: "it" });
});

test("time_range none diventa nessun filtro temporale", () => {
  assert.equal(parseWebPlan('{"queries":["teorema di Bayes"],"category":"general","time_range":"none"}', "x").timeRange, "");
});

test("output non JSON o query vuote ricadono sulla domanda originale", () => {
  assert.deepEqual(parseWebPlan("non sono JSON", "domanda"), { queries: ["domanda"], category: "general", timeRange: "", language: "it" });
  assert.deepEqual(parseWebPlan('{"queries":[" ", 3],"category":"altro","time_range":"secolo"}', "domanda").queries, ["domanda"]);
});

test("senza risultati il piano si allarga: periodo più ampio, poi ricerca generale senza periodo", () => {
  const steps = relaxWebPlan({ queries: ["Juventus"], category: "news", timeRange: "day", language: "it" });
  assert.deepEqual(steps.map(step => [step.category, step.timeRange]), [["news", "day"], ["news", "week"], ["general", ""]]);
  assert.equal(relaxWebPlan({ queries: ["Bayes"], category: "general", timeRange: "", language: "it" }).length, 1);
});

test("la fusione premia i risultati trovati da più varianti", () => {
  const fused = fuseRankings([["a", "b", "c"], ["c", "d"], ["c", "b"]], (item) => item);
  assert.equal(fused[0], "c");
  assert.deepEqual(new Set(fused), new Set(["a", "b", "c", "d"]));
  assert.equal(fused.at(-1), "d");
});

test("il giudizio di pertinenza accetta solo indici validi e distingue lista vuota da output rotto", () => {
  assert.deepEqual(parseRelevant('{"relevant":[3,1,1,9,0,2.5]}', 4), [2, 0]);
  assert.deepEqual(parseRelevant('{"relevant":[]}', 4), []);
  assert.equal(parseRelevant("boh", 4), null);
});
