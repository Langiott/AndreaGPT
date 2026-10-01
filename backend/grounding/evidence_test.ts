import assert from "node:assert/strict";
import { test } from "node:test";
import { compactEvidence } from "./evidence";
import { assessCitations, assessOutputLanguage } from "../diagnostics/diagnostics";

test("prose copies collapse without losing distinct facts or citation identity", () => {
  const fact = "PIPE consente di rappresentare le attività di impianti manifatturieri e parcheggi.";
  const unique = "Il simulatore non consente di salvare i risultati: il limite indicato è 32 elementi.";
  const result = compactEvidence([
    { id: "Cit. 1", source: "overview.md", text: `## README\n${fact}\n\n${fact}` },
    { id: "Cit. 2", source: "README.txt", text: fact },
    { id: "Cit. 3", source: "manuale.md", text: `${fact}\n\n${unique}` },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[1].id, "Cit. 3");
  assert.equal(result[1].text, unique);
  assert.equal(result.map(s => s.text).join("\n").split(fact).length - 1, 1);
});

test("numbers, negations, tables and code remain distinct", () => {
  const texts = ["Il sistema accetta 16 richieste e non permette altre operazioni contemporanee.",
    "Il sistema accetta 32 richieste e permette altre operazioni contemporanee.",
    "```python\nif ready:\n    run()\n\n    run()\n```", "| Nome | Ruolo |\n| Ada | Medico |"];
  const input = texts.map((text, i) => ({ id: `Cit. ${i + 1}`, source: `file-${i}`, text }));
  assert.deepEqual(compactEvidence(input), input);
});

test("citation validation handles sparse IDs and invented references", () => {
  const valid = assessCitations("Risposta [Cit. 3]", 2, 0, ["Cit. 1", "Cit. 3"]);
  assert.equal(valid.found, 1);
  assert.equal(valid.grounded, null);
  assert.equal(assessCitations("Risposta [Cit. 2]", 2, 0, ["Cit. 1", "Cit. 3"]).invalid, 1);
  assert.equal(assessCitations("Risposta [99]", 0, 2).status, "warning");
});

test("output language detects CJK drift but allows technical English", () => {
  assert.equal(assessOutputLanguage("Usa Ollama con TypeScript e una API REST.").hasCjk, false);
  assert.equal(assessOutputLanguage("Ciao! 怎么理解你的问题？").hasCjk, true);
});
