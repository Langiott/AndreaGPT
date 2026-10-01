/** Verifica che gli errori di Ollama siano spiegati in italiano semplice. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ollamaErrorMessage } from "./models";

test("modello non installato: messaggio in italiano con il comando ollama pull", () => {
  const message = ollamaErrorMessage(404, "model 'qwen3:14b' not found", "qwen3:14b");
  assert.match(message, /non è installato/);
  assert.match(message, /ollama pull qwen3:14b/);
});

test("altri errori di Ollama mantengono il codice HTTP", () => {
  assert.match(ollamaErrorMessage(500, "out of memory", "qwen3:14b"), /Ollama HTTP 500/);
});
