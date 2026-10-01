/** Verifica la scelta del modello locale per le conversazioni private. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { modelForPrivateChat } from "../../frontend/model/model_selection";
import { OLLAMA_INFO, OLLAMA_QWEN3_INFO, GLM_INFO } from "./models";

const models = [OLLAMA_INFO, OLLAMA_QWEN3_INFO, GLM_INFO];

test("Brain mantiene il modello locale scelto anche dopo aggiornamento catalogo", () => {
  for (const model of models.filter(model => model.providerId === "ollama")) {
    assert.equal(modelForPrivateChat(model.id, [...models]), model.id);
  }
});

test("Brain sostituisce solo modelli cloud o non disponibili con un locale", () => {
  assert.equal(modelForPrivateChat(GLM_INFO.id, models), OLLAMA_INFO.id);
  assert.equal(modelForPrivateChat("missing", [OLLAMA_QWEN3_INFO]), OLLAMA_QWEN3_INFO.id);
  assert.equal(modelForPrivateChat(GLM_INFO.id, [GLM_INFO]), "");
});
