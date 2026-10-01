import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
/**
 * Pagina principale della chat AndreaGPT.
 * Collega conversazioni, Brain, Web, file, modelli e strumenti locali.
 */
import { modelForPrivateChat } from "../model/model_selection";
import {
  Network,
  Cpu,
  AudioLines,
  ArrowLeft,
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  FileOutput,
  Info,
  Menu,
  Newspaper,
  Maximize,
  Mic,
  Minimize,
  MessageSquarePlus,
  FileText,
  Folder,
  Globe2,
  Image,
  Paperclip,
  PanelLeftClose,
  PenTool,
  Play,
  Plus,
  Pencil,
  Search,
  ScanLine,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  ThumbsDown,
  ThumbsUp,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import mascotUrl from "../../img/mascotte-no-sfondo.png";
import { TASKS } from "../utils/data";
import { downloadConverted, type Converted } from "../utils/converted";
import { UniverseBackground } from "../components/UniverseBackground";
import { AppearanceSettings, fonts, SettingsInfo, useAppearance } from "../components/AppearanceSettings";
import { createId } from "../utils/compat";
import { createStreamBatch } from "../utils/stream_batch";
import { writeClipboard } from "../utils/clipboard";
import { Mainboard } from "../components/Mainboard";
import type { BrainCitation, ChatAttachment, ChatMessage, ChatSettings, Conversation, DiagnosticTrace, ModelInfo, WebCitation } from "../types/types";

const iconByName = {
  sparkles: Sparkles,
  code: Code2,
  brain: Network,
  chart: Database,
  pen: PenTool,
  eye: Eye,
};

const BrainPanel = lazy(() => import("../components/BrainPanel").then(module => ({ default: module.BrainPanel })));
const BrainGraph = lazy(() => import("../components/BrainGraph").then(module => ({ default: module.BrainGraph })));
const ConvertPanel = lazy(() => import("../components/ConvertPanel").then(module => ({ default: module.ConvertPanel })));

function YoloIcon({ size = 17 }: { size?: number }) {
  return <span className="yolo-symbol" aria-hidden="true"><Square size={size} /><X size={Math.max(10, Math.round(size * 0.62))} /></span>;
}

function AudioCassette({ playing }: { playing: boolean }) {
  return <div className={`audio-cassette ${playing ? "is-playing" : ""}`} aria-hidden="true">
    <div className="audio-cassette-label">AUDIO · TEXT</div>
    <div className="audio-cassette-reels"><span /><span /></div>
    <div className="audio-cassette-tape" />
    <div className="audio-cassette-play"><Play size={13} fill="currentColor" /></div>
  </div>;
}

const unwantedAudioCaption = /sottotitoli\s+e\s+revisione\s+a\s+cura\s+di\s+qtss[.!]?/giu;
const unwantedAudioCaptionTest = /sottotitoli\s+e\s+revisione\s+a\s+cura\s+di\s+qtss[.!]?/iu;

function cleanAudioTranscript(text: string) {
  return text.replace(unwantedAudioCaption, "").replace(/\s{2,}/g, " ").trim();
}

function removeUnwantedAudioMessages(messages: ChatMessage[]) {
  return messages.filter((message) => !(message.role === "assistant" && message.audio && unwantedAudioCaptionTest.test(message.content)));
}

function AudioWelcomeCard({ variant, recording, transcribing, fileName, idleTitle, kicker, onUpload, onRecord }: { variant: "transcribe" | "record"; recording: boolean; transcribing: boolean; fileName?: string; idleTitle?: string; kicker?: string; onUpload?: () => void; onRecord?: () => void }) {
  const isRecordingCard = variant === "record";
  const busy = isRecordingCard ? recording : transcribing;
  return <div className="audio-welcome-card">
    <div className="audio-welcome-visual"><AudioCassette playing={busy} /><span className="audio-signal audio-signal-one" /><span className="audio-signal audio-signal-two" /></div>
    <div className="audio-welcome-copy">
      <span className="welcome-kicker">{kicker ?? (isRecordingCard ? "REGISTRA AUDIO" : "TRASCRIVI AUDIO")}</span>
      <h2>{isRecordingCard ? recording ? "Sto registrando audio" : (idleTitle || "Registra audio") : transcribing ? "Sto trascrivendo audio" : (idleTitle || "Trascrivi audio")}</h2>
      {fileName && <span className="audio-file-name">{fileName}</span>}
      <div className="audio-welcome-actions">
        {isRecordingCard ? <button type="button" className={`audio-record-button ${recording ? "active" : ""}`} onClick={onRecord} disabled={transcribing}><Mic size={16} /> {recording ? "Termina" : "Registra"}</button> : <button type="button" className="special-upload-button" onClick={onUpload} disabled={busy}><AudioLines size={16} /> Carica audio</button>}
      </div>
    </div>
  </div>;
}

const initialSettings: ChatSettings = { temperature: 0.6, maxTokens: 2048, ollamaMaxTokens: 512 };
type OllamaProfile = { numCtx: 4096 | 8192; maxTokens: 256 | 512 | 1024 | 2048 | 4096 };
const OLLAMA_PROFILES_STORAGE = "andreagpt-ollama-profiles-v1";

function defaultOllamaProfile(model?: ModelInfo): OllamaProfile {
  const id = model?.id.toLowerCase() ?? "";
  if (id.includes("qwen3:14b")) return { numCtx: 8192, maxTokens: 1024 };
  if (id.includes("qwen3-coder")) return { numCtx: 4096, maxTokens: 1024 };
  return { numCtx: Number(model?.context) === 8192 ? 8192 : 4096, maxTokens: 512 };
}

function loadOllamaProfiles(): Record<string, OllamaProfile> {
  try {
    const parsed = JSON.parse(localStorage.getItem(OLLAMA_PROFILES_STORAGE) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
      const profile = value as Partial<OllamaProfile>;
      return (profile.numCtx === 4096 || profile.numCtx === 8192) && [256, 512, 1024, 2048, 4096].includes(profile.maxTokens ?? 0);
    })) as Record<string, OllamaProfile>;
  } catch { return {}; }
}
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_SIZE = 12 * 1024 * 1024;
const ANALYZE_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const ANALYZE_ATTACHMENTS_SIZE = 50 * 1024 * 1024;
const TEXT_FILE_EXTENSIONS = new Set(["txt", "md", "csv", "json", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "hpp", "sql", "yaml", "yml", "log", "sh", "ps1"]);
type Theme = "cosmic" | "normal";
type YoloTask = "detect" | "segment" | "classify" | "pose" | "obb";
type SpecialMode = "normal" | "ocr" | "yolo" | "analyze" | "image" | "convert";
type AudioWelcomeMode = "none" | "transcribe" | "record";
type ImageServiceStatus = { status: "checking" | "starting" | "ready" | "error"; ready: boolean; message: string };
type ActiveOperation = { label: string; detail: string; startedAt: number };
interface CustomInstruction { id: string; title: string; text: string; enabled: boolean }

function MicelioScore({ message }: { message: ChatMessage }) {
  const event = message.diagnostics?.events.find(item => item.details?.semanticSupportChecked === true);
  const value = event?.details?.micelioSupportScore;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const percent = Math.round(value * 100);
  const tone = percent >= 70 ? "strong" : percent >= 45 ? "medium" : "weak";
  return <span className={`micelio-score ${tone}`} title="Somiglianza semantica stimata; non è una probabilità di correttezza né una verifica delle affermazioni">Affinità {percent}%</span>;
}

function LocalModelCookbook({ models, onChoose }: { models: ModelInfo[]; onChoose: (id: string) => void }) {
  const [hardware, setHardware] = useState({ ram: 8, cores: 4, gpu: "GPU non rilevata" });

  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter?: () => Promise<{ name?: string } | null> } };
    let active = true;
    void nav.gpu?.requestAdapter?.().then((adapter) => {
      if (active && adapter?.name) setHardware((current) => ({ ...current, gpu: adapter.name ?? current.gpu }));
    }).catch(() => undefined);
    setHardware({ ram: nav.deviceMemory ?? 8, cores: navigator.hardwareConcurrency ?? 4, gpu: "GPU non rilevata" });
    return () => { active = false; };
  }, []);

  const localModels = models.filter((model) => model.providerId === "ollama" && isChatListModel(model));
  const chooseAvailable = (patterns: string[]) => localModels.find((model) => patterns.some((pattern) => `${model.id} ${model.name}`.toLowerCase().includes(pattern)))?.id;
  const miniCpm = chooseAvailable(["minicpm5-2b", "minicpm", "2b"]);
  const ornith = chooseAvailable(["ornith-1.5:9b", "ornith-1.5", "ornith"]);
  const qwenExpert = chooseAvailable(["qwen3-coder:30b-a3b", "qwen3-coder"]);
  const recommended = ornith
    ? { label: "Ornith 1.5", size: "9B", model: ornith, reason: "Buon equilibrio locale per conversazioni, revisione del codice e attività agentiche, con consumi più contenuti." }
    : qwenExpert
    ? { label: "Qwen3 Coder", size: "30B-A3B", model: qwenExpert, reason: "Coder esperto per repository, Brain e attività agentiche. Richiede più memoria." }
    : { label: "Compatto e potente", size: "2B", model: miniCpm, reason: "MiniCPM5 2B privilegia velocità, basso consumo di RAM e uso interamente locale." };
  const codeModel = ornith ?? qwenExpert ?? miniCpm;

  return <details className="settings-section cookbook-settings settings-collapse">
    <summary className="settings-collapse-title"><span><strong>Cookbook · scegli il modello giusto</strong><SettingsInfo text="Profilo calcolato dal dispositivo, senza modificare nulla automaticamente." /></span><ChevronDown size={15} /></summary>
    <div className="cookbook-hardware"><Cpu size={16} /><span><strong>{hardware.ram} GB RAM · {hardware.cores} thread</strong><small>{hardware.gpu}</small></span></div>
    <div className="cookbook-recommendation"><div><strong>{recommended.label} · {recommended.size}</strong><small>{recommended.reason}</small></div>{recommended.model && <button type="button" className="secondary-action" onClick={() => onChoose(recommended.model!)}>Usa questo</button>}</div>
    <div className="cookbook-grid">
      <div><strong>Chat quotidiana</strong><small>{recommended.model ?? "Modello Ollama compatibile"}</small></div>
      <div><strong>Codice</strong><small>{codeModel ?? "ornith-1.5:9b"}</small></div>
      <div><strong>Embedding Brain</strong><small>Gestito internamente</small></div>
    </div>
    <p className="cookbook-note">Ornith 1.5 9B è il modello locale consigliato per velocità, codice e conversazioni. Nomic Embed Text serve solo per gli embedding, non per la chat. Installazione: <code>ollama pull nome-modello</code>.</p>
  </details>;
}

function comfyBrowserUrl() {
  // Usa l'host reale con cui è stata aperta l'app (127.0.0.1, IP di rete, …),
  // mai "localhost" fisso: da telefono o con altre interfacce non risolverebbe.
  const host = window.location.hostname || "127.0.0.1";
  const wrapped = host.includes(":") ? `[${host}]` : host;
  return `http://${wrapped}:8188`;
}

