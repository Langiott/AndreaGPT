import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  Code2,
  Database,
  Eye,
  Info,
  Menu,
  MessageSquarePlus,
  FileText,
  Folder,
  Globe2,
  Image,
  Paperclip,
  PanelLeftClose,
  PenTool,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mascotUrl from "../img/mascotte-no-sfondo.png";
import { MASCOT_QUOTES, QUICK_PROMPTS, QUOTE_INTERVAL_MS, TASKS } from "./data";
import { BrainPanel } from "./BrainPanel";
import { UniverseBackground } from "./UniverseBackground";
import { AppearanceSettings, fonts, useAppearance } from "./AppearanceSettings";
import type { BrainCitation, ChatAttachment, ChatMessage, ChatSettings, Conversation, ModelInfo } from "./types";

const iconByName = {
  sparkles: Sparkles,
  code: Code2,
  brain: BrainCircuit,
  chart: Database,
  pen: PenTool,
  eye: Eye,
};

const initialSettings: ChatSettings = { temperature: 0.6, maxTokens: 2048, ollamaMaxTokens: 512 };
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_SIZE = 12 * 1024 * 1024;
const TEXT_FILE_EXTENSIONS = new Set(["txt", "md", "csv", "json", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "hpp", "sql", "yaml", "yml", "log", "sh", "ps1"]);
type Theme = "cosmic" | "normal";
type YoloTask = "detect" | "segment" | "classify" | "pose" | "obb";
interface CustomInstruction { id: string; title: string; text: string; enabled: boolean }

const DEFAULT_INSTRUCTIONS: CustomInstruction[] = [
  { id: "generali", title: "Generali", enabled: true, text: "Rispondi in italiano.\nSii chiaro, concreto e accurato.\nNiente parolacce o frasi volgari non richieste." },
  { id: "brain", title: "Brain", enabled: true, text: "Usa solo fonti pertinenti.\nCita solo cio che supporta davvero la risposta.\nNon inventare se le fonti sono parziali." },
  { id: "caveman", title: "Caveman", enabled: true, text: "Usa meno fonti.\nScarta fonti strane o incoerenti.\nRispondi in modo semplice e diretto." },
  { id: "codice", title: "Codice", enabled: true, text: "Produci codice completo, sicuro e leggibile.\nSpiega le decisioni importanti.\nIncludi test e comandi quando servono." },
];

