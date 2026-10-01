/** Verifica la scelta tra chat normale, Brain e Web. */
import assert from "node:assert/strict";
import test from "node:test";
import { routeLocally } from "./router";

test("router locale separa chat, Brain e Web senza servizi esterni", () => {
  assert.equal(routeLocally("Scrivi una filastrocca su un gatto").route, "normal");
  assert.equal(routeLocally("Che tempo farà domani a Roma?").route, "web");
  assert.equal(routeLocally("Secondo i miei documenti, chi è Nova?").route, "brain");
  assert.equal(routeLocally("Nel progetto indicizzato dove viene definita la classe?").route, "brain");
  assert.equal(routeLocally("Cerca sul web le ultime notizie").route, "web");
  assert.equal(routeLocally("Secondo i miei documenti, quali notizie ci sono oggi?").confidence, 0.4);
  assert.notEqual(routeLocally("Nel mio progetto dove è definita la classe?", { allowBrain: false }).route, "brain");
});
