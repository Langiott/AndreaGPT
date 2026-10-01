/**
 * Verifica parole spiegate, coalizioni e proprietà matematiche dei valori di Shapley.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { coalitionText, queryWithout, shapFindings, shapleyPlan, shapleyValues, shapPlayers } from "./query_shap";

const QUERY = "Definisci matematicamente le reti neurali e come si fa back propagation";

test("le parole spiegate sono i termini di argomento, nell'ordine della domanda", () => {
  assert.deepEqual(shapPlayers(QUERY), ["definisci", "matematicamente", "reti", "neurali", "back", "propagation"]);
});

test("una coalizione toglie solo le parole assenti e mantiene il tipo di domanda", () => {
  const players = shapPlayers(QUERY);
  assert.equal(queryWithout(QUERY, players, new Set(["reti", "neurali"])), "le reti neurali e come si fa");
  // Domanda normale: come nella ricerca, l'embedding usa la lista di parole.
  assert.equal(coalitionText(QUERY, players, new Set(["back"])), "search_query: le come si fa back");
  // Domanda di definizione: la riscrittura dipende dalla domanda intera e resta fissa in ogni coalizione.
  const definition = "Definisci il metodo della back propagation";
  assert.match(coalitionText(definition, shapPlayers(definition), new Set(["back"])), /^search_query: Definizione sintetica .* Domanda: il della back$/);
});

test("in un gioco additivo Shapley restituisce esattamente il peso di ogni parola", () => {
  const weights = [0.3, -0.1, 0.05, 0.2];
  const value = (mask: number) => weights.reduce((sum, w, i) => sum + (mask & (1 << i) ? w : 0), 0);
  const phi = shapleyValues(4, shapleyPlan(4), value);
  phi.forEach((p, i) => assert.ok(Math.abs(p - weights[i]) < 1e-12));
});

test("efficienza: la somma dei contributi è il valore pieno meno quello vuoto, anche stimato", () => {
  // Gioco con interazione: due parole valgono di più insieme.
  for (const n of [5, 10]) {
    const value = (mask: number) => (mask & 1 && mask & 2 ? 0.4 : 0) + 0.1 * Math.sqrt(mask.toString(2).replace(/0/g, "").length);
    const phi = shapleyValues(n, shapleyPlan(n), value);
    const total = phi.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - (value((1 << n) - 1) - value(0))) < 1e-9, `n=${n}`);
    assert.ok(Math.abs(phi[0] - phi[1]) < 1e-9 || n > 8, "parole simmetriche ricevono lo stesso valore");
  }
});

test("la lettura pratica segnala la parola che comanda e le parti non coperte", () => {
  const findings = shapFindings(["reti", "neurali", "back"], [0.5, 0.45, 0.05], [3, 3, 0], 3);
  assert.match(findings[0], /guidata soprattutto da "reti"/);
  assert.match(findings[1], /"back" pesa poco e non compare in nessuna fonte/);
});

test("i verbi di richiesta non vengono segnalati come argomenti mancanti", () => {
  const findings = shapFindings(["definisci", "reti", "back"], [0.04, 0.9, 0.06], [0, 3, 0], 3);
  assert.ok(findings.some(text => /"back" pesa poco/.test(text)));
  assert.ok(!findings.some(text => /"definisci"/.test(text)));
});