function normalizeMathMarkdown(markdown: string) {
  // remark-math gestisce già `$...$` e `$$...$$`. Convertiamo soltanto le
  // delimitazioni LaTeX esplicite che Ollama usa spesso, senza trasformare
  // intere righe di testo: una riga come "Dove: ... \\eta ..." non è una
  // formula e non deve inglobare tutto il Markdown successivo.
  return markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((part, index) => {
    if (index % 2) return part;

    const normalized = part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`);

    // Alcuni modelli emettono una formula display come [ ... ] senza backslash.
    // Riconosciamo solo il blocco su righe separate, così i link Markdown
    // [testo](url) restano intatti.
    const lines = normalized.split("\n");
    const output: string[] = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (lines[lineIndex].trim() === "[" && lineIndex + 2 < lines.length) {
        const closingIndex = lines.findIndex((candidate, index) => index > lineIndex && candidate.trim() === "]");
        if (closingIndex > lineIndex + 1) {
          const body = lines.slice(lineIndex + 1, closingIndex).join("\n").trim();
          if (/\\[A-Za-z]+|[=^_{}]/.test(body)) {
            output.push("$$", body, "$$");
            lineIndex = closingIndex;
            continue;
          }
        }
      }
      output.push(lines[lineIndex]);
    }
    return output.join("\n");
  }).join("");
}

function isChatListModel(model: ModelInfo) {
  const id = model.id.toLowerCase();
  if (id.startsWith("nomic-embed-text")) return false;
  if (id.includes("qwen3-coder") && id.includes("30b")) return false;
  return true;
}

const MarkdownMessage = memo(function MarkdownMessage({ content, privateMode }: { content: string; privateMode: boolean }) {
  const components = privateMode ? { img: ({ alt }: { alt?: string }) => <span>[Immagine esterna bloccata: {alt || "immagine"}]</span> } : undefined;
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { errorColor: "inherit", throwOnError: false }]]} components={components}>{normalizeMathMarkdown(content)}</ReactMarkdown>;
});

const DEFAULT_INSTRUCTIONS: CustomInstruction[] = [
  { id: "generali", title: "Generali", enabled: true, text: "Rispondi in italiano.\nSii chiaro, concreto e accurato.\nNiente parolacce o frasi volgari non richieste." },
  { id: "brain", title: "Brain", enabled: true, text: "Usa solo fonti pertinenti.\nCita solo cio che supporta davvero la risposta.\nNon inventare se le fonti sono parziali." },
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
  const [specialMode, setSpecialMode] = useState<SpecialMode>("normal");
  const [imageSettings, setImageSettings] = useState<{ width: number; height: number; steps: number; seed: number }>(() => {
    try { return { width: 768, height: 768, steps: 25, seed: Math.floor(Math.random() * 2147483647), ...JSON.parse(localStorage.getItem("andreagpt-image-settings") || "{}") }; }
    catch { return { width: 768, height: 768, steps: 25, seed: Math.floor(Math.random() * 2147483647) }; }
  });
  const [imageService, setImageService] = useState<ImageServiceStatus>({ status: "checking", ready: false, message: "Verifica ComfyUI…" });
  const [imageModel, setImageModel] = useState<"qwen" | "viggle">(() => localStorage.getItem("andreagpt-image-model") === "viggle" ? "viggle" : "qwen");
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
  const [codeAgentEnabled, setCodeAgentEnabled] = useState(false);
  const [brainPaths, setBrainPaths] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [brainOpen, setBrainOpen] = useState(false);
  const [brainGraphOpen, setBrainGraphOpen] = useState(false);
  const appearance = useAppearance();
  const [brainInfoOpen, setBrainInfoOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [operationSeconds, setOperationSeconds] = useState(0);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [webAvailable, setWebAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== "undefined" ? window.innerWidth > 850 : true);
  const sidebarBeforeOverlayRef = useRef<boolean | null>(null);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [topbarMenuOpen, setTopbarMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState<CustomInstruction[]>(() => loadCustomInstructions());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [researchType, setResearchType] = useState<"ai" | "papers" | "science">("ai");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchSeconds, setResearchSeconds] = useState(0);
  const [researchResult, setResearchResult] = useState<{ label: string; article: string; sources: Array<{ id: number; title: string; url: string; description: string }> } | null>(null);
  const [researchPage, setResearchPage] = useState(0);
  const [researchFullscreen, setResearchFullscreen] = useState(false);
  const [outputFolder, setOutputFolder] = useState<"images" | "ocr" | "yolo" | "compactChat" | null>(null);
  const [outputDelete, setOutputDelete] = useState<{ folder: "Image" | "OCR" | "YOLO" | "Compatta_chat"; name: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ id: string; title: string } | null>(null);
  const [outputFiles, setOutputFiles] = useState<{ images: Array<{ name: string; url: string; size: number; updatedAt: number; image: boolean }>; ocr: Array<{ name: string; url: string; size: number; updatedAt: number; image: boolean }>; yolo: Array<{ name: string; url: string; size: number; updatedAt: number; image: boolean }>; compactChat: Array<{ name: string; url: string; size: number; updatedAt: number; image: boolean }> }>({ images: [], ocr: [], yolo: [], compactChat: [] });
  const [compactingChat, setCompactingChat] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(initialSettings);
  const [ollamaProfiles, setOllamaProfiles] = useState<Record<string, OllamaProfile>>(() => loadOllamaProfiles());
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [diagnosticReportMessageId, setDiagnosticReportMessageId] = useState("");
  const [diagnosticReportCopied, setDiagnosticReportCopied] = useState(false);
  const [openMessagePanels, setOpenMessagePanels] = useState<Record<string, Partial<Record<"brain" | "web" | "metrics" | "diagnostics" | "image", boolean>>>>({});
  const [composerToolsOpen, setComposerToolsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingFileName, setRecordingFileName] = useState("");
  const [audioWelcomeMode, setAudioWelcomeMode] = useState<AudioWelcomeMode>("none");
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem("andreagpt-theme") === "normal" ? "normal" : "cosmic");
  const [historyCollapsed, setHistoryCollapsed] = useState(() => localStorage.getItem("andreagpt-history-collapsed") === "true");
  const [modelsCollapsed, setModelsCollapsed] = useState(() => localStorage.getItem("andreagpt-models-collapsed") === "true");
  const [welcomeTitle, setWelcomeTitle] = useState(() => localStorage.getItem("andreagpt-welcome-title") || "Ciao Cetriolo,");
  const [welcomeAccent, setWelcomeAccent] = useState(() => localStorage.getItem("andreagpt-welcome-accent") || "oggi che facciamo?");
  const [welcomeSubtitle, setWelcomeSubtitle] = useState(() => localStorage.getItem("andreagpt-welcome-subtitle") || "Scrivi un messaggio oppure scegli uno strumento dalla barra in alto.");
  const [welcomeEditing, setWelcomeEditing] = useState(false);
  const [welcomeDraft, setWelcomeDraft] = useState({ title: "", accent: "", subtitle: "" });
  type WelcomeCardText = { title: string; accent: string; subtitle: string };
  const DEFAULT_CARD_TEXTS: Record<string, WelcomeCardText> = {
    analyze: { title: "Analyze", accent: "un’immagine.", subtitle: "Il primo avvio scarica e carica il modello: lo stato e il tempo trascorso restano sempre visibili." },
    ocr: { title: "Pronto per", accent: "leggere i tuoi file.", subtitle: "Allega una o più immagini o PDF. Il testo verrà estratto localmente e salvato nella cartella OCR." },
    yolo: { title: "Capisco gli", accent: "elementi nell’immagine.", subtitle: "Scegli il task, allega una o più immagini e avvia detection, segmentazione, classificazione, pose o OBB." },
    image: { title: "Descrivila.", accent: "Io la creo.", subtitle: "" },
    convert: { title: "Trasforma i tuoi", accent: "documenti.", subtitle: "" },
    transcribe: { title: "Trascrivi audio", accent: "TRASCRIVI AUDIO", subtitle: "" },
    record: { title: "Registra audio", accent: "REGISTRA AUDIO", subtitle: "" },
  };
  const [cardTexts, setCardTexts] = useState<Record<string, WelcomeCardText>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("andreagpt-welcome-cards") || "{}") as Record<string, Partial<WelcomeCardText>>;
      const merged: Record<string, WelcomeCardText> = {};
      for (const [key, defaults] of Object.entries(DEFAULT_CARD_TEXTS)) {
        merged[key] = { title: saved[key]?.title || defaults.title, accent: saved[key]?.accent || defaults.accent, subtitle: saved[key]?.subtitle ?? defaults.subtitle };
      }
      return merged;
    } catch { return DEFAULT_CARD_TEXTS; }
  });
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState({ title: "", accent: "", subtitle: "" });
  function startCardEdit(id: string) {
    const current = cardTexts[id] ?? DEFAULT_CARD_TEXTS[id];
    if (!current) return;
    setCardDraft({ ...current });
    setEditingCard(id);
  }
  function saveCardEdit(id: string) {
    const defaults = DEFAULT_CARD_TEXTS[id];
    if (!defaults) { setEditingCard(null); return; }
    const title = cardDraft.title.trim() || defaults.title;
    const accent = cardDraft.accent.trim() || defaults.accent;
    const subtitle = cardDraft.subtitle.trim() || defaults.subtitle;
    setCardTexts((current) => ({ ...current, [id]: { title, accent, subtitle } }));
    setEditingCard(null);
  }
  const abortRef = useRef<AbortController | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const analyzeConversationIdRef = useRef("");
  const appShellRef = useRef<HTMLDivElement>(null);
  const researchAbortRef = useRef<AbortController | null>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const conversationRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const composerToolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeOperation) { setOperationSeconds(0); return; }
    const update = () => setOperationSeconds(Math.max(0, Math.floor((Date.now() - activeOperation.startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeOperation]);

  useEffect(() => {
    if (!researchLoading) { setResearchSeconds(0); return; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setResearchSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [researchLoading]);

  useEffect(() => {
    const syncResearchFullscreen = () => setResearchFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncResearchFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncResearchFullscreen);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const syncViewport = () => {
      const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.setProperty("--visual-height", `${Math.round(viewport.height)}px`);
      root.style.setProperty("--visual-top", `${Math.round(viewport.offsetTop)}px`);
      root.style.setProperty("--keyboard-height", `${Math.round(keyboard)}px`);
    };
    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      root.style.removeProperty("--visual-height");
      root.style.removeProperty("--visual-top");
      root.style.removeProperty("--keyboard-height");
    };
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await (appShellRef.current ?? document.documentElement).requestFullscreen({ navigationUI: "hide" });
    } catch {
      setError("Il browser non ha consentito lo schermo intero.");
    }
  }

  async function transcribeAudio(file: File) {
    if (!file.size || file.size > 75 * 1024 * 1024) { setError("L’audio deve essere non vuoto e pesare al massimo 75 MiB."); return; }
    const conversationId = activeConversationId || createId();
    const audioMessageId = createId();
    if (!activeConversationId) setActiveConversationId(conversationId);
    stickToBottomRef.current = true;
    setMessages((current) => [...current, { id: audioMessageId, role: "assistant", content: "", modelName: "Trascrizione audio", audio: { status: "transcribing", fileName: file.name } }]);
    setTranscribing(true); setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Impossibile leggere l’audio."));
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/audio/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, data }) });
      const result = await readJsonResponse<{ text?: string; error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "Trascrizione fallita.");
      if (!result.text?.trim()) throw new Error("Non è stato riconosciuto alcun parlato.");
      const transcript = cleanAudioTranscript(result.text.trim());
      if (!transcript) {
        setMessages((current) => current.filter((message) => message.id !== audioMessageId));
        return;
      }
      setMessages((current) => current.map((message) => message.id === audioMessageId ? { ...message, content: transcript, audio: { status: "complete", fileName: file.name } } : message));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Trascrizione fallita.";
      setMessages((current) => current.map((item) => item.id === audioMessageId ? { ...item, content: message, audio: { status: "error", fileName: file.name } } : item));
      setError(message);
    }
    finally { setTranscribing(false); if (audioInputRef.current) audioInputRef.current.value = ""; }
  }

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Registrazione audio non supportata da questo browser."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      const extension = (preferred ?? recorder.mimeType).includes("ogg") ? "ogg" : "webm";
      const recordingFileName = `registrazione-${Date.now()}.${extension}`;
      setRecordingFileName(recordingFileName);
      audioStreamRef.current = stream; recorderRef.current = recorder; audioChunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const audio = new File(audioChunksRef.current, recordingFileName, { type });
        audioStreamRef.current?.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null; recorderRef.current = null; audioChunksRef.current = []; setRecording(false);
        void transcribeAudio(audio);
      };
      recorder.start(1000); setRecording(true);
    } catch { setError("Accesso al microfono negato o non disponibile."); }
  }

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    audioStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    if (!composerToolsOpen) return;
    const closeTools = (event: MouseEvent) => {
      if (!composerToolsRef.current?.contains(event.target as Node)) setComposerToolsOpen(false);
    };
    const closeToolsWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setComposerToolsOpen(false);
    };
    document.addEventListener("pointerdown", closeTools);
    document.addEventListener("keydown", closeToolsWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeTools);
      document.removeEventListener("keydown", closeToolsWithEscape);
    };
  }, [composerToolsOpen]);

  const overlayOpen = brainOpen || brainGraphOpen || brainInfoOpen || detailsOpen || instructionsOpen || settingsOpen || outputOpen || Boolean(outputDelete) || researchOpen || Boolean(renameDialog);
  useEffect(() => {
    if (overlayOpen) {
      if (sidebarBeforeOverlayRef.current === null) sidebarBeforeOverlayRef.current = sidebarOpen;
    } else if (sidebarBeforeOverlayRef.current !== null) {
      sidebarBeforeOverlayRef.current = null;
    }
  }, [overlayOpen, sidebarOpen]);

  const visibleModels = models.filter(isChatListModel);
  const localOllamaModels = visibleModels.filter((model) => model.providerId === "ollama");
  const selectedModel = visibleModels.find((model) => model.id === selectedModelId) ?? visibleModels[0] ?? models[0];
  const selectedOllamaProfile = selectedModel?.providerId === "ollama"
    ? { ...defaultOllamaProfile(selectedModel), ...ollamaProfiles[selectedModel.id] }
    : defaultOllamaProfile(selectedModel);
  const activeConversationTitle = conversations.find((conversation) => conversation.id === activeConversationId)?.title ?? "";
  const imageConversation = specialMode === "image" || /^Image \d+$/i.test(activeConversationTitle);
  useEffect(() => {
    if (/^Image \d+$/i.test(activeConversationTitle)) setSpecialMode("image");
    else if (/^(?:Analyze|Analizza IMG) \d+$/i.test(activeConversationTitle)) setSpecialMode("analyze");
  }, [activeConversationTitle]);

  useEffect(() => {
    if (!imageConversation || !messages.some(message => message.role === "assistant" && !message.generatedImage && /ComfyUI|generando|generazione/i.test(message.content))) return;
    let active = true;
    void fetch("/api/output/images").then(response => response.ok ? response.json() : []).then((images: Array<{ name: string; url: string; output?: string }>) => {
      if (!active || !images.length) return;
      const latest = images[0];
      setMessages(current => current.map(message => message.role === "assistant" && !message.generatedImage && /ComfyUI|generando|generazione/i.test(message.content)
        ? { ...message, content: "Immagine pronta.", generatedImage: { url: latest.url, name: latest.name, width: 768, height: 768, seed: 0, output: latest.output ?? `OUTPUT/Image/${latest.name}`, model: "Qwen/Qwen-Image-2.1" } }
        : message));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [imageConversation, activeConversationId]);
  const brainPrivate = codeAgentEnabled || brainEnabled || messages.some((message) => message.brainPrivate) || Boolean(conversations.find((c) => c.id === activeConversationId)?.brainPrivate);
  const isOllama = selectedModel?.providerId === "ollama";
  const selectedTask = TASKS.find((task) => task.id === taskId) ?? TASKS[0];
  const filteredModels = visibleModels.filter((model) => {
    const term = search.toLowerCase();
    return `${model.name} ${model.id} ${model.provider} ${model.tags.join(" ")}`.toLowerCase().includes(term);
  });
  const estimatedTokens = Math.ceil(messages.reduce((total, message) => total + message.content.length, 0) / 4);
  function extractMentionedSource(content: string) {
    // Forma quotata per percorsi con spazi: @"cartella/mio file.md"
    const quoted = content.match(/(?:^|\s)@"([^"]+)"/u)?.[1]?.trim();
    if (quoted) return quoted;
    const bare = content.match(/(?:^|\s)@([^\s]+)/u)?.[1];
    if (!bare) return "";
    // La punteggiatura di fine frase (@fonte, @fonte. @fonte?) non fa parte del percorso.
    return bare.replace(/[.,;:!?)"'\]}]+$/u, "");
  }

  async function refreshBrainPaths() {
    try {
      const response = await fetch("/api/brain/status");
      if (!response.ok) return;
      const data = await response.json() as { sources?: Array<{ id: string }> };
      if (Array.isArray(data?.sources)) setBrainPaths(data.sources.map((source) => source.id));
    } catch { /* Resta la lista precedente: il dropdown mostra comunque i percorsi noti. */ }
  }

  const mentionSuggestions = (() => {
    const query = mentionQuery.toLowerCase();
    const matches = brainPaths.filter((path) => path.toLowerCase().includes(query));
    matches.sort((a, b) => {
      const aPrefix = a.toLowerCase().startsWith(query) ? 0 : 1;
      const bPrefix = b.toLowerCase().startsWith(query) ? 0 : 1;
      return aPrefix - bPrefix || a.localeCompare(b);
    });
    return matches.slice(0, 8);
  })();
  const mentionActive = /(?:(?:^|\s)@"[^"]*|(?:^|\s)@[^\s]*)$/u.test(input);
  const mentionActivatedRef = useRef(false);
  useEffect(() => {
    // La lista caricata all'avvio può essere vuota o datata: ricaricala quando
    // l'utente inizia davvero a citare una fonte.
    if (mentionActive && !mentionActivatedRef.current) void refreshBrainPaths();
    mentionActivatedRef.current = mentionActive;
  }, [mentionActive]);

  function capitalizeFirstLetter(value: string) {
    return value.replace(/^(\s*["'“‘(\[]*)(\p{Ll})/u, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("it-IT")}`);
  }

  function updateChatInput(value: string, composing = false) {
    const updatedValue = composing ? value : capitalizeFirstLetter(value);
    resizeInput(updatedValue);
    const quoted = updatedValue.match(/(?:^|\s)@"([^"]*)$/u)?.[1];
    const bare = quoted === undefined ? updatedValue.match(/(?:^|\s)@([^\s]*)$/u)?.[1] : undefined;
    setMentionQuery(quoted ?? bare ?? "");
  }

  function chooseMention(path: string) {
    const insert = /\s/.test(path) ? `@"${path}" ` : `@${path} `;
    const value = input.replace(/(^|\s)(@"[^"]*|@[^\s]*)$/u, `$1${insert}`);
    updateChatInput(value);
    textareaRef.current?.focus();
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await writeClipboard(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? "" : current), 1800);
    } catch {
      setError("Non sono riuscito a copiare il testo negli appunti.");
    }
  }

  function diagnosticReport(message: ChatMessage) {
    if (!message.diagnostics) return "";
    const messageIndex = messages.findIndex(item => item.id === message.id);
    const requestMessage = messageIndex > 0 ? [...messages.slice(0, messageIndex)].reverse().find(item => item.role === "user") : undefined;
    const failures = message.diagnostics.events.filter(event => event.status === "warning" || event.status === "error");
    const statusCounts = message.diagnostics.events.reduce<Record<string, number>>((counts, event) => ({ ...counts, [event.status]: (counts[event.status] ?? 0) + 1 }), {});
    const formatDuration = (value: number | undefined) => value === undefined ? "—" : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(2)} ms`;
    const metricLabels: Record<string, string> = {
      retrievalMs: "Ricerca fonti", firstTokenMs: "Primo token", totalMs: "Tempo totale", routerLatencyMs: "Latenza router",
      routerRoute: "Percorso router", routerConfidence: "Confidenza router", prompt_eval_count: "Token in ingresso", eval_count: "Token generati",
      load_duration: "Caricamento modello (ns)", prompt_eval_duration: "Elaborazione prompt (ns)", eval_duration: "Generazione (ns)",
      cpuUserMs: "CPU utente", cpuSystemMs: "CPU sistema", rssMb: "RAM server (MiB)",
    };
    const metrics = message.metrics ? Object.entries(message.metrics).map(([key, value]) => {
      const duration = ["retrievalMs", "firstTokenMs", "totalMs", "routerLatencyMs", "cpuUserMs", "cpuSystemMs"].includes(key) && typeof value === "number" ? formatDuration(value) : String(value);
      return `- ${metricLabels[key] ?? key}: ${duration}`;
    }).join("\n") : "- Nessuna metrica disponibile";
    const brainSources = message.brainSources?.length ? message.brainSources.map((source, index) => `- [${source.id || index + 1}] ${source.source}\n  Estratto: ${source.text}`).join("\n") : "- Nessuna fonte Brain";
    const webSources = message.webSources?.length ? message.webSources.map(source => `- [${source.source}] ${source.title}\n  URL: ${source.url}\n  Estratto: ${source.excerpt}`).join("\n") : "- Nessuna fonte Web";
    const attachments = requestMessage?.attachments?.length ? requestMessage.attachments.map(attachment => `- ${attachment.name} · ${attachment.type || attachment.kind} · ${attachment.size} byte`).join("\n") : "- Nessun allegato";
    const events = message.diagnostics.events.map(event => {
      const details = event.details ? `\n${Object.entries(event.details).map(([key, value]) => `  - ${key}: ${value ?? "—"}`).join("\n")}` : "";
      return `[${event.at}] ${event.status.toUpperCase()} · ${event.stage.toUpperCase()} · ${event.message}${event.durationMs !== undefined ? ` · ${event.durationMs} ms` : ""}${details}`;
    }).join("\n\n");
    return `REPORT DIAGNOSTICO ANDREAGPT
