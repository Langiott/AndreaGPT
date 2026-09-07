import type { ModelInfo } from "../src/types";

const DESCRIPTIONS: Record<string, Partial<ModelInfo>> = {
  "nvidia/nemotron-3.5-lightning-30b-a3b": {
    name: "Nemotron 3.5 Lightning 30B",
    description: "Modello NVIDIA rapido per conversazione, scrittura e richieste quotidiane.",
    tags: ["Generale", "Veloce", "NVIDIA"],
    featured: true,
  },
  "nvidia/nemotron-3-super-120b-a12b": {
    name: "Nemotron 3 Super 120B",
    description: "Modello NVIDIA avanzato per analisi, ragionamento e istruzioni articolate.",
    tags: ["Generale", "Ragionamento", "NVIDIA"],
    featured: true,
  },
  "minimaxai/minimax-m3": {
    name: "MiniMax M3",
    description: "Modello generalista per conversazione, contenuti e problem solving.",
    tags: ["Generale", "Multilingua"],
    featured: true,
  },
  "meta/llama-3.1-70b-instruct": {
    name: "Llama 3.1 70B Instruct",
    description: "Modello generalista bilanciato per conversazione, analisi e generazione di contenuti.",
    tags: ["Generale", "Multilingua"],
    context: "128K",
    featured: true,
  },
  "meta/llama-3.1-405b-instruct": {
    name: "Llama 3.1 405B Instruct",
    description: "Modello Llama di grandi dimensioni per istruzioni e problemi articolati.",
    tags: ["Generale", "Ragionamento"],
    context: "128K",
    featured: true,
  },
  "meta/llama-3.2-90b-vision-instruct": {
    name: "Llama 3.2 90B Vision",
    description: "Modello multimodale per comprensione di testo e immagini.",
    tags: ["Visione", "Multimodale"],
    context: "128K",
  },
  "nvidia/llama-3.1-nemotron-ultra-253b-v1": {
    name: "Llama Nemotron Ultra 253B",
    description: "Modello NVIDIA ottimizzato per ragionamento avanzato, istruzioni e risposte accurate.",
    tags: ["Ragionamento", "NVIDIA"],
    context: "128K",
    featured: true,
  },
  "deepseek-ai/deepseek-r1": {
    name: "DeepSeek R1",
    description: "Modello orientato al ragionamento, alla matematica e alla risoluzione di problemi complessi.",
    tags: ["Ragionamento", "Matematica"],
    context: "128K",
    featured: true,
  },
  "qwen/qwen2.5-coder-32b-instruct": {
    name: "Qwen 2.5 Coder 32B",
    description: "Specializzato nella generazione, comprensione e revisione di codice in molti linguaggi.",
    tags: ["Codice", "Sviluppo"],
    context: "128K",
    featured: true,
  },
  "mistralai/mistral-large-2-instruct": {
    name: "Mistral Large 2",
    description: "Modello generalista multilingua adatto a scrittura, analisi e uso di strumenti.",
    tags: ["Generale", "Creatività"],
    context: "128K",
  },
};

const FALLBACK_MODEL_IDS = [
  "minimaxai/minimax-m3",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-3-super-120b-a12b",
];

export const FALLBACK_MODELS: ModelInfo[] = FALLBACK_MODEL_IDS.map((id) => ({
  id,
  name: DESCRIPTIONS[id]?.name ?? humanizeModelId(id),
  provider: id.split("/")[0],
  description: DESCRIPTIONS[id]?.description ?? "Modello disponibile tramite NVIDIA API Catalog.",
  tags: DESCRIPTIONS[id]?.tags ?? ["Generale"],
  context: DESCRIPTIONS[id]?.context,
  featured: DESCRIPTIONS[id]?.featured,
}));

export function humanizeModelId(id: string) {
  const model = id.split("/").at(-1) ?? id;
  return model
    .split("-")
    .map((word) => (/^\d/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

export function enrichModel(id: string): ModelInfo {
  const known = DESCRIPTIONS[id];
  return {
    id,
    name: known?.name ?? humanizeModelId(id),
    provider: id.includes("/") ? id.split("/")[0] : "NVIDIA",
    description: known?.description ?? "Modello disponibile nel catalogo NVIDIA. Capacità e limiti dipendono dalla relativa model card.",
    tags: known?.tags ?? inferTags(id),
    context: known?.context,
    featured: known?.featured,
  };
}

function inferTags(id: string) {
  const value = id.toLowerCase();
  const tags: string[] = [];
  if (value.includes("code") || value.includes("coder")) tags.push("Codice");
  if (value.includes("vision") || value.includes("vl")) tags.push("Visione");
  if (value.includes("embed")) tags.push("Embedding");
  if (value.includes("reason") || value.includes("r1")) tags.push("Ragionamento");
  return tags.length ? tags : ["Generale"];
}
