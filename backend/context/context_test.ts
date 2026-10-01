import assert from "node:assert/strict";
import { test } from "node:test";
import { localContext } from "./context";

test("fonti troppo grandi non nascondono prove successive compatibili col budget", () => {
  const sources = Array.from({ length: 5 }, (_, i) => ({ id: `Cit. ${i + 1}`, source: "lungo", text: "x".repeat(20000) }));
  sources.push({ id: "Cit. 6", source: "breve", text: "Il database è Postgres." });
  const result = localContext([{ role: "user", content: "Quale database?" }], sources, true, 4096, 512);
  assert.deepEqual(result.sources, [sources[5]]);
  assert.equal(result.evidenceDiagnostics.evidenceSourcesOverBudget, 5);
  assert.equal(result.evidenceDiagnostics.evidenceSourcesOmitted, 5);
});

test("Brain conserva prove e domanda eliminando prima la cronologia lunga", () => {
  const sources = Array.from({ length: 5 }, (_, i) => ({ id: `Cit. ${i + 1}`, source: "romanzo.txt:1", text: "Informazione verificabile. ".repeat(50) }));
  const result = localContext([{ role: "system", content: "Italiano" }, { role: "user", content: "vecchia domanda" }, { role: "assistant", content: "vecchia risposta ".repeat(1000) }, { role: "user", content: "Chi è il protagonista?" }], sources, true, 4096, 512);
  assert.equal(result.sources.length, 3);
  assert.equal(result.historyMessages, 0);
  assert.ok(result.estimatedPromptTokens <= 4096 - 512 - 512);
  assert.match(result.messages.at(-1)!.content, /Chi è il protagonista/);
  for (const source of result.sources) assert.ok(result.messages.at(-1)!.content.includes(source.text));
});

test("Brain rifiuta input che non lascia spazio a nessuna prova", () => {
  assert.throws(() => localContext([{ role: "user", content: "x".repeat(8100) }], [{ id: "Cit. 1", source: "test", text: "y".repeat(1400) }], true, 4096, 512), /Spazio insufficiente|Input troppo lungo/);
});

test("chat senza Brain mantiene la domanda e la cronologia recente", () => {
  const result = localContext([{ role: "user", content: "Ciao" }, { role: "assistant", content: "Salve" }, { role: "user", content: "Continua" }], [], false, 4096, 512);
  assert.equal(result.historyMessages, 2);
  assert.equal(result.messages.at(-1)!.content, "Continua");
  assert.deepEqual(result.sources, []);
});

test("domande trasversali possono usare fino a cinque fonti nel budget", () => {
  const sources = Array.from({ length: 5 }, (_, i) => ({ id: `Cit. ${i + 1}`, source: `progetto-${i}`, text: `Fatto ${i}` }));
  const result = localContext([{ role: "user", content: "Come ho utilizzato la PCA nei progetti?" }], sources, true, 4096, 512);
  assert.equal(result.sources.length, 5);
});

test("Brain evita parolacce non richieste", () => {
  const result = localContext([{ role: "user", content: "Spiega i puntatori" }], [{ id: "Cit. 1", source: "cpp.md", text: "Un puntatore contiene un indirizzo." }], true, 4096, 512);
  assert.match(result.messages[0].content, /niente parolacce/i);
});