export default function App() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [taskId, setTaskId] = useState("general");
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeConversationId, setActiveConversationId] = useState(() => loadActiveConversationId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadActiveMessages());
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [specialMode, setSpecialMode] = useState<"normal" | "ocr" | "yolo">("normal");
  const [yoloTask, setYoloTask] = useState<YoloTask>("detect");
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => localStorage.getItem("andreagpt-web-search") === "true");
  const [brainEnabled, setBrainEnabled] = useState(() => {
    if (localStorage.getItem("andreagpt-brain-default-v2") !== "1") {
      localStorage.setItem("andreagpt-brain-default-v2", "1");
      localStorage.setItem("andreagpt-brain-enabled", "true");
      return true;
    }
    return localStorage.getItem("andreagpt-brain-enabled") !== "false";
  });
  const [brainSource, setBrainSource] = useState("");
  const [brainPaths, setBrainPaths] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [cavemanEnabled, setCavemanEnabled] = useState(() => localStorage.getItem("andreagpt-caveman-enabled") === "true");
  const [brainOpen, setBrainOpen] = useState(false);
  const appearance = useAppearance();
  const [brainInfoOpen, setBrainInfoOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [webAvailable, setWebAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState<CustomInstruction[]>(() => loadCustomInstructions());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(initialSettings);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * MASCOT_QUOTES.length));
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("andreagpt-theme") === "normal" ? "normal" : "cosmic");
  const [historyCollapsed, setHistoryCollapsed] = useState(() => localStorage.getItem("andreagpt-history-collapsed") === "true");
  const [modelsCollapsed, setModelsCollapsed] = useState(() => localStorage.getItem("andreagpt-models-collapsed") === "true");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];
  const brainPrivate = brainEnabled || messages.some((message) => message.brainPrivate) || Boolean(conversations.find((c) => c.id === activeConversationId)?.brainPrivate);
  const isOllama = selectedModel?.providerId === "ollama";
  const selectedTask = TASKS.find((task) => task.id === taskId) ?? TASKS[0];
  const filteredModels = models.filter((model) => {
    const term = search.toLowerCase();
    return `${model.name} ${model.id} ${model.provider} ${model.tags.join(" ")}`.toLowerCase().includes(term);
  });
  const estimatedTokens = Math.ceil(messages.reduce((total, message) => total + message.content.length, 0) / 4);
  const mentionSuggestions = brainPaths.filter(path => path.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8);
  const mentionActive = /(?:^|\s)@[^\s]*$/u.test(input);

  function updateChatInput(value: string) {
    setInput(value); resizeInput(value);
    const match = value.match(/(?:^|\s)@([^\s]*)$/u);
    setMentionQuery(match?.[1] ?? "");
  }

  function chooseMention(path: string) {
    const value = input.replace(/@[^\s]*$/u, `@${path} `);
    updateChatInput(value);
    textareaRef.current?.focus();
  }

  useEffect(() => { fetch("/api/brain/status").then(r => r.ok ? r.json() : null).then(data => setBrainPaths((data?.sources ?? []).map((s: { id: string }) => s.id))).catch(() => {}); }, []);

  function refreshHealth() {
    void readHealth()
      .then((health) => setWebAvailable(Boolean(health.providers?.web ?? health.providers?.searxng ?? true)))
      .catch(() => setWebAvailable(null));
  }

  useEffect(() => {
    fetch("/api/models")
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalogo non disponibile");
        return response.json() as Promise<{ models: ModelInfo[]; configured: boolean }>;
      })
      .then((data) => {
        setModels(data.models);
        setConfigured(data.configured);
        const saved = localStorage.getItem("andreagpt-model");
        setSelectedModelId(data.models.some((model) => model.id === saved) ? saved! : data.models[0]?.id ?? "");
      })
      .catch(() => setError("Impossibile caricare il catalogo dei modelli."))
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    refreshHealth();
    const timer = window.setInterval(refreshHealth, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuoteIndex((current) => (current + 1 + Math.floor(Math.random() * (MASCOT_QUOTES.length - 1))) % MASCOT_QUOTES.length);
    }, QUOTE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    persistMessages("andreagpt-messages", messages);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!activeConversationId || !messages.length) return;
    setConversations((current) => {
      const existing = current.find((item) => item.id === activeConversationId);
      const title = existing?.customTitle
        ? existing.title
        : createConversationTitleFromMessages(messages);
      const conversation: Conversation = { id: activeConversationId, title, customTitle: existing?.customTitle, brainPrivate: existing?.brainPrivate || messages.some((m) => m.brainPrivate), messages, modelId: selectedModelId, updatedAt: Date.now() };
      const exists = Boolean(existing);
      return exists
        ? current.map((item) => item.id === activeConversationId ? conversation : item)
        : [conversation, ...current];
    });
  }, [activeConversationId, messages, selectedModelId]);

  useEffect(() => {
    persistConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (!brainPrivate) return;
    setWebSearchEnabled(false);
    const local = models.find((model) => model.providerId === "ollama" && model.tags.includes("Veloce"))
      ?? models.find((model) => model.providerId === "ollama");
    if (local) setSelectedModelId(local.id);
  }, [brainPrivate, models]);

  useEffect(() => {
    if (activeConversationId) localStorage.setItem("andreagpt-active-conversation", activeConversationId);
    else localStorage.removeItem("andreagpt-active-conversation");
  }, [activeConversationId]);

  useEffect(() => {
    if (selectedModelId) localStorage.setItem("andreagpt-model", selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    localStorage.setItem("andreagpt-web-search", String(webSearchEnabled));
  }, [webSearchEnabled]);

  useEffect(() => {
    localStorage.setItem("andreagpt-brain-enabled", String(brainEnabled));
  }, [brainEnabled]);

  useEffect(() => {
    localStorage.setItem("andreagpt-caveman-enabled", String(cavemanEnabled));
  }, [cavemanEnabled]);

  useEffect(() => {
    localStorage.setItem("andreagpt-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "cosmic" ? "#FFF8E7" : "#080A08");
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("andreagpt-history-collapsed", String(historyCollapsed));
    localStorage.setItem("andreagpt-models-collapsed", String(modelsCollapsed));
  }, [historyCollapsed, modelsCollapsed]);

  useEffect(() => {
    localStorage.setItem("andreagpt-custom-instructions", JSON.stringify(customInstructions));
  }, [customInstructions]);

  useEffect(() => {
    const disableContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", disableContextMenu);
    return () => document.removeEventListener("contextmenu", disableContextMenu);
  }, []);

  function chooseTask(nextTaskId: string) {
    setTaskId(nextTaskId);
    setTaskMenuOpen(false);
    const task = TASKS.find((item) => item.id === nextTaskId);
    if (!brainPrivate && task?.suggestedModel && models.some((model) => model.id === task.suggestedModel)) {
      setSelectedModelId(task.suggestedModel);
    }
  }

  function chooseModel(id: string) {
    if (loading || (brainPrivate && models.find((model) => model.id === id)?.providerId !== "ollama")) return;
    setSelectedModelId(id);
    setSidebarOpen(false);
  }

  function setBrainMode(enabled: boolean) {
    if (loading) return;
    setBrainEnabled(enabled);
    if (enabled) {
      setWebSearchEnabled(false);
      const local = models.find((model) => model.providerId === "ollama" && model.tags.includes("Veloce"))
        ?? models.find((model) => model.providerId === "ollama");
      if (local) setSelectedModelId(local.id);
      setMessages((current) => current.map((message) => ({ ...message, brainPrivate: true })));
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setLoading(false);
    setMessages([]);
    setActiveConversationId("");
    setInput("");
    setAttachments([]);
    setError("");
    setSpecialMode("normal");
    textareaRef.current?.focus();
  }

  function openConversation(conversation: Conversation) {
    abortRef.current?.abort();
    setLoading(false);
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setBrainEnabled(Boolean(conversation.brainPrivate));
    setAttachments([]);
    setError("");
    setSpecialMode(/^OCR \d+$/i.test(conversation.title) ? "ocr" : /^YOLO \d+$/i.test(conversation.title) ? "yolo" : "normal");
    if (models.some((model) => model.id === conversation.modelId)) setSelectedModelId(conversation.modelId);
    setSidebarOpen(false);
  }

  function deleteConversation(id: string) {
    if (loading) return;
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (id === activeConversationId) {
      const next = remaining[0];
      setBrainEnabled(Boolean(next?.brainPrivate));
      setActiveConversationId(next?.id ?? "");
      setMessages(next?.messages ?? []);
      setSpecialMode(next?.title.match(/^OCR \d+$/i) ? "ocr" : next?.title.match(/^YOLO \d+$/i) ? "yolo" : "normal");
      setAttachments([]);
      if (next && models.some((model) => model.id === next.modelId)) setSelectedModelId(next.modelId);
    }
  }

  function renameConversation(id: string) {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    const title = window.prompt("Nuovo titolo della conversazione", conversation.title)?.trim();
    if (!title) return;
    setConversations((current) => current.map((item) => item.id === id ? { ...item, title: title.slice(0, 60), customTitle: true } : item));
  }

  async function sendMessage(text = input) {
    const content = text.trim();
    if ((!content && !attachments.length) || loading || !selectedModel) return;
    if (specialMode === "ocr") { await processOcrBatch(); return; }
    if (specialMode === "yolo") { await processYoloBatch(); return; }
    if (brainPrivate && (!isOllama || webSearchEnabled)) { setError("Brain e cronologia privata possono usare solo Ollama, senza web."); return; }
    if (isOllama && [...messages.flatMap((m) => m.attachments || []), ...attachments].some((a) => a.kind !== "text")) { setError("Ollama accetta solo testo. Questa conversazione contiene immagini/PDF: avvia una nuova chat o usa testo estratto."); return; }

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content, attachments, webSearch: webSearchEnabled, brainPrivate };
    const mentionedSource = content.match(/(?:^|\s)@([^\s]+(?:\/[^\s]+)*)/u)?.[1] || brainSource;
    const conversationId = activeConversationId || crypto.randomUUID();
    if (!activeConversationId) setActiveConversationId(conversationId);
    const assistantId = crypto.randomUUID();
    const history = [...messages, userMessage];
    const attachmentMessageIndex = findLastAttachmentMessageIndex(history);
    setMessages([...history, { id: assistantId, role: "assistant", content: "", brainPrivate }]);
    setInput("");
    setAttachments([]);
    setError("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel.id,
          provider: selectedModel.providerId,
          conversationId,
          brain: brainEnabled,
          brainPrivate,
          brainSource: mentionedSource || undefined,
          caveman: cavemanEnabled,
          messages: [
            { role: "system", content: [selectedTask.prompt, renderCustomInstructions(customInstructions)].filter(Boolean).join("\n\n") },
            ...history.filter((message) => message.content || message.attachments?.length).map((message) => ({ ...toApiMessage(message, history.indexOf(message) === attachmentMessageIndex), brainPrivate: message.brainPrivate })),
          ],
          ...settings,
          temperature: brainEnabled ? Math.min(settings.temperature, 0.3) : settings.temperature,
          maxTokens: isOllama ? settings.ollamaMaxTokens ?? 512 : settings.maxTokens,
          numCtx: settings.numCtx ?? (isOllama ? Number(selectedModel.context) || 4096 : 4096),
          webSearch: webSearchEnabled,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 404 && !isOllama) {
          setModels((current) => current.filter((model) => model.id !== selectedModel.id));
          setSelectedModelId((current) => current === selectedModel.id ? "" : current);
        }
        throw new Error(body.error || `Errore HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Risposta streaming non disponibile.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const data = line.trim().replace(/^data:\s*/, "");
          if (!data || data === "[DONE]") continue;
          let event: { choices?: Array<{ delta?: { content?: string } }>; brainSources?: BrainCitation[]; metrics?: Record<string, number>; error?: string };
          try { event = JSON.parse(data); } catch { continue; }
            if (event.error) throw new Error(event.error);
            if (event.metrics) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, metrics: event.metrics } : message));
            if (Array.isArray(event.brainSources)) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, brainSources: event.brainSources } : message));
            const token = event.choices?.[0]?.delta?.content ?? "";
            if (token) {
              fullText += token;
              setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: fullText } : message));
            }
        }
        if (done) break;
      }
      if (!fullText) throw new Error("Il modello non ha restituito contenuto.");
    } catch (caught) {
      if ((caught as Error).name === "AbortError") {
        setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
      } else {
        setMessages((current) => current.filter((message) => message.id !== assistantId));
        setError(caught instanceof Error ? caught.message : "Si è verificato un errore.");
      }
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  function resizeInput(value: string) {
    setInput(value);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    }
  }

  async function addAttachments(files: FileList | File[]) {
    const selectedFiles = Array.from(files);
    if (!selectedFiles.length) return;
    const availableSlots = MAX_ATTACHMENTS - attachments.length;
    if (availableSlots <= 0) {
      setError(`Puoi allegare al massimo ${MAX_ATTACHMENTS} file per messaggio.`);
      return;
    }

    const nextFiles = selectedFiles.slice(0, availableSlots);
    const currentSize = attachments.reduce((total, attachment) => total + attachment.size, 0);
    if (nextFiles.some((file) => file.size > MAX_ATTACHMENT_SIZE)) {
      setError("Ogni allegato può pesare al massimo 5 MB.");
      return;
    }
    if (currentSize + nextFiles.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENTS_SIZE) {
      setError("Gli allegati del messaggio possono pesare al massimo 12 MB in totale.");
      return;
    }

    try {
      const loaded = await Promise.all(nextFiles.map(readAttachment));
      if (specialMode === "normal" && isOllama && loaded.some((a) => a.kind !== "text")) throw new Error("Il modello Ollama non ha multimodalita verificata: allega solo testo/codice.");
      setAttachments((current) => [...current, ...loaded]);
      setError(selectedFiles.length > availableSlots ? `Sono stati aggiunti solo i primi ${availableSlots} file.` : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossibile leggere uno degli allegati.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function openSpecialChat(mode: "ocr" | "yolo") {
    abortRef.current?.abort();
    setLoading(false); setMessages([]); setAttachments([]); setInput(""); setError(""); setBrainEnabled(false); setSpecialMode(mode);
    if (mode === "yolo") setYoloTask("detect");
    const prefix = mode === "ocr" ? "OCR" : "YOLO";
    const nextNumber = conversations.reduce((max, conversation) => {
      const match = conversation.title.match(new RegExp(`^${prefix} (\\d+)$`, "i"));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const id = crypto.randomUUID();
    const title = `${prefix} ${nextNumber}`;
    setActiveConversationId(id);
    setConversations((current) => [{ id, title, customTitle: true, messages: [], modelId: selectedModelId, updatedAt: Date.now() }, ...current]);
    textareaRef.current?.focus();
  }

  async function processOcrBatch() {
    if (!attachments.length) { setError("OCR: allega una o più immagini o PDF."); return; }
    const pending = attachments;
    if (!activeConversationId) setActiveConversationId(crypto.randomUUID());
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: "Esegui OCR sugli allegati.", attachments: pending }, { id: assistantId, role: "assistant", content: "Elaborazione OCR in corso…" }]);
    setAttachments([]); setInput(""); setError(""); setLoading(true);
    try {
      const results: string[] = [];
      for (const attachment of pending) {
        if (!attachment.dataUrl) continue;
        const response = await fetch("/api/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: attachment.name, type: attachment.type, data: attachment.dataUrl }) });
        const result = await response.json() as { text?: string; error?: string; output?: string };
        if (!response.ok) throw new Error(result.error || `OCR non riuscito per ${attachment.name}.`);
        results.push(`### ${attachment.name}\n${result.text || "Nessun testo riconosciuto."}\n\n_Risultato salvato in ${result.output || "OCR/output"}._`);
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: results.join("\n\n") } : message));
      }
    } catch (caught) { setMessages((current) => current.filter((message) => message.id !== assistantId)); setError(caught instanceof Error ? caught.message : "OCR non riuscito."); }
    finally { setLoading(false); }
  }

  async function processYoloBatch() {
    const pending = attachments.filter((attachment) => attachment.kind === "image" && attachment.dataUrl);
    if (!pending.length) { setError("YOLO: allega una o più immagini."); return; }
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: "Analizza gli elementi nelle immagini con YOLO.", attachments }, { id: assistantId, role: "assistant", content: "Analisi YOLO in corso…" }]);
    setAttachments([]); setInput(""); setError(""); setLoading(true);
    try {
      const results: string[] = [];
      for (const attachment of pending) {
        const response = await fetch("/api/yolo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: attachment.name, type: attachment.type, task: yoloTask, data: attachment.dataUrl }) });
        const result = await response.json() as { text?: string; error?: string };
        if (!response.ok) throw new Error(result.error || `YOLO non riuscito per ${attachment.name}.`);
        results.push(`### ${attachment.name}\n${result.text || "Nessun elemento rilevato."}`);
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: results.join("\n\n") } : message));
      }
    } catch (caught) { setMessages((current) => current.filter((message) => message.id !== assistantId)); setError(caught instanceof Error ? caught.message : "Analisi YOLO non riuscita."); }
    finally { setLoading(false); }
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><img src="/andreagpt-logo.png" alt="" /></div>
          <div><strong>AndreaGPT</strong></div>
          <button className="icon-button close-mobile" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu"><X size={19} /></button>
        </div>

        <button className="new-chat" onClick={newChat}><MessageSquarePlus size={18} /> Nuova conversazione</button>

        <div className={`sidebar-section history-section ${historyCollapsed ? "collapsed" : ""}`}>
          <button className="section-heading" onClick={() => setHistoryCollapsed((value) => !value)} aria-expanded={!historyCollapsed}>
            <span>Conversazioni</span><span className="section-summary"><span className="count">{conversations.length}</span><ChevronDown size={14} /></span>
          </button>
          {!historyCollapsed && <div className="conversation-history">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`history-row ${conversation.id === activeConversationId ? "selected" : ""}`}
                onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); renameConversation(conversation.id); }}
              >
                <button className="history-open" onClick={() => openConversation(conversation)} title={`${conversation.title} · Tasto destro per rinominare`}>{conversation.title}</button>
                <button className="history-delete" onClick={() => deleteConversation(conversation.id)} aria-label={`Elimina ${conversation.title}`}><Trash2 size={13} /></button>
              </div>
            ))}
            {!conversations.length && <p className="empty-history">Le conversazioni salvate appariranno qui.</p>}
          </div>}
        </div>

        <div className={`sidebar-section model-section ${modelsCollapsed ? "collapsed" : ""}`}>
          <button className="section-heading" onClick={() => setModelsCollapsed((value) => !value)} aria-expanded={!modelsCollapsed}>
            <span>Modelli</span><span className="section-summary"><span className="count">{models.length}</span><ChevronDown size={14} /></span>
          </button>
          {!modelsCollapsed && <>
          <label className="search-box">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca un modello..." />
            {search && <button onClick={() => setSearch("")} aria-label="Cancella ricerca"><X size={14} /></button>}
          </label>
          <div className="model-list">
            {modelsLoading && <div className="loading-list"><span /><span /><span /></div>}
            {!modelsLoading && filteredModels.map((model) => (
              <button key={model.id} disabled={loading || (brainPrivate && model.providerId !== "ollama")} className={`model-row ${model.id === selectedModel?.id ? "selected" : ""}`} onClick={() => chooseModel(model.id)}>
                <span className="provider-avatar">{model.provider.slice(0, 1).toUpperCase()}</span>
                <span className="model-copy"><strong>{model.name}</strong><small>{model.provider}</small></span>
                {model.id === selectedModel?.id && <Check size={16} className="selected-check" />}
              </button>
            ))}
            {!modelsLoading && !filteredModels.length && <p className="empty-search">Nessun modello trovato.</p>}
          </div>
          </>}
        </div>

        <div className="sidebar-footer">
          <button className="mascot-balloon" onClick={() => setQuoteIndex((current) => (current + 1) % MASCOT_QUOTES.length)} title="Clicca per un'altra frase" aria-label="Frase della mascotte, clicca per cambiarla">
            <span className="mascot-quote">“{MASCOT_QUOTES[quoteIndex].text}”</span>
            <span className="mascot-author">— {MASCOT_QUOTES[quoteIndex].author}</span>
          </button>
          <img className="sidebar-mascot" src={mascotUrl} alt="Mascotte AndreaGPT" />
          <button className="sidebar-action" onClick={() => setBrainOpen(true)}><Folder size={17} /> Archivio Brain</button>
          <button className="sidebar-action" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /> Impostazioni</button>
          <button className="sidebar-action" onClick={() => setInstructionsOpen(true)}><FileText size={17} /> Istruzioni</button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu" />}

      <main className="main-panel" style={{ "--chat-font": fonts[appearance.preferences.font], "--chat-font-size": `${appearance.preferences.size}px` } as React.CSSProperties}>
        <UniverseBackground key={appearance.pictures.map(picture => picture.id).join("|")} images={appearance.pictures.map(picture => picture.url)} />
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Apri menu"><Menu size={21} /></button>
          <div className="model-title">
            <span className="status-dot" />
            {specialMode === "ocr"
              ? <div><strong>OCR locale</strong><small>Estrazione testo da immagini e PDF</small></div>
              : specialMode === "yolo"
                ? <div><strong>Analisi immagine Yolo</strong><small>Detection, segmentazione e visione</small></div>
                : <div><strong>{selectedModel?.name ?? "Caricamento modelli"}</strong><small>{selectedModel?.provider ?? "NVIDIA"} · Contesto usato: ~{estimatedTokens.toLocaleString("it-IT")} token</small></div>}
          </div>
          <div className="topbar-actions">
            <button className={`brain-mode-button ${brainEnabled ? "active" : ""}`} onClick={() => setBrainMode(!brainEnabled)} disabled={loading} aria-pressed={brainEnabled} title={brainEnabled ? "I documenti Brain vengono consultati" : "Brain spento: i documenti non vengono consultati"}><img className="brain-symbol" src="/brain.png" alt="" /><span>{brainEnabled ? "Brain attivo" : "Brain disattivato"}</span></button>
            <button className={`brain-library-button ocr-button ${specialMode === "ocr" ? "active" : ""}`} onClick={() => openSpecialChat("ocr")} disabled={loading} title="Apri una nuova chat OCR">OCR</button>
            <button className={`brain-library-button yolo-button ${specialMode === "yolo" ? "active" : ""}`} onClick={() => openSpecialChat("yolo")} disabled={loading} title="Apri una nuova chat YOLO">YOLO</button>
            <button className={`caveman-mode-button ${cavemanEnabled ? "active" : ""}`} onClick={() => setCavemanEnabled((enabled) => !enabled)} disabled={loading} aria-pressed={cavemanEnabled} title={cavemanEnabled ? "Caveman attivo: fonti piu severe e risposte dirette" : "Caveman disattivato"}><span>CV</span><strong>{cavemanEnabled ? "Caveman attivo" : "Caveman disattivato"}</strong></button>
            <button className="brain-library-button" onClick={() => setBrainOpen(true)} aria-label="Esplora file Brain" title="Esplora file e progetti"><Folder size={17} /><span>Archivio</span></button>
            <div className="task-selector">
              <button className="task-trigger" onClick={() => setTaskMenuOpen((value) => !value)}>
                <Zap size={15} /> <span>{selectedTask.shortName}</span> <ChevronDown size={15} />
              </button>
              {taskMenuOpen && (
                <div className="task-menu">
                  <div className="popover-heading"><strong>Scegli il task</strong><small>Adatta istruzioni e modello</small></div>
                  {TASKS.map((task) => {
                    const Icon = iconByName[task.icon as keyof typeof iconByName];
                    return <button key={task.id} className={task.id === taskId ? "active" : ""} onClick={() => chooseTask(task.id)}><Icon size={17} /><span><strong>{task.name}</strong><small>{task.description}</small></span>{task.id === taskId && <Check size={15} />}</button>;
                  })}
                </div>
              )}
            </div>
            <button className="icon-button" onClick={() => setDetailsOpen(true)} aria-label="Informazioni modello" disabled={!selectedModel}><Info size={19} /></button>
          </div>
        </header>

        <section className={`conversation ${messages.length ? "has-messages" : ""}`}>
          {!messages.length ? (
            <div className={`welcome${specialMode !== "normal" ? " welcome-plain" : ""}`}>
              {specialMode === "ocr" ? <div className="special-welcome-card"><span className="welcome-kicker">OCR LOCALE</span><h1>Pronto per<br /><em>leggere i tuoi file.</em></h1><p>Allega una o più immagini o PDF. Il testo verrà estratto localmente e salvato nella cartella OCR.</p><button className="special-upload-button" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /> Carica immagini o PDF</button></div> : specialMode === "yolo" ? <div className="special-welcome-card"><span className="welcome-kicker">YOLO VISION</span><h1>Capisco gli<br /><em>elementi nell’immagine.</em></h1><p>Scegli il task, allega una o più immagini e avvia detection, segmentazione, classificazione, pose o OBB.</p><label className="special-task-select">Task YOLO<select value={yoloTask} onChange={(event) => setYoloTask(event.target.value as YoloTask)}><option value="detect">Detection</option><option value="segment">Segmentazione</option><option value="classify">Classificazione</option><option value="pose">Pose</option><option value="obb">Object detection orientata</option></select></label><button className="special-upload-button" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /> Carica immagini</button></div> : <><h1>Ciao Cetriolo,<br /><em>oggi che facciamo?</em></h1><div className="task-grid">{TASKS.slice(0, 4).map((task) => { const Icon = iconByName[task.icon as keyof typeof iconByName]; return <button key={task.id} onClick={() => chooseTask(task.id)} className={task.id === taskId ? "active" : ""}><Icon size={19} /><span><strong>{task.name}</strong><small>{task.description}</small></span></button>; })}</div><div className="quick-row">{QUICK_PROMPTS.map((prompt) => <button key={prompt.label} onClick={() => { setInput(prompt.text); textareaRef.current?.focus(); }}>{prompt.label}</button>)}</div></>}
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-avatar">{message.role === "user" ? <img src="/cetriolo.png" alt="Tu" /> : <img src="/andreagpt-logo.png" alt="AndreaGPT" />}</div>
                  <div className="message-content">
                    <div className="message-meta">{message.role === "user" ? "Tu" : specialMode === "ocr" ? "OCR locale" : specialMode === "yolo" ? "YOLO locale" : selectedModel?.name}{message.webSearch && <span className="web-search-badge"><Globe2 size={10} /> Web</span>}</div>
                    {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
                    {message.content ? specialMode === "ocr" && message.role === "assistant" && !message.content.startsWith("Elaborazione OCR") ? <div className="ocr-result-editor"><textarea value={message.content} onChange={(event) => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, content: event.target.value } : item))} aria-label="Modifica risultato OCR" /><div className="ocr-result-actions"><button onClick={() => saveTextResult(message.content, "risultato-ocr.txt")}>Salva risultato</button></div></div> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={brainPrivate || message.brainPrivate ? { img: ({ alt }) => <span>[Immagine esterna bloccata: {alt || "immagine"}]</span> } : undefined}>{message.content}</ReactMarkdown> : message.role === "assistant" ? brainEnabled ? <div className="thinking">Ricerca nelle fonti Brain…</div> : <div className="thinking"><span /><span /><span /></div> : null}
                    {message.brainSources && <details className="brain-citations" open={!message.brainSources.length}><summary>Fonti Brain recuperate ({message.brainSources.length})</summary>{message.brainSources.length ? message.brainSources.map((source) => <div key={source.id}><strong>[{source.id}] {source.source}</strong><p>{source.text}</p></div>) : <p>Nessuna fonte pertinente trovata nell'indice.</p>}</details>}
                    {message.metrics && <details className="brain-citations"><summary>Tempi e consumo</summary><p>
                      {message.metrics.retrievalMs !== undefined && <>Ricerca: {(message.metrics.retrievalMs / 1000).toFixed(2)} s · </>}
                      {message.metrics.firstTokenMs !== undefined && <>Prima risposta: {(message.metrics.firstTokenMs / 1000).toFixed(1)} s · </>}
                      Totale: {((message.metrics.totalMs ?? 0) / 1000).toFixed(1)} s
                    </p><p>Token in ingresso: {message.metrics.prompt_eval_count ?? "—"} · Token generati: {message.metrics.eval_count ?? "—"}</p></details>}
                  </div>
                </article>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </section>

        <footer className="composer-wrap">
          {error && <div className="error-banner" role="alert" aria-live="assertive"><span><strong>Attenzione</strong>{error}</span><button onClick={() => setError("")} aria-label="Chiudi notifica"><X size={20} /></button></div>}
          {!configured && configured !== null && <div className="config-banner"><Info size={15} /> Verifica il server AndreaGPT. Ollama locale non richiede chiavi cloud.</div>}
          <div className={`composer ${specialMode !== "normal" ? "special-composer" : ""}`}>
            {specialMode !== "normal" && <div className="special-composer-label"><strong>{specialMode === "ocr" ? "OCR locale" : "YOLO locale"}</strong><span>{specialMode === "ocr" ? "Allega immagini o PDF per estrarre testo" : "Allega immagini per rilevare gli elementi"}</span></div>}
            {attachments.length > 0 && <AttachmentList attachments={attachments} removable onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} />}
            <div className="composer-row">
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                multiple
                accept={specialMode === "ocr" ? "image/*,.pdf" : specialMode === "yolo" ? "image/*" : "image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.sql,.yaml,.yml,.log,.sh,.ps1"}
                onChange={(event) => void addAttachments(event.target.files ?? [])}
              />
              <button className="attach-button" onClick={() => fileInputRef.current?.click()} disabled={loading || attachments.length >= MAX_ATTACHMENTS} aria-label="Allega file o immagini" title="Allega file o immagini"><Paperclip size={18} /></button>
              {specialMode === "normal" && <><button className={`web-search-button ${webSearchEnabled ? "active" : ""} ${webAvailable === false ? "unavailable" : ""}`} onClick={() => setWebSearchEnabled((enabled) => !enabled)} disabled={loading || brainPrivate || webAvailable === false} aria-pressed={webSearchEnabled} aria-label="Attiva ricerca web" title="Attiva ricerca web"><Globe2 size={18} /></button><button className={`composer-brain-button ${brainEnabled ? "active" : ""}`} onClick={() => setBrainMode(!brainEnabled)} disabled={loading} aria-pressed={brainEnabled} aria-label="Attiva Brain" title="Attiva Brain"><img src="/brain.png" alt="" /></button></>}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => updateChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={specialMode === "ocr" ? "Allega immagini o PDF per OCR locale..." : specialMode === "yolo" ? "Allega immagini per analisi YOLO..." : "Scrivi un messaggio..."}
                title={brainPaths.length ? `Per filtrare Brain usa @ seguito dal percorso: ${brainPaths.slice(0, 3).join(", ")}` : "Usa @percorso per citare una fonte Brain"}
                rows={1}
              />
              {mentionActive && mentionSuggestions.length > 0 && <div className="mention-suggestions">{mentionSuggestions.map(path => <button type="button" key={path} onClick={() => chooseMention(path)}><span>@</span>{path}</button>)}</div>}
              {loading ? <button className="send-button stop" onClick={stopGeneration} aria-label="Ferma generazione"><Square size={15} fill="currentColor" /></button> : <button className="send-button" onClick={() => void sendMessage()} disabled={(!input.trim() && !attachments.length) || !selectedModel} aria-label="Invia"><Send size={18} /></button>}
            </div>
          </div>
        </footer>
      </main>

      {detailsOpen && selectedModel && (
        <Modal title="Informazioni modello" onClose={() => setDetailsOpen(false)}>
          <div className="model-detail-head"><span className="provider-avatar large">{selectedModel.provider[0].toUpperCase()}</span><div><h2>{selectedModel.name}</h2><code>{selectedModel.id}</code></div></div>
          <p className="detail-description">{selectedModel.description}</p>
          <dl className="detail-grid"><div><dt>Provider</dt><dd>{selectedModel.provider}</dd></div><div><dt>Contesto</dt><dd>{selectedModel.context ?? "Vedi model card"}</dd></div></dl>
          <div className="tag-list">{selectedModel.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          {!isOllama && <a className="external-link" href={selectedModel.providerId === "openrouter" ? `https://openrouter.ai/${selectedModel.id}` : `https://build.nvidia.com/${selectedModel.id}`} target="_blank" rel="noreferrer">Apri la model card ↗</a>}
        </Modal>
      )}

      {brainOpen && <Modal title={<span className="brain-title">Archivio Brain<button className="brain-info-button" aria-label="Informazioni sull'archivio Brain" aria-expanded={brainInfoOpen} aria-controls="brain-info" onClick={() => setBrainInfoOpen(!brainInfoOpen)}><Info size={18} /></button></span>} wide onClose={() => setBrainOpen(false)}><BrainPanel showInfo={brainInfoOpen} locked={loading} source={brainSource} onSource={setBrainSource} /></Modal>}

      {instructionsOpen && (
        <Modal title="Istruzioni" onClose={() => setInstructionsOpen(false)}>
          <div className="instructions-panel editor">
            <p>Le istruzioni attive vengono inviate al modello. La cartella <code>ISTRUZIONI</code> resta come copia fisica leggibile nel progetto.</p>
            <div className="instruction-actions">
              <button onClick={() => setCustomInstructions((current) => [...current, { id: crypto.randomUUID(), title: "Nuova istruzione", text: "", enabled: true }])}>Aggiungi istruzione</button>
              <button onClick={() => setCustomInstructions(DEFAULT_INSTRUCTIONS)}>Ripristina base</button>
            </div>
            <ul className="instruction-list">
              {customInstructions.map((instruction) => (
                <li className={!instruction.enabled ? "disabled" : ""} key={instruction.id}>
                  <details open={!instruction.text.trim()}>
                    <summary>
                      <label className="instruction-enable" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={instruction.enabled} onChange={(event) => setCustomInstructions((current) => current.map((item) => item.id === instruction.id ? { ...item, enabled: event.target.checked } : item))} /> Attiva</label>
                      <strong>{instruction.title.trim() || "Istruzione"}</strong>
                    </summary>
                    <input className="instruction-title" value={instruction.title} onChange={(event) => setCustomInstructions((current) => current.map((item) => item.id === instruction.id ? { ...item, title: event.target.value } : item))} />
                    <textarea value={instruction.text} rows={4} onChange={(event) => setCustomInstructions((current) => current.map((item) => item.id === instruction.id ? { ...item, text: event.target.value } : item))} placeholder={"Scrivi qui le regole, una per riga:\nRispondi in italiano.\nSii chiaro e accurato."} />
                    <button className="instruction-delete" onClick={() => setCustomInstructions((current) => current.filter((item) => item.id !== instruction.id))}>Elimina</button>
                  </details>
                </li>
              ))}
            </ul>
            <button className="primary-action" onClick={() => setInstructionsOpen(false)}>Salva istruzioni</button>
          </div>
        </Modal>
      )}

      {settingsOpen && (
        <Modal title="Impostazioni" onClose={() => setSettingsOpen(false)}>
          <div className="settings-section">
            <div className="settings-heading"><strong>Tema</strong><small>Scegli l'aspetto di AndreaGPT.</small></div>
            <div className="theme-options">
              <button className={theme === "cosmic" ? "active" : ""} onClick={() => setTheme("cosmic")} aria-pressed={theme === "cosmic"}>
                <span className="theme-preview cosmic-preview"><i /><i /><i /></span>
                <span><strong>Latte Cosmico</strong><small>#FFF8E7 · chiaro</small></span>
                {theme === "cosmic" && <Check size={16} />}
              </button>
              <button className={theme === "normal" ? "active" : ""} onClick={() => setTheme("normal")} aria-pressed={theme === "normal"}>
                <span className="theme-preview normal-preview"><i /><i /><i /></span>
                <span><strong>Normale</strong><small>Scuro · attuale</small></span>
                {theme === "normal" && <Check size={16} />}
              </button>
            </div>
          </div>
          <AppearanceSettings appearance={appearance} />
          <div className="settings-section generation-settings">
            <div className="settings-heading"><strong>Generazione</strong><small>Configura il comportamento delle risposte.</small></div>
          <label className="setting-field"><span><strong>Temperatura</strong><small>Valori bassi sono più precisi, valori alti più creativi.</small></span><output>{settings.temperature.toFixed(1)}</output></label>
          <input className="range" type="range" min="0" max="2" step="0.1" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })} />
          <label className="setting-field token-field"><span><strong>Token massimi</strong><small>Lunghezza massima della risposta.</small></span><input type="number" min="1" max="8192" value={settings.maxTokens} onChange={(event) => setSettings({ ...settings, maxTokens: Math.min(8192, Math.max(1, Number(event.target.value))) })} /></label>
          <label className="setting-field brain-field"><span><strong>Contesto Ollama</strong></span><select value={settings.numCtx ?? (Number(models.find((m) => m.providerId === "ollama")?.context) || 4096)} onChange={(e) => setSettings({ ...settings, numCtx: Number(e.target.value) as 4096 | 8192 })}><option value={4096}>4096</option><option value={8192}>8192</option></select></label>
          <label className="setting-field brain-field"><span><strong>Output Ollama</strong></span><select value={settings.ollamaMaxTokens ?? 512} onChange={(e) => setSettings({ ...settings, ollamaMaxTokens: Number(e.target.value) as 256 | 512 | 1024 })}><option value={256}>256 · breve</option><option value={512}>512 · bilanciato</option><option value={1024}>1024 · lungo</option></select></label>
          </div>
          <button className="primary-action" onClick={() => setSettingsOpen(false)}>Salva impostazioni</button>
        </Modal>
      )}
    </div>
  );
}

