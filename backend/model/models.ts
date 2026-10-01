/**
 * Contiene il catalogo dei modelli disponibili.
 * Definisce nomi, descrizioni, capacità e valori di riserva.
 */
import type { ModelInfo } from "../../frontend/types/types";

export const OLLAMA_MODEL = "openbmb/minicpm5-2b:latest";
export const OLLAMA_QWEN3_14B = "qwen3:14b";
export const OLLAMA_QWEN3_CODER_MODEL = "qwen3-coder:30b-a3b-q4_K_M";
export const OLLAMA_ORNITH_MODEL = "ornith-1.5:9b";
export const OLLAMA_MODELS = new Set([
  OLLAMA_MODEL,
  OLLAMA_QWEN3_14B,
  OLLAMA_QWEN3_CODER_MODEL,
  OLLAMA_ORNITH_MODEL,
]);
// I modelli piccoli restano a 4096 per limitare memoria e latenza.
export const OLLAMA_NUM_CTX = 4096;
export const OLLAMA_INFO: ModelInfo = {
  id: OLLAMA_MODEL, name: "MiniCPM5 2B (locale)", provider: "Ollama", providerId: "ollama",
  description: "Modello OpenBMB compatto da 2B, eseguito interamente in locale. Adatto a chat, scrittura, codice e consultazione Brain.",
  tags: ["Locale", "Brain", "Veloce", "2B", "Codice"], context: String(OLLAMA_NUM_CTX), featured: true,
};
export const OLLAMA_QWEN3_INFO: ModelInfo = {
  id: OLLAMA_QWEN3_14B, name: "Qwen3 14B (locale)", provider: "Ollama", providerId: "ollama",
  description: "Qwen3 denso da 14B in GGUF Q4_K_M (~9,3 GB). Il più capace dei locali: ragionamento, codice e italiano. Richiede ~10 GB di RAM/VRAM.",
  // L'interfaccia supporta 4096/8192; evitare valori come "40K", che
  // Number("40K") trasformerebbe in NaN causando il fallback a 4096.
  tags: ["Locale", "Brain", "Ragionamento", "Codice", "14B"], context: "8192", featured: true,
};
export const OLLAMA_QWEN3_CODER_INFO: ModelInfo = {
  id: OLLAMA_QWEN3_CODER_MODEL, name: "Qwen3 Coder 30B-A3B Q4_K_M (locale)", provider: "Ollama", providerId: "ollama",
  description: "MoE coder locale specializzato in coding, repository e agenti. La quantizzazione Q4_K_M occupa circa 19 GB e richiede più memoria dei modelli rapidi.",
  tags: ["Locale", "Brain", "Codice", "Agente", "30B-A3B", "Q4_K_M"], context: "8192", featured: true,
};
export const OLLAMA_ORNITH_INFO: ModelInfo = {
  id: OLLAMA_ORNITH_MODEL, name: "Ornith 1.5 9B (locale)", provider: "Ollama", providerId: "ollama",
  description: "Modello locale di ragionamento e uso di strumenti, adatto a revisione del codice, agenti e conversazioni con correzioni persistenti.",
  tags: ["Locale", "Brain", "Ragionamento", "Codice", "Agente", "Visione", "9B", "Q4_K_M"], context: "8192", featured: true,
};
export const GLM_INFO: ModelInfo = {
  id: "z-ai/glm-5.2", name: "GLM 5.2", provider: "OpenRouter · Z.ai", providerId: "openrouter",
  description: "Modello cloud per ragionamento, coding e attività complesse a lungo contesto.",
  tags: ["Cloud", "Ragionamento", "Codice"], context: "1M", featured: true,
};
export const GEMMA_INFO: ModelInfo = {
  id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", provider: "OpenRouter · Google", providerId: "openrouter",
  description: "Modello Gemma multimodale di Google disponibile tramite OpenRouter.",
  tags: ["Cloud", "Gemma", "Multimodale"], context: "256K", featured: true,
};
export const MINIMAX_INFO: ModelInfo = {
  id: "minimaxai/minimax-m3", name: "MiniMax M3", provider: "NVIDIA", providerId: "nvidia",
  description: "Modello generalista MiniMax M3 disponibile tramite NVIDIA API Catalog.",
  tags: ["Cloud", "Multilingua"], featured: true,
};

const DESCRIPTIONS: Record<string, Partial<ModelInfo>> = {
  "minimaxai/minimax-m3": {
    name: "MiniMax M3",
    description: "Modello generalista per conversazione, contenuti e problem solving.",
    tags: ["Generale", "Multilingua"],
    featured: true,
  },
  "minimax/minimax-m3": {
    name: "MiniMax M3",
    description: "MiniMax M3 tramite OpenRouter. Modello a pagamento: il consumo viene addebitato sul credito OpenRouter.",
    tags: ["Generale", "Multilingua", "A pagamento"],
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
];

export const FALLBACK_MODELS: ModelInfo[] = FALLBACK_MODEL_IDS.map((id) => ({
  id,
  providerId: "nvidia",
  name: DESCRIPTIONS[id]?.name ?? humanizeModelId(id),
  provider: id.split("/")[0],
  description: DESCRIPTIONS[id]?.description ?? "Modello disponibile tramite NVIDIA API Catalog.",
  tags: DESCRIPTIONS[id]?.tags ?? ["Generale"],
  context: DESCRIPTIONS[id]?.context,
  featured: DESCRIPTIONS[id]?.featured,
}));

/** Trasforma l'identificativo tecnico in un nome leggibile. */
export function humanizeModelId(id: string) {
  const model = id.split("/").at(-1) ?? id;
  return model
    .split("-")
    .map((word) => (/^\d/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** Rende leggibile il nome di un modello Ollama. */
export function humanizeOllamaId(id: string) {
  const cleaned = id.replace(/^.*\//, "").replace(/[:_-]+/g, " ").replace(/\s+/g, " ").trim();
  const titled = (cleaned || id).split(" ").map((word) => (/^\d/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
  return titled.replace(/\s+latest$/i, "") || titled;
}

/** Completa un modello con nome, descrizione e informazioni note. */
export function enrichModel(id: string): ModelInfo {
  const known = DESCRIPTIONS[id];
  return {
    id,
    providerId: "nvidia",
    name: known?.name ?? humanizeModelId(id),
    provider: id.includes("/") ? id.split("/")[0] : "NVIDIA",
    description: known?.description ?? "Modello disponibile nel catalogo NVIDIA. Capacità e limiti dipendono dalla relativa model card.",
    tags: known?.tags ?? inferTags(id),
    context: known?.context,
    featured: known?.featured,
  };
}

/** Sceglie le etichette in base al nome del modello. */
function inferTags(id: string) {
  const value = id.toLowerCase();
  const tags: string[] = [];
  if (value.includes("code") || value.includes("coder")) tags.push("Codice");
  if (value.includes("vision") || value.includes("vl")) tags.push("Visione");
  if (value.includes("embed")) tags.push("Embedding");
  if (value.includes("reason") || value.includes("r1")) tags.push("Ragionamento");
  return tags.length ? tags : ["Generale"];
}
