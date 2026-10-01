/** Verifica l'estrazione della domanda dalla cronologia della chat. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSearchQuery } from "./search_query";

test("il cambio di argomento non eredita Nova dalle risposte precedenti", () => {
  assert.equal(extractSearchQuery([
    { role: "user", content: "Chi è Nova?" },
    { role: "assistant", content: "Nova è un Alcione. Micelia è biologa." },
    { role: "user", content: "Parlami metodi retrival" },
  ]), "Parlami metodi retrival");
});

test("un seguito esplicito conserva la domanda precedente senza testo generato", () => {
  assert.equal(extractSearchQuery([
    { role: "user", content: "Quali metodi di retrieval uso?" },
    { role: "assistant", content: "Testo inventato su Nova" },
    { role: "user", content: "Approfondisci questi metodi" },
  ]), "Quali metodi di retrieval uso? Approfondisci questi metodi");
});

test("query multimodale esclude istruzioni di sistema e allegati", () => {
  assert.equal(extractSearchQuery([
    { role: "system", content: "Nova" },
    { role: "user", content: [{ type: "image_url" }, { type: "text", text: "retrieval\n--- File: esempio\nNova" }] },
  ]), "retrieval");
  assert.equal(extractSearchQuery([]), "");
});
