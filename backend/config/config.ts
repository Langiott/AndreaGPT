/**
 * Raccoglie percorsi, variabili dell'ambiente e client HTTP del server.
 * Le route leggono queste impostazioni senza ricrearle ogni volta.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, EnvHttpProxyAgent } from "undici";
import { localOllamaUrl } from "../utils/local";

// Percorsi usati dal server.
// Questo file è in backend/config: la radice degli script backend è la directory superiore.
const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ocrRoot = path.resolve(process.env.OCR_ROOT || path.join(process.cwd(), "OCR"));
const outputRoot = path.resolve(process.env.OUTPUT_ROOT || path.join(process.cwd(), "OUTPUT"));

/** Percorsi di file, cartelle e script usati dal server. */
export const paths = {
  serverDirectory,
  ocrRoot,
  outputRoot,
  ocrInputRoot: path.join(ocrRoot, "input"),
  ocrOutputRoot: path.join(outputRoot, "OCR"),
  yoloOutputRoot: path.join(outputRoot, "YOLO"),
  imageOutputRoot: path.join(outputRoot, "Image"),
  doctrScript: path.join(serverDirectory, "utils", "doctr_ocr.py"),
  yoloScript: path.join(serverDirectory, "model", "yolo_predict.py"),
  qwenImageScript: path.join(serverDirectory, "model", "qwen_image.py"),
  qwenVisionScript: path.join(serverDirectory, "model", "qwen_vision.py"),
  audioScript: path.join(serverDirectory, "utils", "transcribe_audio.py"),
  toolsRoot: path.resolve(process.env.TOOLS_ROOT || path.join(process.cwd(), "data/tools")),
};

// Impostazioni lette dalle variabili dell'ambiente.
const configuredApiKey = process.env.NVIDIA_API_KEY?.trim();
const configuredOpenRouterKey = process.env.OPENROUTER_API_KEY?.trim();

/** Impostazioni lette dal file .env e dall'ambiente di esecuzione. */
export const settings = {
  port: Number(process.env.PORT) || 3000,
  apiBase: (process.env.NVIDIA_API_BASE || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
  apiKey: configuredApiKey && configuredApiKey !== "nvapi-inserisci-la-tua-chiave" ? configuredApiKey : undefined,
  openRouterKey: configuredOpenRouterKey && configuredOpenRouterKey !== "sk-or-inserisci-la-tua-chiave" ? configuredOpenRouterKey : undefined,
  perplexityKey: process.env.PERPLEXITY_API_KEY?.trim(),
  firecrawlKey: process.env.FIRECRAWL_API_KEY?.trim(),
  openRouterBase: "https://openrouter.ai/api/v1",
  localRouterThreshold: Math.min(1, Math.max(0, Number(process.env.LOCAL_ROUTER_THRESHOLD) || 0.75)),
  localRouterEnabled: process.env.LOCAL_ROUTER_ENABLED === "1",
  lanAccessEnabled: process.env.LAN_ACCESS === "1",
  searxngBaseUrl: (process.env.SEARXNG_URL || "http://127.0.0.1:8080").replace(/\/$/, ""),
  ollamaBase: localOllamaUrl(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"),
};

// Client HTTP separati: Ollama può caricare un modello lentamente.
/** Client HTTP per Ollama, con tempo maggiore per il primo caricamento. */
export const ollamaTransport = new Agent({ headersTimeout: 15 * 60_000, bodyTimeout: 15 * 60_000 });

// Rispetta HTTP_PROXY e HTTPS_PROXY per i servizi esterni.
/** Client HTTP per i servizi esterni, con supporto al proxy di sistema. */
export const cloudTransport = new EnvHttpProxyAgent({ headersTimeout: 60_000, bodyTimeout: 60_000 });
