import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactChat } from "./chat_compact";

test("formatCompactChat crea una nota locale e conserva ordine e contenuto", () => {
  const note = formatCompactChat([
    { role: "user", content: "Domanda\r\ncon due righe" },
    { role: "assistant", content: "Risposta con **Markdown** e dettagli tecnici." },
  ], new Date("2026-09-29T21:38:07.018Z"));

  assert.match(note, /^# Nota chat/);
  assert.match(note, /## Utente 1/);
  assert.match(note, /Domanda\ncon due righe/);
  assert.match(note, /## Assistente 2/);
  assert.ok(note.indexOf("Domanda") < note.indexOf("Risposta"));
});
