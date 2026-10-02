/**
 * Generazione immagini Qwen-Image 2.1 tramite l'API HTTP/WebSocket di ComfyUI.
 * Sostituisce il vecchio ponte Python: il server parla direttamente con ComfyUI,
 * riceve l'avanzamento reale dei passi e può annullare il job in coda o in esecuzione.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ImageFlow = "qwen" | "viggle";
export type ImageRequest = { prompt: string; width: number; height: number; steps: number; seed: number; flow: ImageFlow; lora: string };
export type ImageProgress = { phase: "queued" | "loading" | "sampling" | "decoding"; value: number; max: number };
export type ComfyOptions = {
  baseUrl: string;
  /** Cartella dell'installazione ComfyUI locale; se non esiste si lavora solo via HTTP. */
  comfyRoot: string;
  outputPath: string;
  signal: AbortSignal;
  onProgress?: (progress: ImageProgress) => void;
};

const VIGGLE_SIGMAS = "1.0, 0.9375, 0.875, 0.75, 0.5, 0.25";
export const VIGGLE_STEPS = 6;

/** Costruisce il grafo ComfyUI per il flusso scelto. */
export function buildWorkflow(request: ImageRequest): { workflow: Record<string, unknown>; outputNode: string; samplerNode: string } {
  const common = {
    "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: "qwen_image_2.1_Q5_K_M.gguf" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_w4a8.safetensors", type: "qwen_image", device: "default" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: request.width, height: request.height, batch_size: 1 } },
  };
  const resolution = Math.max(request.width, request.height);
  if (request.flow === "viggle") {
    // Viggle Turbo è distillata per esattamente sei passaggi e prompt strutturati.
    // BasicGuider non usa il negativo: lasciarlo vuoto evita di codificarlo per nulla.
    const prompt = `${request.prompt}. Single main subject, centered composition, clear readable silhouette, clean geometry, coherent proportions, sharp details, no duplicate objects.`;
    return {
      workflow: {
        ...common,
        "3": { class_type: "TextEncodeQwenImage21", inputs: { clip: ["2", 0], prompt, negative_prompt: "", resolution } },
        "6": { class_type: "ViggleTurboLora", inputs: { model: ["1", 0], lora_name: path.basename(request.lora), strength: 1.0 } },
        "7": { class_type: "BasicGuider", inputs: { model: ["6", 0], conditioning: ["3", 0] } },
        "8": { class_type: "RandomNoise", inputs: { noise_seed: request.seed } },
        "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
        "10": { class_type: "ViggleTurboSigmas", inputs: { latent: ["5", 0], nodes: VIGGLE_SIGMAS } },
        "11": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["8", 0], guider: ["7", 0], sampler: ["9", 0], sigmas: ["10", 0], latent_image: ["5", 0] } },
        "12": { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["4", 0] } },
        "13": { class_type: "SaveImage", inputs: { filename_prefix: "AndreaGPT/ViggleTurbo", images: ["12", 0] } },
      },
      outputNode: "13",
      samplerNode: "11",
    };
  }
  return {
    workflow: {
      ...common,
      "3": { class_type: "TextEncodeQwenImage21", inputs: { clip: ["2", 0], prompt: request.prompt, negative_prompt: "", resolution } },
      "6": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["3", 0], negative: ["3", 1], latent_image: ["5", 0], seed: request.seed, steps: request.steps, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0 } },
      "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["4", 0] } },
      "8": { class_type: "SaveImage", inputs: { filename_prefix: "AndreaGPT/Qwen21", images: ["7", 0] } },
    },
    outputNode: "8",
    samplerNode: "6",
  };
}

async function comfyJson<T>(baseUrl: string, route: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const response = await fetch(baseUrl + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`ComfyUI HTTP ${response.status}: ${text.slice(0, 800)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const exists = (target: string) => fs.access(target).then(() => true, () => false);

/** Ferma il prompt: lo toglie dalla coda se in attesa, lo interrompe se in esecuzione. */
async function cancelPrompt(baseUrl: string, promptId: string) {
  await Promise.allSettled([
    comfyJson(baseUrl, "/queue", { delete: [promptId] }, 5_000),
    comfyJson(baseUrl, "/interrupt", { prompt_id: promptId }, 5_000),
  ]);
}

/** Porta l'immagine nella cartella OUTPUT: spostamento su disco se ComfyUI è locale, altrimenti download. */
async function collectImage(baseUrl: string, comfyRoot: string, image: { filename: string; subfolder?: string; type?: string }, outputPath: string) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const local = path.join(comfyRoot, image.type || "output", image.subfolder || "", image.filename);
  if (await exists(local)) {
    try { await fs.rename(local, outputPath); return; }
    catch { await fs.copyFile(local, outputPath); await fs.rm(local, { force: true }); return; }
  }
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/view?${query}`, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 2000)); }
  }
  throw new Error(`Immagine generata ma download da ComfyUI fallito (${lastError instanceof Error ? lastError.message : lastError}). Cerca il file in output/AndreaGPT.`);
}

