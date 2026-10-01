import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVER_UNREACHABLE, userErrorMessage } from "./errors";

test("errore di rete del browser diventa un messaggio in italiano", () => {
  assert.equal(userErrorMessage(new TypeError("Failed to fetch"), "x"), SERVER_UNREACHABLE);
  assert.equal(userErrorMessage(new TypeError("NetworkError when attempting to fetch resource."), "x"), SERVER_UNREACHABLE);
});

test("errore normale mantiene il suo messaggio", () => {
  assert.equal(userErrorMessage(new Error("Modello non disponibile"), "x"), "Modello non disponibile");
});

test("valore non-Error usa il messaggio di riserva", () => {
  assert.equal(userErrorMessage("boh", "Si è verificato un errore."), "Si è verificato un errore.");
});