Request ID: ${message.diagnostics.requestId}
Data richiesta: ${message.diagnostics.events[0]?.at ?? "—"}
Esito: ${failures.length ? `${failures.length} avvisi/errori` : "Nessun problema rilevato"}
Eventi: ${message.diagnostics.events.length} totali · ${statusCounts.ok ?? 0} ok · ${statusCounts.info ?? 0} info · ${statusCounts.warning ?? 0} warning · ${statusCounts.error ?? 0} error

CONFIGURAZIONE
- Modello: ${message.modelName ?? "—"}
- ID modello: ${message.modelId ?? "—"}
- Provider: ${message.modelProvider ?? "—"}
- Brain: ${message.brainPrivate || Boolean(message.brainSources?.length) ? "attivo" : "non richiesto"}
- Web: ${message.webSearch || Boolean(message.webSources?.length) ? "attivo" : "non richiesto"}

RICHIESTA UTENTE
${requestMessage?.content || "—"}

ALLEGATI
${attachments}

RISPOSTA ASSOCIATA
${message.content || "—"}

DIMENSIONI
- Richiesta: ${requestMessage?.content.length ?? 0} caratteri (circa ${Math.ceil((requestMessage?.content.length ?? 0) / 4)} token)
- Risposta: ${message.content.length} caratteri (circa ${Math.ceil(message.content.length / 4)} token)

TEMPI E METRICHE
${metrics}

FONTI BRAIN
${brainSources}

FONTI WEB
${webSources}