/** Esegue un job completo e restituisce il dispositivo letto da ComfyUI. */
export async function generateWithComfy(request: ImageRequest, options: ComfyOptions): Promise<{ device: string; deviceName: string }> {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const { signal } = options;
  let stats: { devices?: Array<{ name?: string; type?: string }> };
  try { stats = await comfyJson(baseUrl, "/system_stats", undefined, 5_000); }
  catch { throw new Error("ComfyUI non è raggiungibile. Attendi lo stato Operativo nella chat Image."); }
  const device = stats.devices?.[0];

  // Il LoRA è verificabile solo se ComfyUI gira su questo disco; altrimenti lo segnala ComfyUI stesso.
  if (request.flow === "viggle" && await exists(path.join(options.comfyRoot, "main.py"))) {
    const loraPath = path.join(options.comfyRoot, "models", "loras", path.basename(request.lora));
    if (!await exists(loraPath)) throw new Error(`LoRA Viggle non trovato in ${loraPath}. Scaricalo in models/loras, copia viggle_turbo.py in custom_nodes e riavvia ComfyUI.`);
  }

  const { workflow, outputNode, samplerNode } = buildWorkflow(request);
  const clientId = randomUUID();
  const report = (progress: ImageProgress) => options.onProgress?.(progress);
  let promptId = "";
  // Il WebSocket serve solo per l'avanzamento: il completamento si legge da /history, più affidabile.
  let socket: WebSocket | undefined;
  try {
    socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
    socket.addEventListener("message", event => {
      if (typeof event.data !== "string") return; // anteprime binarie
      try {
        const message = JSON.parse(event.data) as { type?: string; data?: { prompt_id?: string; node?: string | null; value?: number; max?: number } };
        const data = message.data;
        if (!data || (promptId && data.prompt_id && data.prompt_id !== promptId)) return;
        if (message.type === "progress" && typeof data.value === "number" && typeof data.max === "number") report({ phase: "sampling", value: data.value, max: data.max });
        else if (message.type === "executing" && data.node) {
          if (data.node === samplerNode) report({ phase: "sampling", value: 0, max: request.flow === "viggle" ? VIGGLE_STEPS : request.steps });
          else if (Number(data.node) > Number(samplerNode)) report({ phase: "decoding", value: 1, max: 1 });
          else report({ phase: "loading", value: 0, max: 1 });
        }
      } catch { /* messaggio non JSON */ }
    });
    await new Promise<void>(resolve => {
      const done = () => resolve();
      socket!.addEventListener("open", done, { once: true });
      socket!.addEventListener("error", done, { once: true });
      setTimeout(done, 3000);
    });
  } catch { socket = undefined; }

  try {
    if (signal.aborted) throw new Error("Generazione annullata.");
    try { promptId = (await comfyJson<{ prompt_id: string }>(baseUrl, "/prompt", { prompt: workflow, client_id: clientId })).prompt_id; }
    catch (error) {
      if (request.flow === "viggle") throw new Error(`ComfyUI ha rifiutato il flusso Viggle (${error instanceof Error ? error.message : error}). Verifica che il LoRA sia in models/loras e viggle_turbo.py in custom_nodes DELL'ISTANZA ComfyUI, poi riavviala.`);
      throw error;
    }
    report({ phase: "queued", value: 0, max: 1 });
    const onAbort = () => { void cancelPrompt(baseUrl, promptId); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      let pollFailures = 0;
      for (;;) {
        if (signal.aborted) throw new Error(signal.reason instanceof Error ? signal.reason.message : "Generazione annullata.");
        let history: Record<string, { status?: { status_str?: string; messages?: unknown[] }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>;
        try { history = await comfyJson(baseUrl, `/history/${promptId}`, undefined, 10_000); pollFailures = 0; }
        catch (error) {
          // ComfyUI momentaneamente irraggiungibile (es. riavvio): tollera brevi buchi.
          if (++pollFailures > 10) throw new Error(`ComfyUI irraggiungibile durante la generazione (${error instanceof Error ? error.message : error}).`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        const entry = history[promptId];
        if (entry) {
          if (entry.status?.status_str === "error") throw new Error(`ComfyUI: errore in un nodo del flusso (${JSON.stringify(entry.status.messages ?? []).slice(0, 600)}).`);
          const image = entry.outputs?.[outputNode]?.images?.[0];
          if (!image) throw new Error("ComfyUI non ha prodotto immagini");
          await collectImage(baseUrl, options.comfyRoot, image, options.outputPath);
          return { device: device?.type || "sconosciuto", deviceName: device?.name || "sconosciuto" };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally { signal.removeEventListener("abort", onAbort); }
  } finally { socket?.close(); }
}