function AttachmentList({ attachments, removable = false, onRemove }: { attachments: ChatAttachment[]; removable?: boolean; onRemove?: (id: string) => void }) {
  return <div className={`attachment-list ${removable ? "pending" : "sent"}`}>
    {attachments.map((attachment) => (
      <div className={`attachment-card ${attachment.kind}`} key={attachment.id} title={`${attachment.name} · ${formatFileSize(attachment.size)}`}>
        {attachment.kind === "image" && attachment.dataUrl
          ? <img src={attachment.dataUrl} alt={attachment.name} />
          : <span className="attachment-icon">{attachment.kind === "image" ? <Image size={19} /> : <FileText size={19} />}</span>}
        <span className="attachment-copy"><strong>{attachment.name}</strong><small>{attachment.kind === "image" ? "Immagine" : attachment.kind === "pdf" ? "PDF" : "Documento"} · {formatFileSize(attachment.size)}</small></span>
        {removable && <button onClick={() => onRemove?.(attachment.id)} aria-label={`Rimuovi ${attachment.name}`}><X size={14} /></button>}
      </div>
    ))}
  </div>;
}

async function readAttachment(file: File): Promise<ChatAttachment> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const base = { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size };
  if (file.type.startsWith("image/")) return { ...base, kind: "image", dataUrl: await readAsDataUrl(file) };
  if (file.type === "application/pdf" || extension === "pdf") {
    const dataUrl = (await readAsDataUrl(file)).replace(/^data:[^;,]+/, "data:application/pdf");
    return { ...base, kind: "pdf", dataUrl };
  }
  if (file.type.startsWith("text/") || TEXT_FILE_EXTENSIONS.has(extension)) return { ...base, kind: "text", text: await file.text() };
  throw new Error(`Formato non supportato: ${file.name}. Usa immagini, PDF o file di testo/codice.`);
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Impossibile leggere ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function toApiMessage(message: ChatMessage, includeAttachmentPayloads = true) {
  if (!message.attachments?.length) return { role: message.role, content: message.content };
  if (!includeAttachmentPayloads) return { role: message.role, content: `${message.content}\n\n[Allegati precedenti: ${message.attachments.map((attachment) => attachment.name).join(", ")}]`.trim() };
  const content: Array<Record<string, unknown>> = [];
  if (message.content) content.push({ type: "text", text: message.content });
  for (const attachment of message.attachments) {
    if (attachment.kind === "image" && attachment.dataUrl) content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
    if (attachment.kind === "pdf" && attachment.dataUrl) content.push({ type: "file", file: { filename: attachment.name, file_data: attachment.dataUrl } });
    if (attachment.kind === "text" && attachment.text) content.push({ type: "text", text: `\n\n--- File: ${attachment.name} ---\n${attachment.text}\n--- Fine file ---` });
  }
  if (!content.length) content.push({ type: "text", text: `[Allegati non più disponibili: ${message.attachments.map((attachment) => attachment.name).join(", ")}]` });
  return { role: message.role, content };
}

