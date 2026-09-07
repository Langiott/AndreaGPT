import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { enrichModel, FALLBACK_MODELS } from "./models";

const app = express();
const port = Number(process.env.PORT) || 3000;
const apiBase = (process.env.NVIDIA_API_BASE || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
const configuredApiKey = process.env.NVIDIA_API_KEY?.trim();
const apiKey = configuredApiKey && configuredApiKey !== "nvapi-inserisci-la-tua-chiave" ? configuredApiKey : undefined;
const configuredOpenRouterKey = process.env.OPENROUTER_API_KEY?.trim();
const openRouterKey = configuredOpenRouterKey && configuredOpenRouterKey !== "sk-or-inserisci-la-tua-chiave" ? configuredOpenRouterKey : undefined;
const openRouterBase = "https://openrouter.ai/api/v1";
const supportedChatModels = [
  "minimaxai/minimax-m3",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-3-super-120b-a12b",
];
const unavailableModels = new Set<string>();

app.disable("x-powered-by");
app.use(cors({ origin: process.env.NODE_ENV === "production" ? false : true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, configured: Boolean(apiKey || openRouterKey), providers: { nvidia: Boolean(apiKey), openrouter: Boolean(openRouterKey) } });
});

app.get("/api/models", async (_request, response) => {
  if (!apiKey && !openRouterKey) {
    response.json({ models: [], source: "none", configured: false });
    return;
  }

  const [nvidiaModels, openRouterModels] = await Promise.all([loadNvidiaModels(), loadOpenRouterModels()]);
  response.json({ models: [...openRouterModels, ...nvidiaModels], source: "providers", configured: true });
});

const chatSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string().min(1).max(100_000) })).min(1).max(100),
  temperature: z.number().min(0).max(2).default(0.6),
  maxTokens: z.number().int().min(1).max(8192).default(2048),
});

app.post("/api/chat", async (request, response) => {
  const parsed = chatSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Richiesta non valida.", details: parsed.error.flatten() });
    return;
  }

  const usesOpenRouter = parsed.data.model.endsWith(":free");
  const provider = usesOpenRouter ? "OpenRouter" : "NVIDIA";
  const selectedApiKey = usesOpenRouter ? openRouterKey : apiKey;
  if (!selectedApiKey) {
    response.status(503).json({ error: `${provider} non è configurato nel file .env.` });
    return;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60_000);
  request.on("aborted", () => controller.abort());
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  try {
    const upstream = await fetch(`${usesOpenRouter ? openRouterBase : apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${selectedApiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(usesOpenRouter ? { "HTTP-Referer": "http://localhost:3000", "X-Title": "AndreaGPT" } : {}),
      },
      body: JSON.stringify({
        model: parsed.data.model,
        messages: parsed.data.messages,
        temperature: parsed.data.temperature,
        max_tokens: parsed.data.maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error(`${provider} chat API ${upstream.status}:`, detail);
      if (upstream.status === 404) unavailableModels.add(parsed.data.model);
      response.status(upstream.status).json({ error: readableApiError(upstream.status, provider, detail) });
      return;
    }

    if (!upstream.body) {
      response.status(502).json({ error: `${provider} non ha restituito uno stream valido.` });
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(value);
    }
    response.end();
  } catch (error) {
    if (timedOut) {
      if (!response.headersSent) response.status(504).json({ error: "Il modello non ha risposto entro 60 secondi. Scegline un altro e riprova." });
      else response.end();
      return;
    }
    if (controller.signal.aborted) return;
    console.error(`Errore durante la richiesta ${provider}:`, error);
    if (!response.headersSent) response.status(502).json({ error: `${provider} non raggiungibile. Controlla connessione e configurazione.` });
    else response.end();
  } finally {
    clearTimeout(timeout);
  }
});

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(currentDirectory, "../dist");
app.use(express.static(distPath));
app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) {
    response.status(404).json({ error: "Endpoint non trovato." });
    return;
  }
  if (request.method === "GET") {
    response.sendFile(path.join(distPath, "index.html"));
    return;
  }
  next();
});

app.listen(port, "0.0.0.0", () => {
  console.log(`AndreaGPT disponibile su http://localhost:${port}`);
  if (!apiKey && !openRouterKey) console.warn("Nessuna API key configurata: la chat resterà disabilitata.");
});

function readableApiError(status: number, provider: string, detail = "") {
  if (status === 401 || status === 403) return `Chiave ${provider} non valida o senza accesso al modello.`;
  if (status === 404) return "Il modello selezionato non è disponibile per questo account.";
  if (status === 429 && /temporarily rate-limited|upstream_provider_shared_pool/i.test(detail)) {
    return "Questo modello gratuito è momentaneamente affollato. Scegli un altro modello e riprova.";
  }
  if (status === 429) return `Limite gratuito ${provider} raggiunto. Scegli un altro modello o riprova più tardi.`;
  return `${provider} ha restituito un errore (${status}).`;
}

async function loadNvidiaModels() {
  if (!apiKey) return [];
  try {
    const upstream = await fetch(`${apiBase}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) throw new Error(`NVIDIA models API: ${upstream.status}`);
    const payload = (await upstream.json()) as { data?: Array<{ id?: string }> };
    const catalogIds = new Set((payload.data ?? []).map((item) => item.id).filter(Boolean));
    return supportedChatModels.filter((id) => catalogIds.has(id) && !unavailableModels.has(id)).map(enrichModel);
  } catch (error) {
    console.error("Impossibile aggiornare il catalogo NVIDIA:", error);
    return FALLBACK_MODELS;
  }
}

async function loadOpenRouterModels() {
  if (!openRouterKey) return [];
  try {
    const upstream = await fetch(`${openRouterBase}/models`, {
      headers: { Authorization: `Bearer ${openRouterKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) throw new Error(`OpenRouter models API: ${upstream.status}`);
    const payload = (await upstream.json()) as {
      data?: Array<{ id?: string; name?: string; description?: string; context_length?: number }>;
    };
    return (payload.data ?? [])
      .filter((item): item is { id: string; name?: string; description?: string; context_length?: number } => Boolean(item.id?.endsWith(":free")) && !unavailableModels.has(item.id!))
      .map((item) => ({
        ...enrichModel(item.id),
        name: item.name?.replace(/\s*\(free\)$/i, "") || enrichModel(item.id).name,
        provider: `OpenRouter · ${item.id.split("/")[0]}`,
        description: item.description || "Modello gratuito disponibile tramite OpenRouter.",
        tags: ["Gratis", "OpenRouter"],
        context: formatContext(item.context_length),
      }))
      .sort((a, b) => Number(!/deepseek|glm/i.test(a.id)) - Number(!/deepseek|glm/i.test(b.id)) || a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Impossibile aggiornare il catalogo OpenRouter:", error);
    return [];
  }
}

function formatContext(tokens?: number) {
  if (!tokens) return undefined;
  return tokens >= 1_000_000 ? `${Math.round(tokens / 1_000_000)}M` : `${Math.round(tokens / 1_000)}K`;
}
