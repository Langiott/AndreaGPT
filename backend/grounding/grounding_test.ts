import assert from "node:assert/strict";
import {test} from "node:test";
import {groundingWarning, inspectGrounding} from "./grounding";
test("numeri e citazioni si verificano sulla fonte citata, non su altre fonti",()=>{
  const sources=[{id:"Cit. 1",text:"La porta del server è 3000."},{id:"Cit. 2",text:"La porta alternativa è 8080."}];
  assert.equal(inspectGrounding("La porta del server configurata è 8080 [Cit. 1].",sources).groundingNumericGaps,1);
  assert.equal(inspectGrounding("La porta del server configurata è 3000 [Cit. 1].",sources).groundingNumericGaps,0);
  assert.equal(inspectGrounding("La porta del server configurata è 3000 [Cit. 9].",sources).groundingInvalidCitations,1);
  assert.equal(inspectGrounding("La porta del server configurata è 3000.",sources).groundingUncitedSegments,1);
});

test("citazione a fine paragrafo vale per tutto il paragrafo; aperture e chiusure non contano", () => {
  const sources = [{ id: "Cit. 1", text: "Il metodo costruisce un grafo multilayer dei token e calcola il cammino minimo con Dijkstra. Il costo degli archi vale uno meno il peso." }];
  const answer = "Ecco i punti principali del metodo proposto:\n\nIl metodo costruisce un grafo multilayer dei token. Il cammino minimo viene calcolato con Dijkstra sul grafo [Cit. 1].\n\nSpero che questa spiegazione ti sia utile per lo studio.";
  const checks = inspectGrounding(answer, sources);
  assert.equal(checks.groundingSegments, 2);
  assert.equal(checks.groundingUncitedSegments, 0);
  assert.equal(checks.groundedness, 1);
  assert.equal(groundingWarning(checks), false);
});

test("frase citata ma non sostenuta dalla fonte: Faithfulness scende e scatta l'avviso", () => {
  const sources = [{ id: "Cit. 1", text: "Il metodo costruisce un grafo multilayer dei token e calcola il cammino minimo con Dijkstra." }];
  const checks = inspectGrounding("Il metodo costruisce un grafo multilayer dei token [Cit. 1]. Il modello impiega inoltre una rete ricorrente bidirezionale con meccanismo di gating [Cit. 1].", sources);
  assert.equal(checks.groundingUnsupportedSegments, 1);
  assert.equal(checks.faithfulness, 0.5);
  assert.equal(groundingWarning(checks), true);
});

test("numeri: controllati anche senza citazione, formati equivalenti e riferimenti alle fonti esclusi", () => {
  const sources = [{ id: "Cit. 1", text: "AUC Insertion media 0.5243 su 100 immagini; il grafo ha 418 470 archi." }];
  assert.equal(inspectGrounding("L'AUC di Insertion media vale 0,5243 sulle immagini valutate [Cit. 1].", sources).groundingNumericGaps, 0);
  assert.equal(inspectGrounding("Il grafo costruito dal metodo contiene 418470 archi complessivi [Cit. 1].", sources).groundingNumericGaps, 0);
  assert.equal(inspectGrounding("La valutazione del metodo è stata condotta su 250 immagini diverse.", sources).groundingNumericGaps, 1);
  assert.equal(inspectGrounding("- [Cit. 1] TESI.md:775-794 riporta la valutazione delle immagini", sources).groundingNumericGaps, 0);
});
