import assert from "node:assert/strict";
import {test} from "node:test";
import {inspectGrounding} from "./grounding";
test("numeri e citazioni si verificano sulla fonte citata, non su altre fonti",()=>{
  const sources=[{id:"Cit. 1",text:"La porta del server è 3000."},{id:"Cit. 2",text:"La porta alternativa è 8080."}];
  assert.equal(inspectGrounding("La porta del server configurata è 8080 [Cit. 1].",sources).groundingNumericGaps,1);
  assert.equal(inspectGrounding("La porta del server configurata è 3000 [Cit. 1].",sources).groundingNumericGaps,0);
  assert.equal(inspectGrounding("La porta del server configurata è 3000 [Cit. 9].",sources).groundingInvalidCitations,1);
  assert.equal(inspectGrounding("La porta del server configurata è 3000.",sources).groundingUncitedSegments,1);
});
