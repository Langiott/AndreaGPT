/**
 * Generazione immagini Qwen-Image 2.1 tramite l'API HTTP/WebSocket di ComfyUI.
 * Sostituisce il vecchio ponte Python: il server parla direttamente con ComfyUI,
 * riceve l'avanzamento reale dei passi e può annullare il job in coda o in esecuzione.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ImageFlow = "qwen" | "viggle";
export type ImageRequest = { prompt: string; width: number; height: number; steps: number; seed: number; flow: ImageFlow; lora: string;
  /** Immagine di esempio (data URL): attiva img2img. */
  reference?: string;
  /** Quanto cambiare l'esempio: 0 = identica, 1 = ignorata. */
  denoise?: number;
};
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
export function buildWorkflow(request: ImageRequest, referenceName?: string): { workflow: Record<string, unknown>; outputNode: string; samplerNode: string } {
  const common = {
    "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: "qwen_image_2.1_Q5_K_M.gguf" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_w4a8.safetensors", type: "qwen_image", device: "default" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: request.width, height: request.height, batch_size: 1 } },
  };
  const resolution = Math.max(request.width, request.height);
  if (referenceName) {
    // Img2img: l'esempio, scalato e ritagliato alla misura scelta, sostituisce il latente vuoto.
    const denoise = request.denoise ?? 0.6;
    const viggle = request.flow === "viggle";
    const prompt = viggle ? `${request.prompt}. Single main subject, centered composition, clear readable silhouette, clean geometry, coherent proportions, sharp details, no duplicate objects.` : request.prompt;
    return {
      workflow: {
        "1": common["1"], "2": common["2"], "4": common["4"],
        "3": { class_type: "TextEncodeQwenImage21", inputs: { clip: ["2", 0], prompt, negative_prompt: "", resolution } },
        "20": { class_type: "LoadImage", inputs: { image: referenceName } },
        "21": { class_type: "ImageScale", inputs: { image: ["20", 0], upscale_method: "lanczos", width: request.width, height: request.height, crop: "center" } },
        "5": { class_type: "VAEEncode", inputs: { pixels: ["21", 0], vae: ["4", 0] } },
        ...(viggle ? { "22": { class_type: "ViggleTurboLora", inputs: { model: ["1", 0], lora_name: path.basename(request.lora), strength: 1.0 } } } : {}),
        "6": { class_type: "KSampler", inputs: { model: viggle ? ["22", 0] : ["1", 0], positive: ["3", 0], negative: ["3", 1], latent_image: ["5", 0], seed: request.seed, steps: viggle ? VIGGLE_STEPS : request.steps, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise } },
        "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["4", 0] } },
        "8": { class_type: "SaveImage", inputs: { filename_prefix: viggle ? "AndreaGPT/ViggleTurbo" : "AndreaGPT/Qwen21", images: ["7", 0] } },
      },
      outputNode: "8",
      samplerNode: "6",
    };
  }
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