EVENTI DIAGNOSTICI
${events || "—"}`;
  }

  async function copyDiagnosticReport(message: ChatMessage) {
    try {
      await writeClipboard(diagnosticReport(message));
      setDiagnosticReportCopied(true);
      window.setTimeout(() => setDiagnosticReportCopied(false), 1800);
    } catch {
      setError("Non sono riuscito a copiare il report diagnostico.");
    }
  }

  function toggleMessagePanel(messageId: string, panel: "brain" | "web" | "metrics" | "diagnostics" | "image") {
    setOpenMessagePanels((current) => ({
      ...current,
      [messageId]: { brain: false, web: false, metrics: false, diagnostics: false, ...current[messageId], [panel]: !current[messageId]?.[panel] },
    }));
  }

  function editAndResend(message: ChatMessage) {
    updateChatInput(message.content);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  async function rateBrainMessage(message: ChatMessage, messageIndex: number, rating: 1 | -1) {
    const query = [...messages.slice(0, messageIndex)].reverse().find(item => item.role === "user")?.content.trim();
    if (!query || !message.brainSources?.length) return;
    try {
      const response = await fetch("/api/brain/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, rating, sources: message.brainSources.map(source => source.source) }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Feedback non salvato.");
      setMessages(current => current.map(item => item.id === message.id ? { ...item, feedback: rating } : item));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Feedback non salvato."); }
  }

  useEffect(() => { void refreshBrainPaths(); }, []);
  useEffect(() => {
    const openBrainArchive = () => { setBrainGraphOpen(false); setBrainOpen(true); };
    window.addEventListener("andreagpt-brain-back", openBrainArchive);
    return () => window.removeEventListener("andreagpt-brain-back", openBrainArchive);
  }, []);

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
        const chatModels = data.models.filter(isChatListModel);
        setSelectedModelId(chatModels.some((model) => model.id === saved) ? saved! : chatModels[0]?.id ?? "");
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
    if (!loading) persistMessages("andreagpt-messages", messages);
  }, [messages, loading]);

  useEffect(() => {
    setMessages((current) => removeUnwantedAudioMessages(current));
    setConversations((current) => current.map((conversation) => ({ ...conversation, messages: removeUnwantedAudioMessages(conversation.messages) })));
  }, []);

  useEffect(() => {
    if (!messages.length || !stickToBottomRef.current) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (conversation) conversation.scrollTop = conversation.scrollHeight;
      scrollFrameRef.current = null;
    });
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [messages]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  function handleConversationScroll() {
    const conversation = conversationRef.current;
    if (!conversation) return;
    stickToBottomRef.current = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 96;
  }

  useEffect(() => {
    if (loading || !activeConversationId || !messages.length) return;
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
  }, [activeConversationId, messages, selectedModelId, loading]);

  useEffect(() => {
    persistConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (!brainPrivate) return;
    setWebSearchEnabled(false);
    setSelectedModelId(current => modelForPrivateChat(current, models));
  }, [brainPrivate, models]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    if (activeConversationId) localStorage.setItem("andreagpt-active-conversation", activeConversationId);
    else localStorage.removeItem("andreagpt-active-conversation");
  }, [activeConversationId]);

  useEffect(() => {
    if (selectedModelId) localStorage.setItem("andreagpt-model", selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    localStorage.setItem(OLLAMA_PROFILES_STORAGE, JSON.stringify(ollamaProfiles));
  }, [ollamaProfiles]);

  useEffect(() => {
    localStorage.setItem("andreagpt-web-search", String(webSearchEnabled));
  }, [webSearchEnabled]);

  useEffect(() => {
    localStorage.setItem("andreagpt-brain-enabled", String(brainEnabled));
  }, [brainEnabled]);

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
    localStorage.setItem("andreagpt-welcome-title", welcomeTitle);
    localStorage.setItem("andreagpt-welcome-accent", welcomeAccent);
    localStorage.setItem("andreagpt-welcome-subtitle", welcomeSubtitle);
    try { localStorage.setItem("andreagpt-welcome-cards", JSON.stringify(cardTexts)); } catch { /* quota superata: resta lo stato in memoria */ }
  }, [welcomeTitle, welcomeAccent, welcomeSubtitle, cardTexts]);

  useEffect(() => {
    localStorage.setItem("andreagpt-image-settings", JSON.stringify(imageSettings));
    localStorage.setItem("andreagpt-image-model", imageModel);
  }, [imageSettings, imageModel]);

  useEffect(() => {
    const disableContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", disableContextMenu);
    return () => document.removeEventListener("contextmenu", disableContextMenu);
  }, []);

  useEffect(() => {
    if (specialMode !== "image" && !imageConversation) return;
    let active = true;
    const refreshImageService = async () => {
      try {
        const response = await fetch("/api/image/status");
        const data = await response.json() as { status?: "starting" | "ready"; ready?: boolean; message?: string };
        if (active) setImageService({ status: data.ready ? "ready" : "starting", ready: Boolean(data.ready), message: data.message || (data.ready ? "ComfyUI operativo" : "ComfyUI in avvio") });
      } catch {
        if (active) setImageService({ status: "error", ready: false, message: "Stato ComfyUI non disponibile" });
      }
    };
    void refreshImageService();
    const timer = window.setInterval(refreshImageService, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [specialMode, imageConversation]);

  useEffect(() => {
    const receiveGraphSelection = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "andreagpt-brain-source" || typeof event.data.source !== "string") return;
      setBrainSource(event.data.source); setBrainEnabled(true);
    };
    window.addEventListener("message", receiveGraphSelection);
    return () => window.removeEventListener("message", receiveGraphSelection);
  }, []);

  function chooseTask(nextTaskId: string) {
    setTaskId(nextTaskId);
    setTaskMenuOpen(false);
    updateSelectedOllamaProfile({ maxTokens: nextTaskId === "code" || nextTaskId === "reasoning" ? 1024 : 512 });
  }

  function updateOllamaProfile(model: ModelInfo, patch: Partial<OllamaProfile>) {
    if (model.providerId !== "ollama") return;
    setOllamaProfiles(current => ({
      ...current,
      [model.id]: { ...defaultOllamaProfile(model), ...current[model.id], ...patch },
    }));
  }

  function updateSelectedOllamaProfile(patch: Partial<OllamaProfile>) {
    if (selectedModel?.providerId === "ollama") updateOllamaProfile(selectedModel, patch);
  }

  function chooseModel(id: string) {
    if (loading || (brainPrivate && models.find((model) => model.id === id)?.providerId !== "ollama")) return;
    setSelectedModelId(id);
    setError("");
    setSidebarOpen(false);
  }

  function setBrainMode(enabled: boolean) {
    if (loading) return;
    setBrainEnabled(enabled);
    if (enabled) {
      setWebSearchEnabled(false);
      setSelectedModelId(current => modelForPrivateChat(current, models));
      setMessages((current) => current.map((message) => ({ ...message, brainPrivate: true })));
    }
  }

  function openAudioWelcome(mode: Exclude<AudioWelcomeMode, "none">) {
    if (loading || recording || transcribing) return;
    // Se siamo in una chat esistente (normale, analyze, ecc.) con messaggi o
    // in una modalita speciale, apri una nuova conversazione vuota dedicata
    // all'audio senza perdere quella precedente (gia salvata in cronologia).
    const needsNewConversation = messages.length > 0 || specialMode !== "normal";
    if (needsNewConversation) {
      abortRef.current?.abort();
      activeConversationIdRef.current = "";
      stickToBottomRef.current = true;
      setLoading(false);
      setActiveOperation(null);
      setMessages([]);
      setActiveConversationId("");
      setInput("");
      setAttachments([]);
      setError("");
      setSpecialMode("normal");
      setAudioWelcomeMode(mode);
      if (mode === "record") setRecordingFileName("");
      setComposerToolsOpen(false);
      setTopbarMenuOpen(false);
      setAudioMenuOpen(false);
      focusComposerAfterNavigation();
      return;
    }
    setAudioWelcomeMode(mode);
    if (mode === "record" && !recording) setRecordingFileName("");
    setComposerToolsOpen(false);
    setError("");
  }

  function newChat() {
    abortRef.current?.abort();
    activeConversationIdRef.current = "";
    stickToBottomRef.current = true;
    setLoading(false);
    setActiveOperation(null);
    setMessages([]);
    setActiveConversationId("");
    setInput("");
    setAttachments([]);
    setError("");
    setSpecialMode("normal");
    setAudioWelcomeMode("none");
    focusComposerAfterNavigation();
  }

  function openConversation(conversation: Conversation) {
    abortRef.current?.abort();
    activeConversationIdRef.current = conversation.id;
    stickToBottomRef.current = true;
    setLoading(false);
    setActiveOperation(null);
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setBrainEnabled(Boolean(conversation.brainPrivate));
    setAttachments([]);
    setError("");
    setAudioWelcomeMode("none");
    setSpecialMode(/^OCR \d+$/i.test(conversation.title) ? "ocr" : /^YOLO \d+$/i.test(conversation.title) ? "yolo" : /^(?:Analyze|Analizza IMG) \d+$/i.test(conversation.title) ? "analyze" : /^Image \d+$/i.test(conversation.title) ? "image" : /^Converti \d+$/i.test(conversation.title) ? "convert" : "normal");
    if (models.some((model) => model.id === conversation.modelId)) setSelectedModelId(conversation.modelId);
    setSidebarOpen(false);
  }

  function deleteConversation(id: string) {
    if (loading) return;
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    // Remove the record immediately so a refresh cannot resurrect a deleted chat
    // while React is still committing the state update.
    try { localStorage.setItem("andreagpt-conversations", JSON.stringify(remaining)); } catch { /* state update remains authoritative */ }
    setConversations(remaining);
    if (id === activeConversationId) {
      const next = remaining[0];
      localStorage.removeItem("andreagpt-messages");
      if (next) localStorage.setItem("andreagpt-active-conversation", next.id);
      else localStorage.removeItem("andreagpt-active-conversation");
      setBrainEnabled(Boolean(next?.brainPrivate));
      setActiveConversationId(next?.id ?? "");
      setMessages(next?.messages ?? []);
      setSpecialMode(next?.title.match(/^OCR \d+$/i) ? "ocr" : next?.title.match(/^YOLO \d+$/i) ? "yolo" : next?.title.match(/^(?:Analyze|Analizza IMG) \d+$/i) ? "analyze" : next?.title.match(/^Image \d+$/i) ? "image" : next?.title.match(/^Converti \d+$/i) ? "convert" : "normal");
      setAttachments([]);
      if (next && models.some((model) => model.id === next.modelId)) setSelectedModelId(next.modelId);
    }
  }

  function renameConversation(id: string) {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    setRenameDialog({ id, title: conversation.title });
  }

  async function createResearchEdition(type: "ai" | "papers" | "science") {
    researchAbortRef.current?.abort();
    const controller = new AbortController();
    researchAbortRef.current = controller;
    setResearchType(type); setResearchLoading(true); setResearchResult(null); setResearchPage(0); setResearchOpen(true);
    try {
      const response = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }), signal: controller.signal });
      const data = await readJsonResponse<{ label: string; article: string; sources: Array<{ id: number; title: string; url: string; description: string }>; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Ricerca non riuscita.");
      if (researchAbortRef.current === controller) setResearchResult(data);
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      if (researchAbortRef.current === controller) setResearchResult({ label: aborted ? "Operazione annullata" : "Errore", article: aborted ? "La creazione dell’edizione è stata annullata. Puoi riprovarla quando vuoi." : `**Ricerca non disponibile**\n\n${error instanceof Error ? error.message : "Errore sconosciuto."}`, sources: [] });
    } finally {
      if (researchAbortRef.current === controller) { researchAbortRef.current = null; setResearchLoading(false); }
    }
  }

  function stopResearch() { researchAbortRef.current?.abort(); }

  async function toggleResearchFullscreen() {
    const next = !researchFullscreen;
    setResearchFullscreen(next);
    try {
      if (next) await document.documentElement.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen?.();
    } catch { /* Alcuni browser mobile rifiutano l'API: resta attivo il fullscreen CSS. */ }
  }

  function downloadResearchEdition() {
    if (!researchResult) return;
    const sourceText = researchResult.sources.map(source => `[${source.id}] ${source.title}\n${source.url}`).join("\n\n");
    const escapedLabel = researchResult.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const article = researchResult.article.replace(new RegExp(`^\\s*#\\s+${escapedLabel}\\s*`, "iu"), "").trim();
    const content = `# ${researchResult.label}\n\nData: ${new Date().toLocaleDateString("it-IT")}\n\n${article}\n\n## Fonti consultate\n\n${sourceText}`;
    const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/markdown;charset=utf-8" }));
    const date = new Date().toLocaleDateString("it-IT").replaceAll("/", "_");
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `NEWS_ANDREA_GPT_${date}.md`; anchor.click(); URL.revokeObjectURL(url);
  }

  function researchPages(article: string) {
    const sections = article.split(/(?=^##\s)/m).map(section => section.trim()).filter(Boolean);
    return sections.length > 1 ? sections : [article];
  }

  function handleConvertedResult(result: Converted) {
    setMessages((current) => [...current, { id: createId(), role: "assistant", content: `Conversione completata: ${result.name}`, generatedFile: result }]);
  }

  async function sendMessage(text = input) {
    const content = text.trim();
    if ((!content && !attachments.length) || loading || (specialMode === "normal" && !selectedModel)) return;
    if (specialMode === "ocr") { await processOcrBatch(); return; }
    if (specialMode === "yolo") { await processYoloBatch(); return; }
    if (specialMode === "analyze") { await processAnalyzeBatch(content); return; }
    if (specialMode === "convert") return;
    if (specialMode === "image") { await processImage(content); return; }
    if (brainPrivate && (!isOllama || webSearchEnabled)) { setError("Brain e cronologia privata possono usare solo Ollama, senza web."); return; }
    if (isOllama && [...messages.flatMap((m) => m.attachments || []), ...attachments].some((a) => a.kind !== "text")) { setError("Ollama accetta solo testo. Questa conversazione contiene immagini/PDF: avvia una nuova chat o usa testo estratto."); return; }

    const userMessage: ChatMessage = { id: createId(), role: "user", content, attachments, webSearch: webSearchEnabled, brainPrivate };
    const mentionedSource = extractMentionedSource(content) || brainSource;
    const conversationId = activeConversationId || createId();
    stickToBottomRef.current = true;
    if (!activeConversationId) setActiveConversationId(conversationId);
    const assistantId = createId();
    const history = [...messages, userMessage];
    const attachmentMessageIndex = findLastAttachmentMessageIndex(history);
    setMessages([...history, { id: assistantId, role: "assistant", content: "", brainPrivate, modelId: selectedModel.id, modelName: selectedModel.name, modelProvider: selectedModel.provider }]);
    setInput("");
    setAttachments([]);
    setError("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const streamBatch = createStreamBatch((content) => {
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content } : message));
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel.id,
          provider: selectedModel.providerId,
          conversationId,
          brain: brainEnabled,
          codeAgent: codeAgentEnabled,
          brainPrivate,
          brainSource: mentionedSource || undefined,
          messages: [
            { role: "system", content: [selectedTask.prompt, renderCustomInstructions(customInstructions)].filter(Boolean).join("\n\n") },
            ...history.filter((message) => message.content || message.attachments?.length).map((message) => ({ ...toApiMessage(message, history.indexOf(message) === attachmentMessageIndex), brainPrivate: message.brainPrivate })),
          ],
          ...settings,
          temperature: brainEnabled ? Math.min(settings.temperature, 0.3) : settings.temperature,
          maxTokens: isOllama ? selectedOllamaProfile.maxTokens : settings.maxTokens,
          numCtx: isOllama ? selectedOllamaProfile.numCtx : 4096,
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
        if (done && buffer.trim()) lines.push(buffer);

        for (const line of lines) {
          const data = line.trim().replace(/^data:\s*/, "");
          if (!data || data === "[DONE]") continue;
          let event: { choices?: Array<{ delta?: { content?: string } }>; brainSources?: BrainCitation[]; webSources?: WebCitation[]; metrics?: Record<string, number>; diagnostics?: DiagnosticTrace; error?: string };
          try { event = JSON.parse(data); } catch { continue; }
            if (event.error) throw new Error(event.error);
            if (event.metrics) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, metrics: event.metrics } : message));
            if (event.diagnostics) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, diagnostics: event.diagnostics } : message));
            if (Array.isArray(event.brainSources)) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, brainSources: event.brainSources, brainPrivate: true } : message));
            if (Array.isArray(event.webSources)) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, webSources: event.webSources } : message));
            const token = event.choices?.[0]?.delta?.content ?? "";
            if (token) {
              fullText += token;
              streamBatch.append(token);
            }
        }
        if (done) break;
      }
      if (!fullText) throw new Error("Il modello non ha restituito contenuto.");
    } catch (caught) {
      streamBatch.flush();
      if ((caught as Error).name === "AbortError") {
        setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
      } else {
        setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
        setError(caught instanceof Error ? caught.message : "Si è verificato un errore.");
      }
    } finally {
      streamBatch.flush();
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  async function compactCurrentChat() {
    if (compactingChat || loading || !selectedModel || messages.filter(message => message.content.trim()).length === 0) return;
    if (selectedModel.providerId !== "ollama") { setError("La compattazione richiede un modello Ollama locale."); return; }
    setCompactingChat(true); setComposerToolsOpen(false); setError("");
    try {
      const response = await fetch("/api/chat/compact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selectedModel.id, messages: messages.filter(message => message.content.trim()).map(message => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content })) }) });
      const result = await response.json() as { error?: string; name?: string };
      if (!response.ok || !result.name) throw new Error(result.error || "Compattazione non riuscita.");
      setError(`Chat compatta salvata in OUTPUT/Compatta_chat/${result.name ?? ""}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Compattazione non riuscita."); }
    finally { setCompactingChat(false); }
  }

  function stopGeneration() {
    if (activeOperation?.label.startsWith("Analyze") && analyzeConversationIdRef.current === activeConversationIdRef.current) analyzeAbortRef.current?.abort();
    else abortRef.current?.abort();
  }

  function resizeInput(value: string) {
    setInput(value);
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Torna all'altezza naturale (una riga): se il contenuto non la supera,
    // non forzare nessuna altezza inline, così vuota o a una riga resta bassa.
    textarea.style.height = "auto";
    if (textarea.scrollHeight > textarea.clientHeight) {
      textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
    }
  }

  useEffect(() => {
    // Dopo l'invio l'input si svuota ma l'altezza inline resterebbe alta:
    // riporta la barra di scrittura a una riga.
    if (input) return;
    const textarea = textareaRef.current;
    if (textarea) textarea.style.height = "";
  }, [input]);

  async function addAttachments(files: FileList | File[]) {
    const selectedFiles = Array.from(files);
    if (!selectedFiles.length) return;
    const audioExtensions = /\.(?:aac|flac|m4a|mp3|mpeg|mp4|ogg|wav|webm)$/i;
    const audioFile = specialMode === "normal" ? selectedFiles.find(file => file.type.startsWith("audio/") || audioExtensions.test(file.name)) : undefined;
    if (audioFile) {
      if (selectedFiles.length > 1) { setError("Scegli un solo audio alla volta per la trascrizione."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
      await transcribeAudio(audioFile);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const availableSlots = MAX_ATTACHMENTS - attachments.length;
    if (availableSlots <= 0) {
      setError(`Puoi allegare al massimo ${MAX_ATTACHMENTS} file per messaggio.`);
      return;
    }

    const nextFiles = selectedFiles.slice(0, availableSlots);
    const currentSize = attachments.reduce((total, attachment) => total + attachment.size, 0);
    const maxAttachmentSize = specialMode === "analyze" ? ANALYZE_ATTACHMENT_SIZE : MAX_ATTACHMENT_SIZE;
    const maxAttachmentsSize = specialMode === "analyze" ? ANALYZE_ATTACHMENTS_SIZE : MAX_ATTACHMENTS_SIZE;
    if (specialMode === "analyze" && nextFiles.some((file) => file.size > maxAttachmentSize)) {
      setError("Analyze: ogni immagine può pesare al massimo 25 MB.");
      return;
    }
    if (specialMode === "analyze" && currentSize + nextFiles.reduce((total, file) => total + file.size, 0) > maxAttachmentsSize) {
      setError("Analyze: le immagini possono pesare al massimo 50 MB in totale.");
      return;
    }
    if (nextFiles.some((file) => file.size > maxAttachmentSize)) {
      setError("Ogni allegato può pesare al massimo 5 MB.");
      return;
    }
    if (currentSize + nextFiles.reduce((total, file) => total + file.size, 0) > maxAttachmentsSize) {
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

  function openSpecialChat(mode: Exclude<SpecialMode, "normal">) {
    abortRef.current?.abort();
    const initialInput = "";
    setLoading(false); setMessages([]); setAttachments([]); setInput(initialInput); setError(""); setBrainEnabled(false); setSpecialMode(mode); setAudioWelcomeMode("none");
    if (mode === "yolo") setYoloTask("detect");
    const prefix = mode === "ocr" ? "OCR" : mode === "yolo" ? "YOLO" : mode === "analyze" ? "Analyze" : mode === "image" ? "Image" : "Converti";
    const nextNumber = conversations.reduce((max, conversation) => {
      const match = conversation.title.match(mode === "analyze" ? /^(?:Analyze|Analizza IMG) (\d+)$/i : new RegExp(`^${prefix} (\\d+)$`, "i"));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const id = createId();
    const title = `${prefix} ${nextNumber}`;
    setActiveConversationId(id);
    setConversations((current) => [{ id, title, customTitle: true, messages: [], modelId: selectedModelId, updatedAt: Date.now() }, ...current]);
    // Precarica Qwen3-VL in background mentre l'utente allega le immagini.
    if (mode === "analyze") void fetch("/api/analyze-warmup", { method: "POST" }).catch(() => undefined);
    focusComposerAfterNavigation();
  }

  function focusComposerAfterNavigation() {
    if (window.matchMedia("(max-width: 850px), (pointer: coarse)").matches) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".conversation")?.scrollTo({ top: 0, behavior: "auto" }));
      return;
    }
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function processOcrBatch() {
    if (!attachments.length) { setError("OCR: allega una o più immagini o PDF."); return; }
    const pending = attachments;
    if (!activeConversationId) setActiveConversationId(createId());
    const assistantId = createId();
    setMessages((current) => [...current, { id: createId(), role: "user", content: "Esegui OCR sugli allegati.", attachments: pending }, { id: assistantId, role: "assistant", content: "Elaborazione OCR in corso…" }]);
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
    const assistantId = createId();
    setMessages((current) => [...current, { id: createId(), role: "user", content: "Analizza gli elementi nelle immagini con YOLO.", attachments }, { id: assistantId, role: "assistant", content: "Analisi YOLO in corso…" }]);
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

  async function processAnalyzeBatch(prompt: string) {
    const pending = attachments.filter((attachment) => attachment.kind === "image" && attachment.dataUrl);
    if (!pending.length) { setError("Analyze: allega una o più immagini."); return; }
    const question = prompt.trim() || "Descrivi dettagliatamente l'immagine in italiano. Elenca oggetti, posizione, testo visibile e dettagli incerti.";
    const conversationId = activeConversationId || createId();
    const userMessage: ChatMessage = { id: createId(), role: "user", content: question, attachments: pending };
    const assistantId = createId();
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", content: "Analyze · preparazione Qwen3-VL…" };
    const baseMessages = activeConversationId === conversationId ? messages : conversations.find((conversation) => conversation.id === conversationId)?.messages ?? [];
    const initialMessages = [...baseMessages, userMessage, assistantMessage];
    if (!activeConversationId) {
      activeConversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
    }
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === conversationId);
      const existingMessages = existing?.messages ?? baseMessages;
      const nextMessages = [...existingMessages, userMessage, assistantMessage];
      const title = existing?.customTitle ? existing.title : createConversationTitleFromMessages(nextMessages);
      const nextConversation: Conversation = {
        id: conversationId,
        title,
        customTitle: existing?.customTitle,
        brainPrivate: existing?.brainPrivate,
        messages: nextMessages,
        modelId: selectedModelId,
        updatedAt: Date.now(),
      };
      return existing ? current.map((conversation) => conversation.id === conversationId ? nextConversation : conversation) : [nextConversation, ...current];
    });
    if (activeConversationIdRef.current === conversationId) setMessages(initialMessages);
    setAttachments([]); setInput(""); setError(""); setLoading(true);
    setActiveOperation({ label: "Analyze", detail: "Preparazione del modello locale. Il primo avvio può richiedere alcuni minuti.", startedAt: Date.now() });
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    analyzeConversationIdRef.current = conversationId;
    const updateTargetMessages = (update: (current: ChatMessage[]) => ChatMessage[]) => {
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? { ...conversation, messages: update(conversation.messages), updatedAt: Date.now() }
        : conversation));
      if (activeConversationIdRef.current === conversationId) setMessages(update);
    };
    try {
      const results: string[] = [];
      for (const [index, attachment] of pending.entries()) {
        const imageStarted = performance.now();
        if (activeConversationIdRef.current === conversationId) {
          setActiveOperation({ label: `Analyze ${index + 1}/${pending.length}`, detail: `Caricamento e analisi di ${attachment.name}. Il processo è attivo; puoi interromperlo con Stop.`, startedAt: Date.now() });
        }
        updateTargetMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: `Analyze · immagine ${index + 1}/${pending.length} · modello locale in elaborazione…` } : message));
        const response = await fetch("/api/analyze-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: attachment.name, type: attachment.type, prompt: question, data: attachment.dataUrl }), signal: controller.signal });
        const result = await readJsonResponse<{ text?: string; error?: string; resized?: { width: number; height: number }; model?: string; device?: string }>(response);
        if (!response.ok) throw new Error(result.error || `Analisi non riuscita per ${attachment.name}.`);
        const sizeNote = result.resized ? `\n\n_Input ridimensionato a ${result.resized.width}×${result.resized.height} per il modello._` : "";
        const elapsed = Math.max(1, Math.round((performance.now() - imageStarted) / 1000));
        const elapsedLabel = `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`;
        const infoNote = `\n\n> Analisi completata · tempo: ${elapsedLabel} · modello: ${result.model || "Qwen3-VL"}${result.device ? ` · dispositivo: ${result.device}` : ""}`;
        results.push(`### ${attachment.name}\n${result.text || "Nessuna descrizione restituita."}${sizeNote}${infoNote}`);
        updateTargetMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: results.join("\n\n") } : message));
      }
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === "AbortError";
      updateTargetMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: aborted ? "Analyze annullato dall’utente." : `Analyze non riuscito: ${caught instanceof Error ? caught.message : "errore sconosciuto"}` } : message));
      if (!aborted && activeConversationIdRef.current === conversationId) setError(caught instanceof Error ? caught.message : "Analisi immagine non riuscita.");
    } finally {
      if (analyzeAbortRef.current === controller) {
        analyzeAbortRef.current = null;
        analyzeConversationIdRef.current = "";
        if (activeConversationIdRef.current === conversationId) { setLoading(false); setActiveOperation(null); }
      }
    }
  }
  async function processImage(prompt: string) {
    if (!prompt.trim()) { setError("Descrivi l'immagine che vuoi creare."); return; }
    if (!imageService.ready) { setError("ComfyUI è ancora in avvio. Attendi che lo stato diventi Operativo."); return; }
    const assistantId = createId();
    const conversationId = activeConversationId;
    setMessages(current => [...current, { id: createId(), role: "user", content: prompt }, { id: assistantId, role: "assistant", content: "ComfyUI · generazione avviata · 0%" }]);
    setInput(""); setError(""); setLoading(true);
    const started = performance.now();
    try {
      const response = await fetch("/api/image/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, ...imageSettings, flow: imageModel }) });
      const queued = await response.json() as { error?: string; jobId?: string };
      if (!response.ok || !queued.jobId) throw new Error(queued.error || "Generazione non avviata.");
      setMessages(current => current.map(message => message.id === assistantId ? { ...message, content: `ComfyUI · ID processo: ${queued.jobId} · generazione avviata · 0%` } : message));
      let result: { error?: string; name?: string; url?: string; output?: string; width?: number; height?: number; seed?: number; device?: string; model?: string; generationMs?: number } = {};
      for (;;) {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        const jobResponse = await fetch(`/api/image/jobs/${encodeURIComponent(queued.jobId)}`);
        const job = await jobResponse.json() as typeof result & { status?: string };
        if (job.status === "running") {
          const elapsedSeconds = Math.max(1, Math.round((performance.now() - started) / 1000));
          const elapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
          setMessages(current => current.map(message => message.id === assistantId ? { ...message, content: `ComfyUI · generazione in corso · avanzamento: ${elapsed}` } : message));
          continue;
        }
        if (!jobResponse.ok) throw new Error(job.error || "Generazione immagine non riuscita.");
        result = job;
        break;
      }
      if (!result.url || !result.name) throw new Error(result.error || "Generazione non riuscita.");
      const complete = (message: ChatMessage): ChatMessage => message.id === assistantId ? { ...message, content: "Immagine pronta.", metrics: { totalMs: result.generationMs ?? Math.round(performance.now() - started) }, generatedImage: { url: result.url!, name: result.name!, width: result.width!, height: result.height!, seed: result.seed!, output: result.output!, device: result.device, model: result.model ?? "Qwen/Qwen-Image-2.1" } } : message;
      setConversations(current => current.map(conversation => conversation.id === conversationId ? { ...conversation, messages: conversation.messages.map(complete), updatedAt: Date.now() } : conversation));
      if (activeConversationIdRef.current === conversationId) setMessages(current => current.map(complete));
      setImageSettings(current => ({ ...current, seed: Math.floor(Math.random() * 2147483647) }));
    } catch (caught) {
      const failed = (message: ChatMessage): ChatMessage => message.id === assistantId ? { ...message, content: `Generazione non riuscita: ${caught instanceof Error ? caught.message : "errore sconosciuto"}` } : message;
      setConversations(current => current.map(conversation => conversation.id === conversationId ? { ...conversation, messages: conversation.messages.map(failed), updatedAt: Date.now() } : conversation));
      if (activeConversationIdRef.current === conversationId) setMessages(current => current.map(failed));
    } finally { setLoading(false); }
  }

  if (new URLSearchParams(window.location.search).get("brainGraph") === "1") return <Suspense fallback={<div className="thinking">Caricamento grafo…</div>}><BrainGraph standalone /></Suspense>;

  return (
    <div ref={appShellRef} className="app-shell" data-theme={theme}>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><img src="/andreagpt-logo-Photoroom.png" alt="" /></div>
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
            <span>Modelli</span><span className="section-summary"><span className="count">{visibleModels.length}</span><ChevronDown size={14} /></span>
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
          {modelsCollapsed && <img className="sidebar-mascot" src={mascotUrl} alt="Mascotte AndreaGPT" />}
          <button className="sidebar-action" onClick={() => setBrainOpen(true)}><Folder size={17} /> Archivio Brain</button>
          <button className="sidebar-action" onClick={() => { setOutputOpen(true); void fetch("/api/output").then(response => response.json()).then(data => setOutputFiles(data)).catch(() => setOutputFiles({ images: [], ocr: [], yolo: [], compactChat: [] })); }}><Folder size={17} /> Output</button>
          <button className="sidebar-action" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /> Impostazioni</button>
          <button className="sidebar-action" onClick={() => setInstructionsOpen(true)}><FileText size={17} /> Istruzioni</button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu" />}

      <main className="main-panel" style={{ "--chat-font": fonts[appearance.preferences.font], "--chat-font-size": `${appearance.preferences.size}px` } as React.CSSProperties}>
        <UniverseBackground key={`${appearance.pictures.map(picture => picture.id).join("|")}:${appearance.preferences.pinned ?? ""}`} images={appearance.pictures.map(picture => ({ id: picture.id, url: picture.url }))} pinnedId={appearance.preferences.pinned} />
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Apri menu"><Menu size={21} /></button>
          <div className="model-title">
            <span className="status-dot" />
            {specialMode === "ocr"
              ? <div><strong>OCR locale</strong><small>Estrazione testo da immagini e PDF</small></div>
              : specialMode === "yolo"
                ? <div><strong>Analisi immagine Yolo</strong><small>Detection, segmentazione e visione</small></div>
                : specialMode === "analyze"
                  ? <div><strong>Analyze</strong><small>Visione locale con Qwen3-VL</small></div>
                : imageConversation
                  ? <div><strong>Qwen Image 2.1</strong><small>Generazione immagini locale</small></div>
                : <div><div className="model-name-line"><strong>{selectedModel?.name ?? "Caricamento modelli"}</strong><small className="model-token">~{estimatedTokens.toLocaleString("it-IT")} token</small></div></div>}
          </div>
          <div className="topbar-actions">
            <button className="topbar-tools-trigger" onClick={() => { setTopbarMenuOpen((open) => !open); setAudioMenuOpen(false); }} aria-expanded={topbarMenuOpen} aria-haspopup="menu"><Settings2 size={18} /><span>Gestione</span><ChevronDown size={15} /></button>
            <div className={`topbar-tools-menu ${topbarMenuOpen ? "open" : ""}`} role="menu" onClick={() => { setTopbarMenuOpen(false); setAudioMenuOpen(false); setFileMenuOpen(false); }}>
            <div className="topbar-primary-tools">
              <div className="audio-topbar-menu" onClick={(event) => event.stopPropagation()}>
                <button type="button" className={`brain-library-button audio-tool-button ${audioMenuOpen ? "active" : ""}`} onClick={() => setAudioMenuOpen((open) => !open)} aria-expanded={audioMenuOpen} aria-haspopup="menu" disabled={loading}><AudioLines size={17} /><span>Audio</span><ChevronDown size={14} /></button>
                {audioMenuOpen && <div className="audio-topbar-dropdown" role="menu">
                  <button type="button" onClick={() => { openAudioWelcome("transcribe"); setAudioMenuOpen(false); setTopbarMenuOpen(false); }}><AudioLines size={17} /><span>Trascrivi audio</span></button>
                  <button type="button" onClick={() => { openAudioWelcome("record"); setAudioMenuOpen(false); setTopbarMenuOpen(false); }}><AudioLines size={17} /><span>Registra audio</span></button>
                </div>}
              </div>
              <button type="button" className="brain-library-button audio-split-transcribe" onClick={() => { openAudioWelcome("transcribe"); setAudioMenuOpen(false); setTopbarMenuOpen(false); }} disabled={loading} title="Trascrivi audio in una nuova conversazione"><AudioLines size={17} /><span>Trascrivi</span></button>
              <button type="button" className={`brain-library-button audio-split-record ${recording ? "active" : ""}`} onClick={() => { openAudioWelcome("record"); setAudioMenuOpen(false); setTopbarMenuOpen(false); }} disabled={loading} title="Registra audio in una nuova conversazione"><Mic size={17} /><span>{recording ? "Termina" : "Registra"}</span></button>
              <div className="file-topbar-menu" onClick={(event) => event.stopPropagation()}>
                <button type="button" className={`brain-library-button file-tool-button ${fileMenuOpen ? "active" : ""}`} onClick={() => setFileMenuOpen((open) => !open)} aria-expanded={fileMenuOpen} aria-haspopup="menu" disabled={loading}><Folder size={17} /><span>File</span><ChevronDown size={14} /></button>
                {fileMenuOpen && <div className="file-topbar-dropdown" role="menu">
                  <button type="button" onClick={() => { openSpecialChat("ocr"); setFileMenuOpen(false); setTopbarMenuOpen(false); }}><ScanLine size={17} /><span>OCR</span></button>
                  <button type="button" onClick={() => { openSpecialChat("convert"); setFileMenuOpen(false); setTopbarMenuOpen(false); }}><FileOutput size={17} /><span>Converti</span></button>
                </div>}
              </div>
            <button className={`brain-mode-button ${webSearchEnabled ? "active" : ""}`} onClick={() => setWebSearchEnabled((enabled) => !enabled)} disabled={loading || brainPrivate || webAvailable === false} aria-pressed={webSearchEnabled} title={brainPrivate ? "Web bloccato: la conversazione Brain è privata" : webAvailable === false ? "Ricerca Web non disponibile" : webSearchEnabled ? "Ricerca Web attiva" : "Ricerca Web disattivata"}><Globe2 size={18} /><span>Web {webSearchEnabled ? "ON" : "OFF"}</span></button>
            <button className={`brain-mode-button ${brainEnabled ? "active" : ""}`} onClick={() => setBrainMode(!brainEnabled)} disabled={loading} aria-pressed={brainEnabled} title={brainEnabled ? "I documenti Brain vengono consultati" : "Brain spento: i documenti non vengono consultati"}><Network className="brain-symbol" size={18} /><span>Brain {brainEnabled ? "ON" : "OFF"}</span></button>
            <button className={`brain-mode-button ${codeAgentEnabled ? "active" : ""}`} onClick={() => {setCodeAgentEnabled(!codeAgentEnabled);setWebSearchEnabled(false);}} disabled={loading || !isOllama} aria-pressed={codeAgentEnabled} title="Legge il progetto configurato e propone modifiche senza applicarle. Richiede un modello locale con strumenti.">Codice {codeAgentEnabled ? "ON" : "OFF"}</button>
            <button className={`brain-library-button yolo-button ${specialMode === "yolo" ? "active" : ""}`} onClick={() => openSpecialChat("yolo")} disabled={loading} title="Apri una nuova chat YOLO"><YoloIcon /><span>YOLO</span></button>
            <button className={`brain-library-button analyze-button ${specialMode === "analyze" ? "active" : ""}`} onClick={() => openSpecialChat("analyze")} disabled={loading} title="Analizza immagini con Qwen3-VL"><Eye size={17} /><span>Analyze</span></button>
            <button className={`brain-library-button image-button ${specialMode === "image" ? "active" : ""}`} onClick={() => openSpecialChat("image")} disabled={loading} title="Crea immagini con Qwen-Image-2.1"><Image size={17} /><span>Image</span></button>
            <button className="brain-library-button news-button" onClick={() => setResearchOpen(true)} disabled={loading} title="Crea un giornale di notizie e paper"><Newspaper size={17} /><span>News</span></button>
            {/* Task specifico rimosso dalla barra: le chat dedicate selezionano direttamente la loro operazione. */}{false && <div className="task-selector">
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
            </div>}
            </div>
            <div className="topbar-menu-footer">
              <div className="topbar-footer-actions">
                <button className="icon-button mobile-new-chat" onClick={newChat} disabled={loading} aria-label="Nuova chat" title="Nuova chat"><Plus size={21} /></button>
                <button className="icon-button fullscreen-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Esci dallo schermo intero" : "Attiva schermo intero"} title={fullscreen ? "Esci dallo schermo intero" : "Schermo intero"}>{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>
              </div>
              <span className="menu-footer-brand">AndreaGPT</span>
            </div>
            </div>
          </div>
        </header>

        <section ref={conversationRef} onScroll={handleConversationScroll} className={`conversation ${messages.length ? "has-messages" : ""}${!messages.length && specialMode === "normal" ? " home-empty" : ""}`}>
          {!messages.length ? (
            <div className="welcome-stage">
            <div className={`welcome${specialMode !== "normal" || audioWelcomeMode !== "none" ? " welcome-plain" : " home-welcome"}${audioWelcomeMode !== "none" ? " audio-mode-welcome" : ""}`}>
              {audioWelcomeMode === "transcribe" && <div className="audio-mode-card"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("transcribe")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button>{editingCard === "transcribe" ? <div className="welcome-edit-form"><label>Titolo<input value={cardDraft.title} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Etichetta<input value={cardDraft.accent} maxLength={40} onChange={(event) => setCardDraft((current) => ({ ...current, accent: event.target.value }))} /></label><div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={() => setEditingCard(null)}>Annulla</button><button type="button" className="primary-action" onClick={() => saveCardEdit("transcribe")}>Salva</button></div></div> : <AudioWelcomeCard variant="transcribe" recording={recording} transcribing={transcribing} idleTitle={cardTexts.transcribe.title} kicker={cardTexts.transcribe.accent} onUpload={() => audioInputRef.current?.click()} />}</div>}
              {audioWelcomeMode === "record" && <div className="audio-mode-card"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("record")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button>{editingCard === "record" ? <div className="welcome-edit-form"><label>Titolo<input value={cardDraft.title} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Etichetta<input value={cardDraft.accent} maxLength={40} onChange={(event) => setCardDraft((current) => ({ ...current, accent: event.target.value }))} /></label><div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={() => setEditingCard(null)}>Annulla</button><button type="button" className="primary-action" onClick={() => saveCardEdit("record")}>Salva</button></div></div> : <AudioWelcomeCard variant="record" recording={recording} transcribing={transcribing} fileName={recordingFileName} idleTitle={cardTexts.record.title} kicker={cardTexts.record.accent} onRecord={() => void toggleRecording()} />}</div>}
              {specialMode === "analyze" && <div className="special-welcome-card analyze-welcome"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("analyze")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button><span className="welcome-kicker">QWEN3-VL LOCALE</span>{editingCard === "analyze" ? <div className="welcome-edit-form"><label>Titolo<input value={cardDraft.title} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Accento<input value={cardDraft.accent} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, accent: event.target.value }))} /></label><label>Descrizione<textarea value={cardDraft.subtitle} maxLength={220} rows={2} onChange={(event) => setCardDraft((current) => ({ ...current, subtitle: event.target.value }))} /></label><div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={() => setEditingCard(null)}>Annulla</button><button type="button" className="primary-action" onClick={() => saveCardEdit("analyze")}>Salva</button></div></div> : <><h1>{cardTexts.analyze.title}<br /><em>{cardTexts.analyze.accent}</em></h1><p>{cardTexts.analyze.subtitle}</p></>}<button className="special-upload-button" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /> Carica immagini</button></div>}
              {specialMode === "convert" && <div className="special-welcome-card convert-welcome"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("convert")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button><span className="welcome-kicker">CONVERSIONE LOCALE</span>{editingCard === "convert" ? <div className="welcome-edit-form"><label>Titolo<input value={cardDraft.title} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Accento<input value={cardDraft.accent} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, accent: event.target.value }))} /></label><div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={() => setEditingCard(null)}>Annulla</button><button type="button" className="primary-action" onClick={() => saveCardEdit("convert")}>Salva</button></div></div> : <h1>{cardTexts.convert.title}<br /><em>{cardTexts.convert.accent}</em></h1>}<Suspense fallback={<div className="thinking">Caricamento convertitore…</div>}><ConvertPanel onResult={handleConvertedResult} /></Suspense></div>}{specialMode === "image" && <div className="special-welcome-card image-welcome"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("image")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button><span className="welcome-kicker">QWEN IMAGE 2.1</span><div className={`image-service-status ${imageService.status}`}><span className="status-dot" />{imageService.message}</div>{editingCard === "image" ? <div className="welcome-edit-form"><label>Titolo<input value={cardDraft.title} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Accento<input value={cardDraft.accent} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, accent: event.target.value }))} /></label><div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={() => setEditingCard(null)}>Annulla</button><button type="button" className="primary-action" onClick={() => saveCardEdit("image")}>Salva</button></div></div> : <h1>{cardTexts.image.title}<br /><em>{cardTexts.image.accent}</em></h1>}<p>{imageService.ready ? "Motore immagini pronto. I risultati vengono salvati in OUTPUT/Image." : "Puoi usare subito le altre chat: il motore immagini si sta preparando in background."}</p><div className="image-model-row" role="radiogroup" aria-label="Modello di generazione"><button type="button" role="radio" aria-checked={imageModel === "qwen"} className={imageModel === "qwen" ? "active" : ""} onClick={() => setImageModel("qwen")} title="Qwen-Image 2.1: qualità massima, ~25 passi"><strong>Qwen-Image 2.1</strong><small>Qualità · {imageSettings.steps} passi</small></button><button type="button" role="radio" aria-checked={imageModel === "viggle"} className={imageModel === "viggle" ? "active" : ""} onClick={() => setImageModel("viggle")} title="Viggle Turbo v0.2.1: distillato a 6 passi, circa 6 volte più veloce"><strong>Viggle Turbo</strong><small>Veloce · 6 passi fissi</small></button></div><div className="image-preset-row"><span>{imageSettings.width}×{imageSettings.height}</span><span>{imageSettings.steps} step</span><span>Seed {imageSettings.seed}</span></div></div>}
              {specialMode === "convert" ? null : specialMode === "ocr" ? <div className="special-welcome-card"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("ocr")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button><span className="welcome-kicker">OCR LOCALE</span>{editingCard === "ocr" ? <div className="welcome-edit-form"><label>Titolo<input value={cardDraft.title} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Accento<input value={cardDraft.accent} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, accent: event.target.value }))} /></label><label>Descrizione<textarea value={cardDraft.subtitle} maxLength={220} rows={2} onChange={(event) => setCardDraft((current) => ({ ...current, subtitle: event.target.value }))} /></label><div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={() => setEditingCard(null)}>Annulla</button><button type="button" className="primary-action" onClick={() => saveCardEdit("ocr")}>Salva</button></div></div> : <><h1>{cardTexts.ocr.title}<br /><em>{cardTexts.ocr.accent}</em></h1><p>{cardTexts.ocr.subtitle}</p></>}<button className="special-upload-button" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /> Carica immagini o PDF</button></div> : specialMode === "yolo" ? <div className="special-welcome-card"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("yolo")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button><span className="welcome-kicker">YOLO VISION</span>{editingCard === "yolo" ? <div className="welcome-edit-form"><label>Titolo<input value={cardDraft.title} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Accento<input value={cardDraft.accent} maxLength={80} onChange={(event) => setCardDraft((current) => ({ ...current, accent: event.target.value }))} /></label><label>Descrizione<textarea value={cardDraft.subtitle} maxLength={220} rows={2} onChange={(event) => setCardDraft((current) => ({ ...current, subtitle: event.target.value }))} /></label><div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={() => setEditingCard(null)}>Annulla</button><button type="button" className="primary-action" onClick={() => saveCardEdit("yolo")}>Salva</button></div></div> : <><h1>{cardTexts.yolo.title}<br /><em>{cardTexts.yolo.accent}</em></h1><p>{cardTexts.yolo.subtitle}</p></>}<label className="special-task-select">Task YOLO<select value={yoloTask} onChange={(event) => setYoloTask(event.target.value as YoloTask)}><option value="detect">Detection</option><option value="segment">Segmentazione</option><option value="classify">Classificazione</option><option value="pose">Pose</option><option value="obb">Object detection orientata</option></select></label><button className="special-upload-button" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /> Carica immagini</button></div> : <><button type="button" className="welcome-edit-button" onClick={() => { setWelcomeDraft({ title: welcomeTitle, accent: welcomeAccent, subtitle: welcomeSubtitle }); setWelcomeEditing(true); }} title="Modifica testo di benvenuto" aria-label="Modifica testo di benvenuto"><Pencil size={15} /></button><span className="welcome-kicker">ANDREAGPT</span>{welcomeEditing ? <div className="welcome-edit-form"><label>Titolo<input value={welcomeDraft.title} maxLength={80} onChange={(event) => setWelcomeDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Accento<input value={welcomeDraft.accent} maxLength={80} onChange={(event) => setWelcomeDraft((current) => ({ ...current, accent: event.target.value }))} /></label><label>Descrizione<textarea value={welcomeDraft.subtitle} maxLength={220} rows={2} onChange={(event) => setWelcomeDraft((current) => ({ ...current, subtitle: event.target.value }))} /></label><div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={() => setWelcomeEditing(false)}>Annulla</button><button type="button" className="primary-action" onClick={() => { const title = welcomeDraft.title.trim() || welcomeTitle; const accent = welcomeDraft.accent.trim() || welcomeAccent; const subtitle = welcomeDraft.subtitle.trim() || welcomeSubtitle; setWelcomeTitle(title); setWelcomeAccent(accent); setWelcomeSubtitle(subtitle); setWelcomeEditing(false); }}>Salva</button></div></div> : <><h1>{welcomeTitle} <em>{welcomeAccent}</em></h1><img className="welcome-cetriolo" src="/mascotte-Photoroom.png" alt="Mascotte AndreaGPT" /><p>{welcomeSubtitle}</p></>}</>}
             </div>
             </div>
           ) : (
            <div className="message-list">
              {messages.map((message, messageIndex) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-avatar">{message.role === "user" ? <img src="/cetriolo.png" alt="Tu" /> : <img src="/andreagpt-logo-Photoroom.png" alt="AndreaGPT" />}</div>
                  <div className="message-content">
                    <div className="message-meta">{message.role === "user" ? "Tu" : specialMode === "ocr" ? "OCR locale" : specialMode === "yolo" ? "YOLO locale" : specialMode === "analyze" ? "Analyze" : specialMode === "image" ? "Qwen-Image-2.1" : specialMode === "convert" ? "Conversione locale" : message.modelName ?? selectedModel?.name}{message.role === "assistant" && message.modelProvider && <span className="message-model-provider">{message.modelProvider}</span>}{message.webSearch && <span className="web-search-badge"><Globe2 size={10} /> Web</span>}</div>
                    {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
                    {message.generatedImage && <a className="generated-image" href={message.generatedImage.url} download={message.generatedImage.name} title="Scarica immagine"><img src={message.generatedImage.url} alt={message.content || "Immagine generata"} /></a>}
                    {message.generatedFile && <button type="button" className="generated-file-download" onClick={() => downloadConverted(message.generatedFile!)}><Download size={16} /> Scarica {message.generatedFile.name}</button>}
                    {message.audio?.status === "transcribing" && !message.content && <div className="audio-chat-status" role="status" aria-live="polite"><AudioCassette playing /><div><strong>Sto trascrivendo audio</strong><span>{message.audio.fileName}</span></div></div>}
                    {message.content ? specialMode === "ocr" && message.role === "assistant" && !message.content.startsWith("Elaborazione OCR") ? <div className="ocr-result-editor"><textarea value={message.content} onChange={(event) => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, content: event.target.value } : item))} aria-label="Modifica risultato OCR" /><div className="ocr-result-actions"><button onClick={() => saveTextResult(message.content, "risultato-ocr.txt")}>Salva risultato</button></div></div> : <MarkdownMessage content={message.content} privateMode={Boolean(brainPrivate || message.brainPrivate)} /> : message.audio?.status === "transcribing" ? null : message.role === "assistant" ? brainEnabled ? <div className="thinking">Ricerca nelle fonti Brain…</div> : <div className="thinking"><span /><span /><span /></div> : null}
                    {message.content && <div className="message-footer"><div className="message-actions"><button type="button" onClick={() => void copyMessage(message)} title={copiedMessageId === message.id ? "Testo copiato" : "Copia il testo"} aria-label={copiedMessageId === message.id ? "Testo copiato" : "Copia il testo"}><Copy size={14} /></button><button type="button" onClick={() => editAndResend(message)} title="Modifica e invia" aria-label="Modifica e invia"><Pencil size={14} /></button>{message.role === "assistant" && message.brainSources?.length ? <><MicelioScore message={message} /><span className="brain-feedback" aria-label="Valuta la risposta Brain"><button className={message.feedback === 1 ? "active" : ""} type="button" onClick={() => void rateBrainMessage(message, messageIndex, 1)} title="Risposta utile: rafforza queste fonti"><ThumbsUp size={14} /></button><button className={message.feedback === -1 ? "active negative" : ""} type="button" onClick={() => void rateBrainMessage(message, messageIndex, -1)} title="Risposta errata: segnala un disallineamento semantico e penalizza queste fonti"><ThumbsDown size={14} /></button></span></> : null}</div>
                    {message.brainSources && <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.brain)} onClick={() => toggleMessagePanel(message.id, "brain")}>{openMessagePanels[message.id]?.brain ? "▼" : "▶"} Fonti Brain ({message.brainSources.length})</button>}
                    {message.webSources && <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.web)} onClick={() => toggleMessagePanel(message.id, "web")}>{openMessagePanels[message.id]?.web ? "▼" : "▶"} Fonti Web ({message.webSources.length})</button>}
                    {message.generatedImage && <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.image)} onClick={() => toggleMessagePanel(message.id, "image")}>{openMessagePanels[message.id]?.image ? "▼" : "▶"} Dettagli immagine</button>}
                    {message.metrics && <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.metrics)} onClick={() => toggleMessagePanel(message.id, "metrics")}>{openMessagePanels[message.id]?.metrics ? "▼" : "▶"} Tempi</button>}
                    {message.diagnostics && <button type="button" className="citation-toggle diagnostics-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.diagnostics)} onClick={() => toggleMessagePanel(message.id, "diagnostics")}>{openMessagePanels[message.id]?.diagnostics ? "▼" : "▶"} Log ({message.diagnostics.events.filter(event => event.status === "warning" || event.status === "error").length})</button>}
                    {message.brainSources && openMessagePanels[message.id]?.brain && <div className="citation-panel">{message.brainSources.length ? message.brainSources.map((source) => <div key={source.id}><strong>[{source.id}] {source.source}{source.micelioScore !== undefined && <small className="citation-micelio-score"> · Micelio {Math.round(source.micelioScore * 100)}%</small>}</strong><p>{source.text}</p></div>) : <p>Nessuna fonte pertinente trovata nell'indice.</p>}</div>}
                    {message.webSources && openMessagePanels[message.id]?.web && <div className="citation-panel web-citations">{message.webSources.length ? message.webSources.map((source) => <div key={source.source}><strong>[{source.source}] <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></strong><p>{source.excerpt}</p></div>) : <p>Nessuna fonte Web datata e verificabile trovata.</p>}</div>}
                    {message.generatedImage && openMessagePanels[message.id]?.image && <div className="citation-panel image-details"><p>Modello: {message.generatedImage.model ?? "Qwen/Qwen-Image-2.1"}<br />Formato: {message.generatedImage.width}×{message.generatedImage.height}<br />Seed: {message.generatedImage.seed}<br />Dispositivo: {message.generatedImage.device ?? "xpu"}<br />File: {message.generatedImage.output}</p></div>}
                    {message.metrics && openMessagePanels[message.id]?.metrics && <div className="citation-panel metrics-citations"><p>
                      {message.metrics.retrievalMs !== undefined && <>Ricerca: {(message.metrics.retrievalMs / 1000).toFixed(2)} s · </>}
                      {message.metrics.firstTokenMs !== undefined && <>Prima risposta: {(message.metrics.firstTokenMs / 1000).toFixed(1)} s · </>}
                      Totale: {((message.metrics.totalMs ?? 0) / 1000).toFixed(1)} s
                    </p>{message.metrics.routerLatencyMs !== undefined && <p>Router locale — percorso: {message.metrics.routerRoute === 1 ? "Brain" : message.metrics.routerRoute === 2 ? "Web" : "normale"} · confidenza: {((message.metrics.routerConfidence ?? 0) * 100).toFixed(1)}% · latenza: {message.metrics.routerLatencyMs.toFixed(3)} ms</p>}<p>Token in ingresso: {message.metrics.prompt_eval_count ?? "—"} · Token generati: {message.metrics.eval_count ?? "—"}{message.metrics.eval_duration ? <> · Velocità: {(Number(message.metrics.eval_count ?? 0) / (message.metrics.eval_duration / 1_000_000_000)).toFixed(1)} tok/s</> : null}</p>{(message.metrics.load_duration || message.metrics.prompt_eval_duration || message.metrics.eval_duration) ? <p className="metrics-runtime">Ollama — caricamento: {message.metrics.load_duration ? (message.metrics.load_duration / 1_000_000_000).toFixed(2) : "—"} s · prompt: {message.metrics.prompt_eval_duration ? (message.metrics.prompt_eval_duration / 1_000_000_000).toFixed(2) : "—"} s · generazione: {message.metrics.eval_duration ? (message.metrics.eval_duration / 1_000_000_000).toFixed(2) : "—"} s</p> : null}{(message.metrics.cpuUserMs !== undefined || message.metrics.rssMb !== undefined) && <p>Server — CPU: {((message.metrics.cpuUserMs ?? 0) + (message.metrics.cpuSystemMs ?? 0)) / 1000}s · RAM: {message.metrics.rssMb ?? "—"} MiB</p>}</div>}</div>}
                    {message.diagnostics && openMessagePanels[message.id]?.diagnostics && <div className="citation-panel diagnostic-log"><p className="diagnostic-request-id">Request ID: <button type="button" onClick={() => setDiagnosticReportMessageId(message.id)} title="Apri il report diagnostico"><code>{message.diagnostics.requestId}</code></button></p>{message.diagnostics.events.map((event, index) => <div className={`diagnostic-event ${event.status}`} key={`${event.at}-${index}`}><span className="diagnostic-status" aria-label={event.status}>{event.status === "ok" ? "✓" : event.status === "warning" ? "!" : event.status === "error" ? "×" : "i"}</span><div><strong>{event.stage.toUpperCase()}</strong> — {event.message}{event.durationMs !== undefined && <small> · {event.durationMs} ms</small>}{event.details && <dl>{Object.entries(event.details).map(([key, value]) => <span key={key}><dt>{key}</dt><dd>{value === null ? "—" : String(value)}</dd></span>)}</dl>}</div></div>)}</div>}
                  </div>
                </article>
              ))}
            </div>
           )}
        </section>

        <footer className="composer-wrap">
          {error && <div className="error-banner" role="alert" aria-live="assertive"><span><strong>Attenzione</strong>{error}</span><button onClick={() => setError("")} aria-label="Chiudi notifica"><X size={20} /></button></div>}
          {!configured && configured !== null && <div className="config-banner"><Info size={15} /> Verifica il server AndreaGPT. Ollama locale non richiede chiavi cloud.</div>}
          <div className={`composer ${specialMode !== "normal" ? "special-composer" : ""}`}>
            {(recording || transcribing) && <div className="audio-status" role="status"><span className={recording ? "recording-dot" : ""} />{recording ? "Sto registrando audio" : "Sto trascrivendo audio"}</div>}
            {activeOperation && <div className="operation-status" role="status" aria-live="polite"><span className="operation-pulse" /><span><strong>{activeOperation.label} · {formatElapsed(operationSeconds)}</strong><small>{activeOperation.detail}</small></span></div>}
            {specialMode !== "normal" && <div className="special-composer-label"><strong>{specialMode === "convert" ? null : specialMode === "ocr" ? "OCR locale" : specialMode === "yolo" ? "YOLO locale" : specialMode === "analyze" ? "Analyze" : "Qwen-Image-2.1"}</strong>{specialMode === "image" && <span><a href={comfyBrowserUrl()} target="_blank" rel="noreferrer">ComfyUI</a> · {imageService.ready ? "operativo · descrivi l'immagine" : "in avvio · attendi lo stato operativo"}</span>}</div>}
            {attachments.length > 0 && <AttachmentList attachments={attachments} removable onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} />}
            {brainSource && <div className="mention-filter-chip" title="Filtro Brain attivo: la ricerca è limitata a questa fonte. Rimuovilo per cercare in tutto l'archivio."><span><span>@</span>{brainSource}</span><button type="button" onClick={() => setBrainSource("")} aria-label="Rimuovi filtro fonte Brain"><X size={14} /></button></div>}
            <div className="composer-row">
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                multiple
                accept={specialMode === "ocr" ? "image/*,.pdf" : specialMode === "yolo" || specialMode === "analyze" ? "image/*" : specialMode === "normal" ? "image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.sql,.yaml,.yml,.log,.sh,.ps1,audio/*,.aac,.flac,.m4a,.mp3,.mpeg,.mp4,.ogg,.wav,.webm" : "image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.sql,.yaml,.yml,.log,.sh,.ps1"}
                onChange={(event) => void addAttachments(event.target.files ?? [])}
              />
              <input ref={audioInputRef} className="file-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac,.aac" onChange={event => { const audio = event.target.files?.[0]; if (audio) void transcribeAudio(audio); }} />
              <div className="composer-tools" ref={composerToolsRef}><button className={`attach-button tools-toggle ${composerToolsOpen ? "active" : ""}`} onClick={() => setComposerToolsOpen((open) => !open)} aria-expanded={composerToolsOpen} aria-haspopup="menu" aria-label="Apri strumenti" title="Strumenti"><Settings2 size={18} /></button>{composerToolsOpen && <div className="composer-tools-menu" role="menu">
                <button onClick={() => { setComposerToolsOpen(false); fileInputRef.current?.click(); }} disabled={loading || attachments.length >= MAX_ATTACHMENTS}><Paperclip size={17} /><span>Allega file</span></button>
                <button onClick={() => void compactCurrentChat()} disabled={loading || compactingChat || messages.filter(message => message.content.trim()).length === 0}><Archive size={17} /><span>{compactingChat ? "Compatto…" : "Compatta chat"}</span></button>
                {specialMode === "normal" && <><button onClick={() => openAudioWelcome("transcribe")} disabled={loading || recording || transcribing}><AudioLines size={17} /><span>Trascrivi audio</span></button><button className={recording ? "active" : ""} onClick={() => openAudioWelcome("record")} disabled={loading || transcribing}><Mic size={17} /><span>{recording ? "Termina registrazione" : "Registra audio"}</span></button>
                <button className={webSearchEnabled ? "active" : ""} onClick={() => setWebSearchEnabled((enabled) => !enabled)} disabled={loading || brainPrivate || webAvailable === false}><Globe2 size={17} /><span>Web {webSearchEnabled ? "ON" : "OFF"}</span></button><button onClick={() => { setComposerToolsOpen(false); openSpecialChat("ocr"); }} disabled={loading}><ScanLine size={17} /><span>OCR</span></button><button onClick={() => { setComposerToolsOpen(false); openSpecialChat("yolo"); }} disabled={loading}><YoloIcon /><span>YOLO</span></button><button className={brainEnabled ? "active" : ""} onClick={() => setBrainMode(!brainEnabled)} disabled={loading}><Network size={17} /><span>Brain {brainEnabled ? "ON" : "OFF"}</span></button></>}
              </div>}</div>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => updateChatInput(event.target.value, (event.nativeEvent as InputEvent).isComposing)}
                onCompositionEnd={(event) => updateChatInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder=""
                title={brainPaths.length ? `Per filtrare Brain usa @ seguito dal percorso: ${brainPaths.slice(0, 3).join(", ")}` : "Usa @percorso per citare una fonte Brain"}
                rows={1}
              />
              {mentionActive && mentionSuggestions.length > 0 && <div className="mention-suggestions">{mentionSuggestions.map(path => <button type="button" key={path} onClick={() => chooseMention(path)}><span>@</span>{path}</button>)}</div>}
              {loading ? <button className="send-button stop" onClick={stopGeneration} aria-label="Ferma generazione"><Square size={15} fill="currentColor" /></button> : <button className="send-button" onClick={() => void sendMessage()} disabled={(!input.trim() && !attachments.length) || (specialMode === "normal" && !selectedModel) || (specialMode === "image" && !imageService.ready)} aria-label="Invia"><Send size={18} /></button>}
            </div>
          </div>
        </footer>
      </main>

      <Mainboard currentActivity={activeOperation ? { label: activeOperation.label, startedAt: new Date(activeOperation.startedAt).toISOString(), status: "running" } : null} />

      {diagnosticReportMessageId && (() => {
        const reportMessage = messages.find(message => message.id === diagnosticReportMessageId);
        if (!reportMessage?.diagnostics) return null;
        const issues = reportMessage.diagnostics.events.filter(event => event.status === "warning" || event.status === "error").length;
        return <Modal title="Report diagnostico" wide onClose={() => setDiagnosticReportMessageId("")}>
          <div className="diagnostic-report">
            <div className="diagnostic-report-head"><div><small>Request ID</small><code>{reportMessage.diagnostics.requestId}</code></div><span className={issues ? "has-issues" : "ok"}>{issues ? `${issues} problemi` : "Tutto regolare"}</span></div>
            <div className="diagnostic-report-actions"><button type="button" onClick={() => void copyDiagnosticReport(reportMessage)}><Copy size={15} /> {diagnosticReportCopied ? "Report copiato" : "Copia report"}</button><span>Valuta il report</span><button type="button" className={reportMessage.diagnosticFeedback === 1 ? "active" : ""} onClick={() => setMessages(current => current.map(message => message.id === reportMessage.id ? { ...message, diagnosticFeedback: 1 } : message))} title="Report utile" aria-label="Report utile"><ThumbsUp size={15} /></button><button type="button" className={reportMessage.diagnosticFeedback === -1 ? "active negative" : ""} onClick={() => setMessages(current => current.map(message => message.id === reportMessage.id ? { ...message, diagnosticFeedback: -1 } : message))} title="Report non utile" aria-label="Report non utile"><ThumbsDown size={15} /></button></div>
            <pre>{diagnosticReport(reportMessage)}</pre>
          </div>
        </Modal>;
      })()}

      {detailsOpen && selectedModel && (
        <Modal title="Informazioni modello" onClose={() => setDetailsOpen(false)}>
          <div className="model-detail-head"><span className="provider-avatar large">{selectedModel.provider[0].toUpperCase()}</span><div><h2>{selectedModel.name}</h2><code>{selectedModel.id}</code></div></div>
          <p className="detail-description">{selectedModel.description}</p>
          <dl className="detail-grid"><div><dt>Provider</dt><dd>{selectedModel.provider}</dd></div><div><dt>Contesto</dt><dd>{selectedModel.context ?? "Vedi model card"}</dd></div></dl>
          <div className="tag-list">{selectedModel.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          {!isOllama && <a className="external-link" href={selectedModel.providerId === "openrouter" ? `https://openrouter.ai/${selectedModel.id}` : `https://build.nvidia.com/${selectedModel.id}`} target="_blank" rel="noreferrer">Apri la model card ↗</a>}
        </Modal>
      )}

      {brainOpen && <Modal title="Archivio Brain" className="brain-archive-modal" headerSlot="brain-modal-actions" wide onClose={() => { setBrainOpen(false); void refreshBrainPaths(); }}><Suspense fallback={<div className="thinking">Caricamento archivio…</div>}><BrainPanel showInfo={false} locked={loading} source={brainSource} onSource={setBrainSource} onClose={() => { setBrainOpen(false); void refreshBrainPaths(); }} onOpenGraph={() => { setBrainOpen(false); setBrainGraphOpen(true); }} /></Suspense></Modal>}
      {outputOpen && <Modal title="Output" wide={Boolean(outputFolder)} compact={!outputFolder} onClose={() => { setOutputOpen(false); setOutputFolder(null); }}><div className="output-sections">{!outputFolder ? <div className="output-folders">{([ ["images", "Immagini generate", Image], ["ocr", "OCR", FileText], ["yolo", "YOLO", Eye], ["compactChat", "Chat compatte", Archive] ] as const).map(([folder, title, Icon]) => <button key={folder} className="output-folder" onClick={() => setOutputFolder(folder)}><Icon size={28} /><strong>{title}</strong><small>{outputFiles[folder].length} risultati</small></button>)}</div> : <section className="output-section"><button className="output-back" onClick={() => setOutputFolder(null)}>← Tutte le cartelle</button><h3>{outputFolder === "images" ? "Immagini generate" : outputFolder === "compactChat" ? "Chat compatte" : outputFolder.toUpperCase()}</h3><div className="output-gallery">{outputFiles[outputFolder].length ? outputFiles[outputFolder].map(file => <div key={file.name} className="output-item-wrap"><a href={file.url} target="_blank" rel="noreferrer" className="output-item">{file.image ? <img src={file.url} alt={file.name} /> : <span className="output-file-icon"><FileText size={24} /></span>}<span>{file.name}</span></a><button className="output-delete" onClick={() => setOutputDelete({ folder: outputFolder === "images" ? "Image" : outputFolder.toUpperCase() as "OCR" | "YOLO", name: file.name })}>Elimina</button></div>) : <p>Nessun file disponibile.</p>}</div></section>}</div></Modal>}
      {outputDelete && <Modal title="Conferma eliminazione" compact onClose={() => setOutputDelete(null)}><p>Eliminare definitivamente <strong>{outputDelete.name}</strong>?</p><div className="dialog-actions"><button className="secondary-action" onClick={() => setOutputDelete(null)}>Annulla</button><button className="danger-action" onClick={() => { const { folder, name } = outputDelete; void fetch(`/api/output/${folder}/${encodeURIComponent(name)}`, { method: "DELETE" }).then(() => fetch("/api/output")).then(response => response.json()).then(data => { setOutputFiles(data); setOutputDelete(null); }); }}>Elimina</button></div></Modal>}
      {researchOpen && <Modal
        className={researchFullscreen ? "research-modal-fullscreen" : researchResult || researchLoading ? "research-modal" : "research-initial"}
        compact={!researchResult && !researchLoading && !researchFullscreen}
        title={<span className="newspaper-modal-title"><Newspaper size={19} /> Edizione News</span>}
        wide={Boolean(researchResult || researchLoading || researchFullscreen)}
        onClose={() => { researchAbortRef.current?.abort(); setResearchOpen(false); setResearchFullscreen(false); }}
      >
        <div className="research-toolbar">
          <button disabled={researchLoading} className={researchType === "ai" ? "active" : ""} onClick={() => void createResearchEdition("ai")}>AI News</button>
          <button disabled={researchLoading} className={researchType === "papers" ? "active" : ""} onClick={() => void createResearchEdition("papers")}>Paper scientifici</button>
          <button disabled={researchLoading} className={researchType === "science" ? "active" : ""} onClick={() => void createResearchEdition("science")}>Scienza e Curiosità</button>
          {researchLoading && <button className="cancel-research" onClick={stopResearch}><Square size={13} fill="currentColor" /> Interrompi</button>}
          {researchResult && <button className="download-research" onClick={downloadResearchEdition}><Download size={14} /> Scarica giornale</button>}
          <button className="fullscreen-research" onClick={() => void toggleResearchFullscreen()}>{researchFullscreen ? <Minimize size={14} /> : <Maximize size={14} />} {researchFullscreen ? "Finestra" : "Schermo intero"}</button>
        </div>
        {researchLoading ? <div className="newspaper-loading" role="status" aria-live="polite"><span className="operation-pulse" /><strong>Operazione attiva · {formatElapsed(researchSeconds)}</strong><span>{researchSeconds < 20 ? "Ricerca e selezione delle fonti…" : researchSeconds < 60 ? "Le fonti sono in elaborazione…" : "Il modello sta componendo l’edizione. Con Ollama locale il primo avvio può richiedere alcuni minuti."}</span><small>Puoi interrompere senza bloccare le altre funzioni.</small></div> : researchResult ? (() => { const pages = researchPages(researchResult.article); const page = Math.min(researchPage, pages.length - 1); return <div className="newspaper-reader"><button className="newspaper-arrow left" aria-label="Pagina precedente" disabled={page === 0} onClick={() => setResearchPage(current => Math.max(0, current - 1))}><ChevronLeft size={25} /></button><article className="newspaper"><div className="newspaper-masthead"><span>ANDREAGPT · EDIZIONE TECNICA</span><small>{new Date().toLocaleDateString("it-IT")}</small></div><ReactMarkdown remarkPlugins={[remarkGfm]}>{pages[page]}</ReactMarkdown>{page === pages.length - 1 && researchResult.sources.length > 0 && <footer className="newspaper-sources"><strong>Fonti consultate</strong>{researchResult.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">[{source.id}] {source.title}</a>)}</footer>}<div className="newspaper-page-number">Pagina {page + 1} / {pages.length}</div></article><button className="newspaper-arrow right" aria-label="Pagina successiva" disabled={page === pages.length - 1} onClick={() => setResearchPage(current => Math.min(pages.length - 1, current + 1))}><ChevronRight size={25} /></button></div>; })() : <div className="newspaper-empty"><strong>Scegli un’edizione</strong><span>AndreaGPT userà solo le fonti trovate e produrrà un articolo per fonte.</span></div>}
      </Modal>}
      {renameDialog && <Modal title="Rinomina conversazione" compact onClose={() => setRenameDialog(null)}><label className="dialog-field">Nome conversazione<input autoFocus maxLength={60} value={renameDialog.title} onChange={event => setRenameDialog({ ...renameDialog, title: event.target.value })} /></label><div className="dialog-actions"><button className="secondary-action" onClick={() => setRenameDialog(null)}>Annulla</button><button className="primary-action" onClick={() => { const title = renameDialog.title.trim(); if (title) setConversations(current => current.map(item => item.id === renameDialog.id ? { ...item, title, customTitle: true } : item)); setRenameDialog(null); }}>Salva</button></div></Modal>}
      {brainGraphOpen && <Suspense fallback={<div className="thinking">Caricamento grafo…</div>}><BrainGraph onClose={() => setBrainGraphOpen(false)} onUse={(source) => { setBrainSource(source); setBrainEnabled(true); setBrainGraphOpen(false); }} /></Suspense>}


      {instructionsOpen && (
        <Modal title="Istruzioni" onClose={() => setInstructionsOpen(false)}>
          <div className="instructions-panel editor">
            <p>Le istruzioni attive vengono inviate al modello. La cartella <code>ISTRUZIONI</code> resta come copia fisica leggibile nel progetto.</p>
            <div className="instruction-actions">
              <button onClick={() => setCustomInstructions((current) => [...current, { id: createId(), title: "Nuova istruzione", text: "", enabled: true }])}>Aggiungi istruzione</button>
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
        <Modal title="Impostazioni" className="settings-modal" onClose={() => setSettingsOpen(false)}>
          <div className="settings-compact">
          <div className="settings-section">
            <div className="settings-heading"><strong>Tema</strong><SettingsInfo text="Scegli l'aspetto di AndreaGPT." /></div>
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
          <div className="settings-section image-settings">
            <div className="settings-heading"><strong>Qwen Image 2.1</strong><SettingsInfo text="Generazione locale. Il modello viene scaricato al primo utilizzo e può richiedere molta RAM e spazio disco." /></div>
            <button className="secondary-action image-settings-open" onClick={() => { setSettingsOpen(false); openSpecialChat("image"); }}><Image size={17} /> Apri chat Image</button>
            <label className="setting-field brain-field"><span><strong>Formato</strong></span><select value={`${imageSettings.width}x${imageSettings.height}`} onChange={event => { const [width, height] = event.target.value.split("x").map(Number); setImageSettings(current => ({ ...current, width, height })); }}><option value="768x768">Quadrato · 768×768 consigliato</option><option value="1024x1024">Quadrato · 1024×1024</option><option value="1344x768">Orizzontale · 1344×768</option><option value="768x1344">Verticale · 768×1344</option></select></label>
            <label className="setting-field"><span><strong>Passaggi</strong><SettingsInfo text="Più passaggi possono migliorare il risultato, ma aumentano i tempi." /></span><output>{imageSettings.steps}</output></label>
            <input className="range" type="range" min="10" max="50" step="5" value={imageSettings.steps} onChange={event => setImageSettings(current => ({ ...current, steps: Number(event.target.value) }))} />
            <label className="setting-field token-field"><span><strong>Seed</strong></span><input type="number" min="0" max="2147483647" value={imageSettings.seed} onChange={event => setImageSettings(current => ({ ...current, seed: Math.max(0, Math.min(2147483647, Number(event.target.value))) }))} /></label>
            <p className="cookbook-note">Il backend seleziona automaticamente CUDA, Intel XPU oppure CPU. Per Intel Arc serve una build PyTorch con supporto XPU; i file sono salvati in <code>OUTPUT/Image</code>.</p>
          </div>
          <LocalModelCookbook models={models} onChoose={(id) => { chooseModel(id); setSettingsOpen(false); }} />
          <div className="settings-section generation-settings">
            <div className="settings-heading"><strong>Generazione</strong><SettingsInfo text="Configura il comportamento delle risposte." /></div>
          <label className="setting-field"><span><strong>Temperatura</strong><SettingsInfo text="Valori bassi sono più precisi, valori alti più creativi." /></span><output>{settings.temperature.toFixed(1)}</output></label>
          <input className="range" type="range" min="0" max="2" step="0.1" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })} />
          <label className="setting-field token-field"><span><strong>Token massimi</strong><SettingsInfo text="Lunghezza massima della risposta." /></span><input type="number" min="1" max="8192" value={settings.maxTokens} onChange={(event) => setSettings({ ...settings, maxTokens: Math.min(8192, Math.max(1, Number(event.target.value))) })} /></label>
          <details className="settings-collapse ollama-profile-settings">
            <summary className="settings-collapse-title"><span><strong>Settings modello</strong></span><ChevronDown size={15} /></summary>
            <div className="ollama-profile-table-wrap">
              <table className="ollama-profile-table">
                <thead><tr><th scope="col">Modello locale</th><th scope="col">Contesto</th><th scope="col">Output</th></tr></thead>
                <tbody>{localOllamaModels.length ? localOllamaModels.map(model => {
                  const profile = { ...defaultOllamaProfile(model), ...ollamaProfiles[model.id] };
                  const extendedOutput = model.id === "qwen3:14b";
                  return <tr key={model.id}>
                    <th scope="row"><strong>{model.name.replace(/\s*\(locale\)$/i, "")}</strong><code>{model.id}</code></th>
                    <td><select aria-label={`Contesto ${model.name}`} value={profile.numCtx} onChange={event => updateOllamaProfile(model, { numCtx: Number(event.target.value) as OllamaProfile["numCtx"] })}><option value={4096}>4096 · sicuro</option><option value={8192}>8192 · più memoria</option></select></td>
                    <td><select aria-label={`Output ${model.name}`} value={profile.maxTokens} onChange={event => updateOllamaProfile(model, { maxTokens: Number(event.target.value) as OllamaProfile["maxTokens"] })}><option value={256}>256 · breve</option><option value={512}>512 · bilanciato</option><option value={1024}>1024 · lungo</option>{extendedOutput && <><option value={2048}>2048 · molto lungo</option><option value={4096}>4096 · massimo</option></>}</select></td>
                  </tr>;
                }) : <tr><td className="ollama-profile-empty" colSpan={3}>Nessun modello Ollama locale disponibile.</td></tr>}</tbody>
              </table>
            </div>
          </details>
          </div>
          <button className="primary-action" onClick={() => setSettingsOpen(false)}>Salva impostazioni</button>
          </div>
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
  const base = { id: createId(), name: file.name, type: file.type, size: file.size };
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
      id: typeof item.id === "string" ? item.id : createId(),
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

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  try { return JSON.parse(raw) as T; }
  catch {
    throw new Error(raw.trim() || `Il server ha restituito una risposta non valida (HTTP ${response.status}).`);
  }
}

async function readHealth() {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error("Health non disponibile");
  return response.json() as Promise<{ providers?: { searxng?: boolean; web?: boolean } }>;
}

function Modal({ title, onClose, onBack, children, headerSlot, wide = false, compact = false, className = "" }: { title: React.ReactNode; onClose: () => void; onBack?: () => void; children: React.ReactNode; headerSlot?: string; wide?: boolean; compact?: boolean; className?: string }) {
  return <div className={`modal-backdrop${compact ? " compact-backdrop" : ""}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""} ${compact ? "compact-modal" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} onClick={(event) => event.stopPropagation()}><header>{onBack && <button className="modal-back" aria-label="Indietro" onClick={onBack}><ArrowLeft size={17} /></button>}<h2>{title}</h2>{headerSlot && <div id={headerSlot} className="modal-header-slot" />}<button className="icon-button" aria-label="Chiudi" onClick={onClose}><X size={19} /></button></header><div className="modal-body">{children}</div></section></div>;
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
    const id = createId();
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
