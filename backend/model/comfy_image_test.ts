/** Verifica il grafo ComfyUI generato per i flussi Qwen e Viggle. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkflow, VIGGLE_STEPS } from "./comfy_image";

const base = { prompt: "un gatto", width: 768, height: 1024, steps: 25, seed: 7, lora: "dir/viggle.safetensors" };
type Node = { class_type: string; inputs: Record<string, unknown> };

test("Qwen usa i passi richiesti e salva dal nodo di output", () => {
  const { workflow, outputNode, samplerNode } = buildWorkflow({ ...base, flow: "qwen" });
  const nodes = workflow as Record<string, Node>;
  assert.equal(nodes[samplerNode].inputs.steps, 25);
  assert.equal(nodes[samplerNode].inputs.seed, 7);
  assert.equal(nodes[outputNode].class_type, "SaveImage");
  assert.equal(nodes["3"].inputs.resolution, 1024);
});

test("Viggle non codifica un negativo inutile e ignora i passi della UI", () => {
  const { workflow, samplerNode } = buildWorkflow({ ...base, flow: "viggle", steps: 40 });
  const nodes = workflow as Record<string, Node>;
  assert.equal(nodes["3"].inputs.negative_prompt, "");
  assert.equal(nodes[samplerNode].class_type, "SamplerCustomAdvanced");
  assert.equal(String(nodes["10"].inputs.nodes).split(",").length, VIGGLE_STEPS);
  assert.equal(nodes["6"].inputs.lora_name, "viggle.safetensors");
  assert.ok(!JSON.stringify(workflow).includes("40"));
});