function findLastAttachmentMessageIndex(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].attachments?.length) return index;
  }
  return -1;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB`;
}

function saveTextResult(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function loadCustomInstructions(): CustomInstruction[] {
  try {
    const saved = JSON.parse(localStorage.getItem("andreagpt-custom-instructions") ?? "null");
    if (!Array.isArray(saved)) return DEFAULT_INSTRUCTIONS;
    return saved.map((item): CustomInstruction => ({
      id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
      title: typeof item.title === "string" ? item.title.slice(0, 80) : "Istruzione",
      text: typeof item.text === "string" ? item.text.slice(0, 4000) : "",
      enabled: item.enabled !== false,
    }));
  } catch {
    return DEFAULT_INSTRUCTIONS;
  }
}

function renderCustomInstructions(instructions: CustomInstruction[]) {
  const active = instructions.filter((instruction) => instruction.enabled && instruction.text.trim());
  if (!active.length) return "";
  return `Istruzioni personalizzate attive:\n${active.map((instruction) => {
    const title = instruction.title.trim() || "Istruzione";
    const lines = instruction.text.split(/\n+/).map((line) => line.trim().replace(/^[-•]\s*/, "")).filter(Boolean);
    if (lines.length <= 1) return `- ${title}: ${lines[0] ?? ""}`;
    return `- ${title}:\n${lines.map((line) => `  - ${line}`).join("\n")}`;
  }).join("\n")}`;
}

async function readHealth() {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error("Health non disponibile");
  return response.json() as Promise<{ providers?: { searxng?: boolean; web?: boolean } }>;
}

function Modal({ title, onClose, children, wide = false }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className={`modal ${wide ? "wide" : ""}`} onMouseDown={(event) => event.stopPropagation()}><header><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={19} /></button></header><div className="modal-body">{children}</div></section></div>;
}

function loadMessages(): ChatMessage[] {
  try {
    const saved = JSON.parse(localStorage.getItem("andreagpt-messages") ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function loadConversations(): Conversation[] {
  try {
    const saved = JSON.parse(localStorage.getItem("andreagpt-conversations") ?? "[]");
    if (Array.isArray(saved) && saved.length) {
      return saved.map((conversation: Conversation) => conversation.customTitle ? conversation : {
        ...conversation,
        title: createConversationTitleFromMessages(conversation.messages),
      });
    }
    const messages = loadMessages();
    if (!messages.length) return [];
    const id = crypto.randomUUID();
    const title = createConversationTitleFromMessages(messages);
    const migrated = [{ id, title, messages, modelId: localStorage.getItem("andreagpt-model") ?? "", updatedAt: Date.now() }];
    localStorage.setItem("andreagpt-conversations", JSON.stringify(migrated));
    localStorage.setItem("andreagpt-active-conversation", id);
    return migrated;
  } catch {
    return [];
  }
}

function loadActiveConversationId() {
  const conversations = loadConversations();
  const saved = localStorage.getItem("andreagpt-active-conversation");
  return conversations.some((conversation) => conversation.id === saved) ? saved! : conversations[0]?.id ?? "";
}

function loadActiveMessages() {
  const conversations = loadConversations();
  const activeId = localStorage.getItem("andreagpt-active-conversation");
  return conversations.find((conversation) => conversation.id === activeId)?.messages ?? conversations[0]?.messages ?? [];
}

const titleStopWords = new Set<string>([
  "a", "ad", "al", "alla", "anche", "che", "come", "con", "da", "dal", "dei", "del", "della", "di", "e", "è", "fare", "fai", "gli", "il", "in", "la", "le", "mi", "nel", "nella", "non", "o", "per", "più", "questo", "sono", "su", "un", "una", "vorrei",
]);

function createConversationTitle(content: string) {
  const words: string[] = Array.from(content.toLocaleLowerCase("it-IT").match(/[\p{L}\p{N}+#.-]+/gu) ?? []);
  const keywords = words.filter((word, index) => word.length > 2 && !titleStopWords.has(word) && words.indexOf(word) === index).slice(0, 4);
  const selected = keywords.length ? keywords : words.slice(0, 3);
  const title = selected.join(" ").trim();
  return title ? title.charAt(0).toLocaleUpperCase("it-IT") + title.slice(1) : "Nuova conversazione";
}

function createConversationTitleFromMessages(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (firstUserMessage?.content) return createConversationTitle(firstUserMessage.content);
  return firstUserMessage?.attachments?.[0]?.name.slice(0, 60) || "Nuova conversazione";
}

function persistMessages(key: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(key, JSON.stringify(messages));
  } catch {
    localStorage.setItem(key, JSON.stringify(withoutAttachmentPayloads(messages)));
  }
}

function persistConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem("andreagpt-conversations", JSON.stringify(conversations));
  } catch {
    const lightweight = conversations.map((conversation) => ({
      ...conversation,
      messages: withoutAttachmentPayloads(conversation.messages),
    }));
    localStorage.setItem("andreagpt-conversations", JSON.stringify(lightweight));
  }
}

function withoutAttachmentPayloads(messages: ChatMessage[]) {
  return messages.map((message) => ({
    ...message,
    attachments: message.attachments?.map(({ dataUrl: _dataUrl, text: _text, ...attachment }) => attachment),
  }));
}