/** Carica l'immagine di esempio nella cartella input di ComfyUI e ne restituisce il nome. */
async function uploadReference(baseUrl: string, dataUrl: string): Promise<string> {
  const match = /^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("Immagine di esempio non valida: usa PNG, JPEG o WEBP.");
  const form = new FormData();
  form.append("image", new Blob([Buffer.from(match[3], "base64")], { type: match[1] }), `andreagpt-ref-${randomUUID()}.${match[2] === "jpeg" ? "jpg" : match[2]}`);
  form.append("overwrite", "true");
  const response = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Caricamento esempio su ComfyUI fallito (HTTP ${response.status}): ${text.slice(0, 300)}`);
  const result = JSON.parse(text) as { name: string; subfolder?: string };
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
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

export type LogRow = { group: string; label: string; value: string };
type ComfyStats = { system?: Record<string, unknown>; devices?: Array<{ name?: string; type?: string; vram_total?: number; vram_free?: number; torch_vram_total?: number; torch_vram_free?: number }> };
const gb = (bytes?: number) => typeof bytes === "number" ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : "n/d";
const sec = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(2)} s`;
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;

/** Riassume il grafo inviato: ogni nodo con i suoi parametri non collegati. */
function describeWorkflow(workflow: Record<string, unknown>): LogRow[] {
  return Object.entries(workflow as Record<string, { class_type: string; inputs: Record<string, unknown> }>).map(([id, node]) => ({
    group: "Grafo ComfyUI",
    label: `#${id} ${node.class_type}`,
    value: Object.entries(node.inputs).filter(([, value]) => !Array.isArray(value)).map(([key, value]) => `${key}=${typeof value === "string" && value.length > 120 ? value.slice(0, 120) + "…" : value}`).join(" · ") || "—",
  }));
}

/** Esegue un job completo e restituisce dispositivo e log dettagliato. */
export async function generateWithComfy(request: ImageRequest, options: ComfyOptions): Promise<{ device: string; deviceName: string; log: LogRow[]; workflow: Record<string, unknown> }> {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const { signal } = options;
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  let stats: ComfyStats;
  try { stats = await comfyJson(baseUrl, "/system_stats", undefined, 5_000); }
  catch { throw new Error("ComfyUI non è raggiungibile. Attendi lo stato Operativo nella chat Image."); }
  const device = stats.devices?.[0];

  // Il LoRA è verificabile solo se ComfyUI gira su questo disco; altrimenti lo segnala ComfyUI stesso.
  if (request.flow === "viggle" && await exists(path.join(options.comfyRoot, "main.py"))) {
    const loraPath = path.join(options.comfyRoot, "models", "loras", path.basename(request.lora));
    if (!await exists(loraPath)) throw new Error(`LoRA Viggle non trovato in ${loraPath}. Scaricalo in models/loras, copia viggle_turbo.py in custom_nodes e riavvia ComfyUI.`);
  }

  const uploadStart = Date.now();
  const referenceName = request.reference ? await uploadReference(baseUrl, request.reference) : undefined;
  const uploadMs = Date.now() - uploadStart;
  const { workflow, outputNode, samplerNode } = buildWorkflow(request, referenceName);
  const clientId = randomUUID();
  const report = (progress: ImageProgress) => options.onProgress?.(progress);
  // I nodi 20+ (esempio, LoRA img2img) girano prima del campionatore.
  const afterSampler = (node: string) => Number(node) > Number(samplerNode) && Number(node) < 20;
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
        if (message.type === "progress" && typeof data.value === "number" && typeof data.max === "number") { marks.firstStep ??= Date.now(); marks.lastStep = Date.now(); report({ phase: "sampling", value: data.value, max: data.max }); }
        else if (message.type === "executing" && data.node) {
          marks.execStart ??= Date.now();
          if (data.node === samplerNode) marks.sampling ??= Date.now();
          else if (afterSampler(data.node)) marks.decoding ??= Date.now();
          if (data.node === samplerNode) report({ phase: "sampling", value: 0, max: request.flow === "viggle" ? VIGGLE_STEPS : request.steps });
          else if (afterSampler(data.node)) report({ phase: "decoding", value: 1, max: 1 });
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
    marks.submitted = Date.now();
    try { promptId = (await comfyJson<{ prompt_id: string }>(baseUrl, "/prompt", { prompt: workflow, client_id: clientId })).prompt_id; }
    catch (error) {
      if (request.flow === "viggle") throw new Error(`ComfyUI ha rifiutato il flusso Viggle (${error instanceof Error ? error.message : error}). Verifica che il LoRA sia in models/loras e viggle_turbo.py in custom_nodes DELL'ISTANZA ComfyUI, poi riavviala.`);
      throw error;
    }
    // Se ComfyUI ha già iniziato (messaggi WebSocket arrivati prima della risposta) non si torna "in coda".
    if (!marks.execStart) report({ phase: "queued", value: 0, max: 1 });
    const onAbort = () => { void cancelPrompt(baseUrl, promptId); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      let pollFailures = 0;
      for (;;) {
        if (signal.aborted) throw new Error(signal.reason instanceof Error ? signal.reason.message : "Generazione annullata.");
        let history: Record<string, { status?: { status_str?: string; messages?: Array<[string, { timestamp?: number; nodes?: string[] }]> }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> }>;
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
          marks.done = Date.now();
          await collectImage(baseUrl, options.comfyRoot, image, options.outputPath);
          marks.collected = Date.now();
          const after = await comfyJson<ComfyStats>(baseUrl, "/system_stats", undefined, 5_000).catch(() => ({} as ComfyStats));
          const deviceAfter = after.devices?.[0];
          const fileBytes = await fs.stat(options.outputPath).then(stat => stat.size, () => 0);
          const events = entry.status?.messages ?? [];
          const at = (type: string) => events.find(([name]) => name === type)?.[1];
          const cached = at("execution_cached")?.nodes ?? [];
          const execStart = at("execution_start")?.timestamp, execEnd = at("execution_success")?.timestamp;
          const steps = request.flow === "viggle" ? VIGGLE_STEPS : request.steps;
          const samplingMs = marks.decoding && marks.sampling ? marks.decoding - marks.sampling : undefined;
          const stepMs = marks.firstStep && marks.lastStep && steps > 1 ? (marks.lastStep - marks.firstStep) / (steps - 1) : undefined;
          const system = stats.system ?? {};
          const sampler = (workflow as Record<string, { inputs: Record<string, unknown> }>)[samplerNode]?.inputs ?? {};
          const row = (group: string, label: string, value: unknown): LogRow => ({ group, label, value: value === undefined || value === "" ? "n/d" : String(value) });
          const log: LogRow[] = [
            row("Richiesta", "Prompt", request.prompt),
            row("Richiesta", "Flusso", request.flow === "viggle" ? "Viggle Turbo (LoRA 6 passi)" : "Qwen-Image 2.1"),
            row("Richiesta", "Modalità", referenceName ? "img2img (da esempio)" : "text2img"),
            row("Richiesta", "Formato", `${request.width}×${request.height}`),
            row("Richiesta", "Seed", request.seed),
            row("Campionamento", "Nodo", samplerNode in workflow ? (workflow as Record<string, { class_type: string }>)[samplerNode].class_type : ""),
            row("Campionamento", "Passi", steps),
            row("Campionamento", "Sampler", sampler.sampler_name ?? "euler"),
            row("Campionamento", "Scheduler", sampler.scheduler ?? (request.flow === "viggle" ? `sigma Viggle ${VIGGLE_SIGMAS}` : "")),
            row("Campionamento", "CFG", sampler.cfg ?? "— (BasicGuider)"),
            row("Campionamento", "Denoise", referenceName ? request.denoise ?? 0.6 : 1),
            row("Modelli", "UNet", "qwen_image_2.1_Q5_K_M.gguf"),
            row("Modelli", "Text encoder", "qwen3vl_8b_w4a8.safetensors"),
            row("Modelli", "VAE", "qwen_image_2.1_vae_bf16.safetensors"),
            ...(request.flow === "viggle" ? [row("Modelli", "LoRA", `${path.basename(request.lora)} · forza 1.0`)] : []),
            ...(referenceName ? [
              row("Esempio", "File su ComfyUI", referenceName),
              row("Esempio", "Peso", size(Buffer.byteLength(request.reference!.split(",")[1] ?? "", "base64"))),
              row("Esempio", "Adattamento", `lanczos → ${request.width}×${request.height}, ritaglio centrale`),
              row("Esempio", "Caricamento", sec(uploadMs)),
            ] : []),
            row("Tempi", "Totale", sec(marks.collected - t0)),
            row("Tempi", "Attesa in coda", execStart ? sec(execStart - marks.submitted) : marks.execStart ? sec(marks.execStart - marks.submitted) : undefined),
            row("Tempi", "Caricamento modelli/encode", marks.sampling && (execStart || marks.execStart) ? sec(marks.sampling - (execStart ?? marks.execStart)) : undefined),
            row("Tempi", "Campionamento", samplingMs !== undefined ? sec(samplingMs) : undefined),
            row("Tempi", "Per passo", stepMs !== undefined ? `${sec(stepMs)} (${(1000 / stepMs).toFixed(2)} it/s)` : undefined),
            row("Tempi", "Decodifica VAE + salvataggio", marks.decoding ? sec((execEnd ?? marks.done) - marks.decoding) : undefined),
            row("Tempi", "Esecuzione ComfyUI", execStart && execEnd ? sec(execEnd - execStart) : undefined),
            row("Tempi", "Recupero file", sec(marks.collected - marks.done)),
            row("Tempi", "Nodi in cache", cached.length ? cached.join(", ") : "nessuno"),
            row("Sistema", "Dispositivo", `${device?.name ?? "n/d"} (${device?.type ?? "n/d"})`),
            row("Sistema", "VRAM prima", `${gb(device?.vram_free)} liberi / ${gb(device?.vram_total)}`),
            row("Sistema", "VRAM dopo", `${gb(deviceAfter?.vram_free)} liberi / ${gb(deviceAfter?.vram_total)}`),
            row("Sistema", "VRAM torch dopo", `${gb(deviceAfter?.torch_vram_free)} liberi / ${gb(deviceAfter?.torch_vram_total)}`),
            row("Sistema", "RAM", `${gb(system.ram_free as number)} liberi / ${gb(system.ram_total as number)}`),
            row("Sistema", "ComfyUI", system.comfyui_version),
            row("Sistema", "PyTorch", system.pytorch_version),
            row("Sistema", "Python", String(system.python_version ?? "").split(" ")[0]),
            row("Sistema", "Avvio ComfyUI", Array.isArray(system.argv) ? (system.argv as string[]).slice(1).join(" ") || "default" : undefined),
            row("Job", "Prompt ID", promptId),
            row("Job", "Client ID", clientId),
            row("Job", "Esito", entry.status?.status_str ?? "success"),
            row("Job", "File ComfyUI", `${image.type ?? "output"}/${image.subfolder ? image.subfolder + "/" : ""}${image.filename}`),
            row("Job", "Peso PNG", size(fileBytes)),
            ...describeWorkflow(workflow),
          ];
          return { device: device?.type || "sconosciuto", deviceName: device?.name || "sconosciuto", log, workflow };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally { signal.removeEventListener("abort", onAbort); }
  } finally { socket?.close(); }
}
