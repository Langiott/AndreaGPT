/**
 * Verifica il canale fuzzy: sovrapposizione dei profili, RRF e fusione con la classifica attuale.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fuseFuzzyChannel, fuzzyOverlap, reciprocalRankFusion } from "./fuzzy_rerank";

test("sovrapposizione fuzzy: 1 per profili uguali, 0 senza temi in comune", () => {
  assert.equal(fuzzyOverlap([0.7, 0.3], [0.7, 0.3]), 1);
  assert.equal(fuzzyOverlap([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(fuzzyOverlap([0.6, 0.4], [0.3, 0.7]) - 0.7) < 1e-12);
});

test("RRF premia chi è in alto in entrambe le classifiche", () => {
  const scores = reciprocalRankFusion([["a", "b", "c"], ["b", "c", "a"]]);
  assert.ok(scores.get("b")! > scores.get("a")!);
});

test("un estratto del tema della domanda sale grazie al canale fuzzy, nessuno si perde", () => {
  // c4 è quinto nella classifica attuale ma è l'unico con il tema della domanda.
  const ranked = [1, 0.95, 0.9, 0.85, 0.8].map((score, i) => ({ id: `c${i}`, score, theme: i === 4 ? 1 : 0 }));
  const profileOf = (hit: { theme: number }) => hit.theme === 1 ? [0.1, 0.9] : [0.9, 0.1];
  const result = fuseFuzzyChannel(ranked, [0.2, 0.8], profileOf);
  assert.equal(result.fuzzyTop[0], "c4");
  assert.ok(result.ranked.findIndex(hit => hit.id === "c4") < 4, "c4 risale");
  assert.equal(result.ranked.length, ranked.length);
  assert.ok(Math.abs(result.ranked[0].score - 1) < 1e-12, "stessa scala del primo originale");
});
