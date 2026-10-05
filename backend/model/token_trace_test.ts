/**
 * Verifica unione dei token UTF-8 spezzati, probabilità e cache dei contesti di biforcazione.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { branchContext, rememberBranchContext, toTraceTokens } from "./token_trace";

const bytes = (text: string) => [...new TextEncoder().encode(text)];

test("le probabilità sono exp(logprob) e le alternative restano in ordine", () => {
  const [token] = toTraceTokens([{ token: "Roma", logprob: Math.log(0.6), bytes: bytes("Roma"), top_logprobs: [{ token: "Roma", logprob: Math.log(0.6), bytes: bytes("Roma") }, { token: "Milano", logprob: Math.log(0.3), bytes: bytes("Milano") }] }]);
  assert.deepEqual(token, { t: "Roma", p: 0.6, alt: [["Roma", 0.6], ["Milano", 0.3]] });
});

test("un carattere spezzato su due token diventa un token solo", () => {
  const [first, second] = [bytes("à").slice(0, 1), bytes("à").slice(1)];
  const tokens = toTraceTokens([
    { token: "�", logprob: Math.log(0.5), bytes: first, top_logprobs: [{ token: "�", logprob: Math.log(0.5), bytes: first }, { token: "e", logprob: Math.log(0.2), bytes: bytes("e") }] },
    { token: "�", logprob: Math.log(0.8), bytes: second },
    { token: " ok", logprob: 0, bytes: bytes(" ok") },
  ]);
  assert.deepEqual(tokens.map(token => token.t), ["à", " ok"]);
  assert.equal(tokens[0].p, 0.4);
  // l'alternativa incompleta viene scartata
  assert.deepEqual(tokens[0].alt, [["e", 0.2]]);
});

test("il testo dei token ricompone esattamente la risposta", () => {
  const text = "Perché è così";
  const parts = ["Per", "ch", "é", " è", " co", "sì"];
  assert.equal(toTraceTokens(parts.map(part => ({ token: part, logprob: 0, bytes: bytes(part) }))).map(token => token.t).join(""), text);
});

test("il contesto di biforcazione si recupera per id", () => {
  const id = rememberBranchContext({ model: "m", messages: [{ role: "user", content: "ciao" }], options: {}, maxTokens: 10 });
  assert.equal(branchContext(id)?.model, "m");
  assert.equal(branchContext("inesistente"), null);
});
