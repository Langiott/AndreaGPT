import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectGrounding } from "./grounding";
import { auditEvidenceDelivery } from "./evidence_audit";
import { compactEvidence } from "./evidence";

test("formula absence is flagged only when the delivered extracts contain math", () => {
  const source = { id: "Cit. 4", source: "documento.md:2-5", text: "$$E=mc^2$$" };
  const answer = "Le fonti non contengono formule matematiche esplicite.";
  assert.equal(inspectGrounding(answer, [source]).groundingFormulaAbsenceWarnings, 1);
  assert.equal(inspectGrounding(answer, []).groundingFormulaAbsenceWarnings, 0);
  assert.equal(inspectGrounding("L'equazione presente è $$E=mc^2$$ [Cit. 4].", [source]).groundingFormulaAbsenceWarnings, 0);
});

test("compaction preserves repeated formulas with different definitions", () => {
  const equation = "$$\\operatorname{valore}(x) = \\sum_{i=1}^{N} a_i x_i$$";
  const sources = [
    { id: "Cit. 1", source: "uno.md", text: `${equation}\n\nQui a è un coefficiente.` },
    { id: "Cit. 2", source: "due.md", text: `${equation}\n\nQui x è una misura.` },
  ];
  assert.deepEqual(compactEvidence(sources), sources);
  assert.deepEqual(auditEvidenceDelivery(sources, [sources[1]]), {
    evidenceSourcesRetrieved: 2, evidenceSourcesDelivered: 1, evidenceSourcesOmitted: 1,
    evidenceCharsDelivered: sources[1].text.length,
    evidenceFormulaSpansRetrieved: 2, evidenceFormulaSpansDelivered: 1,
  });
});
