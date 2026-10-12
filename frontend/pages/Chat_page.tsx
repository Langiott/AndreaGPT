import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
/**
 * Pagina principale della chat AndreaGPT.
 * Collega conversazioni, Brain, Web, file, modelli e strumenti locali.
 */
import { modelForPrivateChat } from "../model/model_selection";
import { diagnosticReport as buildDiagnosticReport } from "../utils/diagnostic_report";
import {
  Network,
  Cpu,
  AudioLines,
  ArrowLeft,
  Archive,
  Bot,
  ScanEye,
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
  Camera,
  Minimize,
  MessageSquarePlus,
  Bookmark,
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
  Clapperboard,
  Link2,
  ScrollText,
} from "lucide-react";
import mascotUrl from "../../img/mascotte-no-sfondo.png";
import { TASKS } from "../utils/data";
import { downloadConverted, type Converted } from "../utils/converted";
import { UniverseBackground } from "../components/UniverseBackground";
import { AppearanceSettings, fonts, SettingsInfo, useAppearance } from "../components/AppearanceSettings";
import { createId } from "../utils/compat";
import { createStreamBatch } from "../utils/stream_batch";
import { writeClipboard } from "../utils/clipboard";
import { userErrorMessage } from "../utils/errors";
import { useVoiceMode } from "../utils/voice_mode";
import { YoloLive } from "../components/YoloLive";
import { ShapPanel } from "../components/ShapPanel";
import { TokenConfidencePanel } from "../components/TokenConfidence";
import { parseCitation } from "../utils/cite_focus";
import { Mainboard } from "../components/Mainboard";
import type { AgentView, BrainCitation, ChatAttachment, ChatMessage, ChatSettings, Conversation, DiagnosticTrace, ModelInfo, TokenTrace, WebCitation } from "../types/types";
import type { AgentConfig, AgentEvent, AgentRunRequest } from "../types/agent";
import { closeAgentView, foldAgentEvent } from "../utils/agent_events";

const iconByName = {
  sparkles: Sparkles,
  code: Code2,
  brain: Network,
  chart: Database,
  pen: PenTool,
  eye: Eye,
};

const BrainPanel = lazy(() => import("../components/BrainPanel").then(module => ({ default: module.BrainPanel })));
const BrainDocumentReader = lazy(() => import("../components/BrainPanel").then(module => ({ default: module.BrainDocumentReader })));
const BrainGraph = lazy(() => import("../components/BrainGraph").then(module => ({ default: module.BrainGraph })));
const EmbeddingSpace = lazy(() => import("../components/EmbeddingSpace").then(module => ({ default: module.EmbeddingSpace })));
const FotoPanel = lazy(() => import("../components/FotoPanel").then(module => ({ default: module.FotoPanel })));
const SocialPanel = lazy(() => import("../components/SocialPanel").then(module => ({ default: module.SocialPanel })));
const CodePanel = lazy(() => import("../components/CodePanel").then(module => ({ default: module.CodePanel })));
const AgentRun = lazy(() => import("../components/AgentRun").then(module => ({ default: module.AgentRun })));
const ConvertPanel = lazy(() => import("../components/ConvertPanel").then(module => ({ default: module.ConvertPanel })));
// Markdown e KaTeX sono pesanti: si caricano solo alla prima risposta mostrata.
const MarkdownMessage = lazy(() => import("../components/MarkdownMessage").then(module => ({ default: module.MarkdownMessage })));
const NewspaperMarkdown = lazy(() => import("../components/MarkdownMessage").then(module => ({ default: module.NewspaperMarkdown })));

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

function AudioWelcomeCard({ variant, recording, transcribing, title, model, actions, titleStyle }: { variant: "transcribe" | "record"; recording: boolean; transcribing: boolean; title: string; model: string; actions: ReactNode; titleStyle?: CSSProperties }) {
  const isRecordingCard = variant === "record";
  const busy = isRecordingCard ? recording : transcribing;
  return <div className="audio-welcome-card">
    <div className="audio-welcome-visual"><AudioCassette playing={busy} /><span className="audio-signal audio-signal-one" /><span className="audio-signal audio-signal-two" /></div>
    <div className="audio-welcome-copy">
      <div className="welcome-title-line"><h2 style={titleStyle}>{isRecordingCard ? recording ? "Sto registrando audio" : title : transcribing ? "Sto trascrivendo audio" : title}</h2></div>
      <span className="audio-welcome-model">{model}</span>
      <div className="audio-welcome-actions welcome-tool-actions">{actions}</div>
    </div>
  </div>;
}

function AudioCardEditForm(props: Pick<CardEditProps, "draft" | "onDraft" | "onCancel" | "onSave">) {
  return <WelcomeEditForm {...props} className="audio-edit-form" lines={[["title", "Titolo"]]} />;
}

type WelcomeLine = "title" | "accent" | "subtitle";
/** Stile di una riga della card: dimensione in px (vuota = automatica) e grassetto. */
type WelcomeLineStyle = { size?: number; bold?: boolean };
type WelcomeCardText = { title: string; accent: string; subtitle: string; styles?: Partial<Record<WelcomeLine, WelcomeLineStyle>> };
function lineStyle(text: WelcomeCardText, line: WelcomeLine): CSSProperties | undefined {
  const style = text.styles?.[line];
  if (!style) return undefined;
  return { ...(style.size ? { fontSize: `${style.size}px` } : {}), ...(style.bold === undefined ? {} : { fontWeight: style.bold ? 700 : 400 }) };
}
/** Editor compatto: una riga per testo, con dimensione e grassetto accanto. Un testo vuoto nasconde la riga. */
function WelcomeEditForm({ draft, onDraft, onCancel, onSave, lines = [["title", "Titolo"], ["accent", "Accento"], ["subtitle", "Descrizione"]], className = "" }: Pick<CardEditProps, "draft" | "onDraft" | "onCancel" | "onSave"> & { lines?: Array<[WelcomeLine, string]>; className?: string }) {
  const setStyle = (line: WelcomeLine, patch: WelcomeLineStyle) => onDraft({ ...draft, styles: { ...draft.styles, [line]: { ...draft.styles?.[line], ...patch } } });
  return <form className={`welcome-edit-form compact-edit ${className}`} onSubmit={(event) => { event.preventDefault(); onSave(); }} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
    {lines.map(([line, label], index) => { const style = draft.styles?.[line]; return <div key={line} className="welcome-edit-row">
      <input autoFocus={index === 0} value={draft[line]} placeholder={`${label} (vuoto = nascosto)`} aria-label={label} maxLength={line === "subtitle" ? 220 : 80} onChange={(event) => onDraft({ ...draft, [line]: event.target.value })} />
      <input type="number" className="welcome-edit-size" min={8} max={96} value={style?.size ?? ""} placeholder="px" title={`Dimensione ${label.toLowerCase()} (vuoto = automatica)`} aria-label={`Dimensione ${label}`} onChange={(event) => setStyle(line, { size: event.target.value ? Math.min(96, Math.max(8, Number(event.target.value))) : undefined })} />
      <button type="button" className={`welcome-edit-bold${style?.bold ? " active" : ""}`} aria-pressed={Boolean(style?.bold)} title={`Grassetto ${label.toLowerCase()}`} onClick={() => setStyle(line, { bold: !style?.bold })}>B</button>
    </div>; })}
    <div className="welcome-edit-actions"><button type="button" className="secondary-action" onClick={onCancel}>Annulla</button><button type="submit" className="primary-action">Salva</button></div>
  </form>;
}
type OutputFile = { name: string; url: string; size: number; updatedAt: number; image: boolean; thumb?: string; excerpt?: string };
const emptyOutputFiles = { images: [], ocr: [], yolo: [], compactChat: [], analyze: [], audio: [], news: [] };
const outputFolderLabel = { images: "Immagini generate", ocr: "OCR", yolo: "YOLO", compactChat: "Chat compatte", analyze: "Analyze", audio: "Audio", news: "News" } as const;
type CardEditProps = { editing: boolean; draft: WelcomeCardText; onDraft: (draft: WelcomeCardText) => void; onEdit: () => void; onCancel: () => void; onSave: () => void };

/** Titolo, accento e descrizione: le righe vuote non vengono stampate. */
function WelcomeCardLines({ text, model, divided = false }: { text: WelcomeCardText; model?: string; divided?: boolean }) {
  // card strumenti: la riga del titolo è separata da una linea dal testo sotto
  return <>
    {(text.title || text.accent) && <h1>{text.title && <span className={divided ? "welcome-title-line" : undefined} style={lineStyle(text, "title")}><span>{text.title}{model && <span className="welcome-model"> · {model}</span>}</span></span>}{text.title && text.accent && !divided && <br />}{text.accent && <em style={lineStyle(text, "accent")}>{text.accent}</em>}</h1>}
    {text.subtitle && <p style={lineStyle(text, "subtitle")}>{text.subtitle}</p>}
  </>;
}

/** Card di benvenuto comune a tutti gli strumenti: titolo · modello, accento, riga di pulsanti, stato sotto. */
function ToolWelcomeCard({ className, model, text, status, actions, children, editSubtitle = true, editing, draft, onDraft, onEdit, onCancel, onSave }: CardEditProps & { className?: string; model: string; text: WelcomeCardText; status?: ReactNode; actions?: ReactNode; children?: ReactNode; editSubtitle?: boolean }) {
  return <div className={`special-welcome-card${className ? ` ${className}` : ""}`}>
    <button type="button" className="welcome-edit-button" onClick={onEdit} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button>
    {editing ? <WelcomeEditForm draft={draft} onDraft={onDraft} onCancel={onCancel} onSave={onSave} lines={editSubtitle ? undefined : [["title", "Titolo"], ["accent", "Accento"]]} /> : <WelcomeCardLines text={text} model={model} divided />}
    {actions && <div className="welcome-tool-actions">{actions}</div>}
    {children}
    {status}
  </div>;
}

const initialSettings: ChatSettings = { temperature: 0.3, maxTokens: 2048, ollamaMaxTokens: 512 };
/** Impostazioni di generazione salvate nel browser: restano dopo la chiusura dell'app. */
function loadSettings(): ChatSettings {
  try {
    const saved = JSON.parse(localStorage.getItem("andreagpt-settings") || "{}");
    return {
      temperature: Number.isFinite(saved.temperature) ? Math.max(0, Math.min(2, saved.temperature)) : initialSettings.temperature,
      maxTokens: Number.isFinite(saved.maxTokens) ? Math.max(1, Math.min(8192, saved.maxTokens)) : initialSettings.maxTokens,
      ollamaMaxTokens: Number.isFinite(saved.ollamaMaxTokens) ? saved.ollamaMaxTokens : initialSettings.ollamaMaxTokens,
      visionMaxTokens: [256, 512, 1024].includes(saved.visionMaxTokens) ? saved.visionMaxTokens : 1024,
    };
  } catch { return initialSettings; }
}
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
type Theme = "cosmic" | "normal" | "tropico";
type YoloTask = "detect" | "bbox" | "segment" | "classify" | "pose";
type SpecialMode = "normal" | "ocr" | "yolo" | "analyze" | "image" | "convert" | "video" | "agent";
const specialModes: SpecialMode[] = ["normal", "ocr", "yolo", "analyze", "image", "convert", "video", "agent"];
const VIDEO_ACCEPT = "video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v,.mpeg,.mpg,.3gp,.wmv,.flv,.ts";
const VIDEO_FILE = /\.(?:mp4|mov|mkv|webm|avi|m4v|mpeg|mpg|3gp|wmv|flv|ts)$/i;
/** Strumento di una chat: campo salvato, poi titolo standard, poi contenuto (chat vecchie o rinominate). */
function conversationMode(conversation?: Conversation): SpecialMode {
  if (!conversation) return "normal";
  if (specialModes.includes(conversation.mode as SpecialMode)) return conversation.mode as SpecialMode;
  const title = conversation.title;
  if (/^OCR \d+$/i.test(title)) return "ocr";
  if (/^YOLO \d+$/i.test(title)) return "yolo";
  if (/^(?:Analyze|Analizza IMG) \d+$/i.test(title)) return "analyze";
  if (/^Image \d+$/i.test(title)) return "image";
  if (/^Converti \d+$/i.test(title)) return "convert";
  if (/^Video \d+$/i.test(title)) return "video";
  if (/^Agente \d+$/.test(title)) return "agent";
  const firstUser = conversation.messages.find((message) => message.role === "user")?.content ?? "";
  if (firstUser === "Esegui OCR sugli allegati.") return "ocr";
  if (firstUser === "Analizza gli elementi nelle immagini con YOLO.") return "yolo";
  if (conversation.messages.some((message) => message.agent)) return "agent";
  if (conversation.messages.some((message) => message.generatedImage)) return "image";
  if (conversation.messages.some((message) => message.generatedFile)) return "convert";
  if (conversation.messages.some((message) => message.logs?.some((line) => line.includes("Analisi completata")))) return "analyze";
  return "normal";
}
type AudioWelcomeMode = "none" | "transcribe" | "record";
type ImageServiceStatus = { status: "checking" | "stopped" | "ready" | "error"; ready: boolean; message: string };
type ActiveOperation = { label: string; detail: string; startedAt: number; /** Già mostrata nel messaggio: niente banner nel composer. */ inline?: boolean };
interface CustomInstruction { id: string; title: string; text: string; enabled: boolean }

const hasAffinity = (message: ChatMessage) => Boolean(message.brainSources?.length && message.diagnostics?.events.some(item => item.details?.semanticSupportChecked === true && Number.isFinite(item.details?.semanticSupportScore)));

function AffinityScore({ message }: { message: ChatMessage }) {
  const event = message.diagnostics?.events.find(item => item.details?.semanticSupportChecked === true);
  const value = event?.details?.semanticSupportScore;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const percent = Math.round(value * 100);
  const label = event?.details?.semanticSupportLabel;
  const tone = label === "forte" ? "strong" : label === "media" ? "medium" : "weak";
  return <span className={`affinity-inline ${tone}`} title="Somiglianza semantica tra risposta e fonti Brain: misura se è in tema, non se è corretta">Affinità {percent}%</span>;
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
  const qwenExpert = chooseAvailable(["qwen3-coder:30b-a3b", "qwen3-coder"]);
  const recommended = qwenExpert
    ? { label: "Qwen3 Coder", size: "30B-A3B", model: qwenExpert }
    : { label: "MiniCPM5", size: "2B", model: miniCpm };

  return <details className="settings-row">
    <summary><span>Cookbook</span><ChevronDown size={15} /></summary>
    <div className="settings-body">
      <div className="settings-line"><span>Dispositivo</span><span className="settings-value">{hardware.ram} GB · {hardware.cores} thread</span></div>
      <div className="settings-line"><span>Consigliato</span><span className="settings-pair"><span className="settings-value">{recommended.label} {recommended.size}</span>{recommended.model && <button type="button" className="settings-small-button" onClick={() => onChoose(recommended.model!)}>Usa</button>}</span></div>
    </div>
  </details>;
}

const shortModelName = (model: ModelInfo) => model.name.replace(/\s*\(locale\)$/i, "");

// Tendina che si apre verso l'alto: in fondo alla finestra Impostazioni non c'è spazio sotto.
function DropUpSelect({ options, value, onChange }: { options: ModelInfo[]; value?: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const current = options.find((model) => model.id === value);
  return <div className="dropup" ref={ref}>
    <button type="button" className="dropup-trigger" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!options.length}>
      <span>{current ? shortModelName(current) : "Nessun modello"}</span><ChevronDown size={14} className={open ? "open" : undefined} />
    </button>
    {open && <div className="dropup-menu" role="listbox">
      {options.map((model) => <button type="button" role="option" aria-selected={model.id === value} key={model.id} className={model.id === value ? "active" : undefined} onClick={() => { onChange(model.id); setOpen(false); }}>
        <span>{shortModelName(model)}</span>{model.id === value && <Check size={14} />}
      </button>)}
    </div>}
  </div>;
}

function comfyBrowserUrl() {
  // Usa l'host reale con cui è stata aperta l'app (127.0.0.1, IP di rete, …),
  // mai "localhost" fisso: da telefono o con altre interfacce non risolverebbe.
  const host = window.location.hostname || "127.0.0.1";
  const wrapped = host.includes(":") ? `[${host}]` : host;
  return `http://${wrapped}:8188`;
}

function isChatListModel(model: ModelInfo) {
  const id = model.id.toLowerCase();
  if (id.startsWith("nomic-embed-text")) return false;
  if (id.includes("qwen3-coder") && id.includes("30b")) return false;
  return true;
}

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
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const [activeConversationId, setActiveConversationId] = useState(() => loadActiveConversationId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadActiveMessages());
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [specialMode, setSpecialMode] = useState<SpecialMode>("normal");
  const [imageSettings, setImageSettings] = useState<{ width: number; height: number; steps: number; seed: number }>(() => {
    try { return { width: 768, height: 768, steps: 25, seed: Math.floor(Math.random() * 2147483647), ...JSON.parse(localStorage.getItem("andreagpt-image-settings") || "{}") }; }
    catch { return { width: 768, height: 768, steps: 25, seed: Math.floor(Math.random() * 2147483647) }; }
  });
  const [imageService, setImageService] = useState<ImageServiceStatus>({ status: "checking", ready: false, message: "ComfyUI non attivo" });
  const [imageModel, setImageModel] = useState<"qwen" | "viggle">(() => localStorage.getItem("andreagpt-image-model") === "viggle" ? "viggle" : "qwen");
  const [yoloTask, setYoloTask] = useState<YoloTask>("detect");
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => localStorage.getItem("andreagpt-web-search") === "true");
  // Diagnostica: log, tempi, controlli delle fonti e SHAP. Spenta riduce la latenza dopo la risposta.
  // Numero di fonti Brain: 0 = automatico (5, oppure 8 per metodi e formule).
  const [brainSourceCount, setBrainSourceCount] = useState(() => { try { return Number(localStorage.getItem("andreagpt-brain-source-count")) || 0; } catch { return 0; } });
  const [brainRerank, setBrainRerank] = useState(() => { try { return localStorage.getItem("andreagpt-brain-rerank") !== "false"; } catch { return true; } });
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(() => { try { return localStorage.getItem("andreagpt-diagnostics") !== "false"; } catch { return true; } });
  const [brainEnabled, setBrainEnabled] = useState(() => {
    if (localStorage.getItem("andreagpt-brain-default-v2") !== "1") {
      localStorage.setItem("andreagpt-brain-default-v2", "1");
      localStorage.setItem("andreagpt-brain-enabled", "true");
      return true;
    }
    return localStorage.getItem("andreagpt-brain-enabled") !== "false";
  });
  const [brainSource, setBrainSource] = useState("");
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [agentConfigError, setAgentConfigError] = useState("");
  const [agentFolderDraft, setAgentFolderDraft] = useState("");
  // Messaggio dell'Agente con il run in corso: solo lui mostra spinner e pulsanti di approvazione.
  const [agentLiveId, setAgentLiveId] = useState("");
  const agentLiveUpdateRef = useRef<((update: (view: AgentView) => AgentView) => void) | null>(null);
  const [brainPaths, setBrainPaths] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [brainOpen, setBrainOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [fotoOpen, setFotoOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [brainGraphOpen, setBrainGraphOpen] = useState(false);
  const [embeddingOpen, setEmbeddingOpen] = useState(false);
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
  const [researchResult, setResearchResult] = useState<{ label: string; article: string; sources: Array<{ id: number; title: string; url: string; description: string }>; date?: string } | null>(null);
  const [researchPage, setResearchPage] = useState(0);
  const [researchFullscreen, setResearchFullscreen] = useState(false);
  const [researchProgress, setResearchProgress] = useState<{ done: number; total: number } | null>(null);
  const [outputFolder, setOutputFolder] = useState<"images" | "ocr" | "yolo" | "compactChat" | "analyze" | "audio" | "news" | null>(null);
  const [outputDelete, setOutputDelete] = useState<{ folder: "Image" | "OCR" | "YOLO" | "Compatta_chat" | "Analyze" | "Audio" | "News"; name: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ id: string; title: string } | null>(null);
  const [outputFiles, setOutputFiles] = useState<Record<"images" | "ocr" | "yolo" | "compactChat" | "analyze" | "audio" | "news", OutputFile[]>>(emptyOutputFiles);
  const [compactingChat, setCompactingChat] = useState(false);
  // Chat compatta aperta nel lettore dell'archivio.
  const [compactOpen, setCompactOpen] = useState<{ folder: "Compatta_chat" | "Analyze" | "Audio"; name: string } | null>(null);
  const [settings, setSettings] = useState<ChatSettings>(loadSettings);
  const [ollamaProfiles, setOllamaProfiles] = useState<Record<string, OllamaProfile>>(() => loadOllamaProfiles());
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [diagnosticReportMessageId, setDiagnosticReportMessageId] = useState("");
  const [diagnosticReportCopied, setDiagnosticReportCopied] = useState(false);
  const [openMessagePanels, setOpenMessagePanels] = useState<Record<string, Partial<Record<"brain" | "web" | "metrics" | "diagnostics" | "image" | "shap" | "semantic" | "logs", boolean>>>>({});
  const [shapLoading, setShapLoading] = useState("");
  const [branchingMessage, setBranchingMessage] = useState("");
  // Fonte Brain aperta dalla chat sul tratto citato.
  const [citeOpen, setCiteOpen] = useState<{ source: string; startLine: number; endLine: number; text: string } | null>(null);
  const [composerToolsOpen, setComposerToolsOpen] = useState(false);
  const [yoloLiveOpen, setYoloLiveOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingFileName, setRecordingFileName] = useState("");
  const [audioWelcomeMode, setAudioWelcomeMode] = useState<AudioWelcomeMode>("none");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioSummary, setAudioSummary] = useState(() => { try { return localStorage.getItem("andreagpt-audio-summary") === "true"; } catch { return false; } });
  const [ocrToBrain, setOcrToBrain] = useState(() => { try { return localStorage.getItem("andreagpt-ocr-brain") === "true"; } catch { return false; } });
  // La registrazione termina in una callback creata all'avvio: il ref legge l'interruttore aggiornato.
  const audioSummaryRef = useRef(audioSummary);
  const [theme, setTheme] = useState<Theme>(() => { const saved = localStorage.getItem("andreagpt-theme"); return saved === "normal" || saved === "tropico" ? saved : saved === "aurora" ? "tropico" : "cosmic"; });
  const [historyCollapsed, setHistoryCollapsed] = useState(() => localStorage.getItem("andreagpt-history-collapsed") === "true");
  const [modelsCollapsed, setModelsCollapsed] = useState(() => localStorage.getItem("andreagpt-models-collapsed") === "true");
  const DEFAULT_CARD_TEXTS: Record<string, WelcomeCardText> = {
    // Home: i vecchi testi salvati separatamente fanno da punto di partenza.
    home: { title: localStorage.getItem("andreagpt-welcome-title") ?? "Ciao Cetriolo,", accent: localStorage.getItem("andreagpt-welcome-accent") ?? "oggi che facciamo?", subtitle: localStorage.getItem("andreagpt-welcome-subtitle") ?? "Chatta con il modello locale" },
    analyze: { title: "Analyze", accent: "Analizza qualsiasi immagine", subtitle: "Descrive oggetti, persone e sfondo." },
    ocr: { title: "OCR", accent: "Estrae il testo da immagini e PDF", subtitle: "Il testo viene salvato nella cartella OCR." },
    yolo: { title: "YOLO", accent: "Computer vision sulle immagini", subtitle: "Detection, bounding box, segmentazione, classificazione, pose." },
    image: { title: "Image", accent: "Descrivila, io la creo", subtitle: "" },
    convert: { title: "Conversione", accent: "Converte i tuoi documenti", subtitle: "" },
    video: { title: "Video", accent: "Dal video al testo", subtitle: "" },
    transcribe: { title: "Trascrivi audio", accent: "", subtitle: "" },
    record: { title: "Registra audio", accent: "", subtitle: "" },
    agent: { title: "Agente", accent: "", subtitle: "" },
  };
  // Testi predefiniti precedenti: se salvati invariati vengono sostituiti dai nuovi (migrazione una tantum).
  const OLD_CARD_TEXTS: Record<string, Partial<WelcomeCardText>> = {
    analyze: { accent: "un’immagine.", subtitle: "Il primo avvio scarica e carica il modello: lo stato e il tempo trascorso restano sempre visibili." },
    ocr: { accent: "leggere i tuoi file.", subtitle: "Allega una o più immagini o PDF. Il testo verrà estratto localmente e salvato nella cartella OCR." },
    yolo: { accent: "elementi nell’immagine.", subtitle: "Scegli il task e allega una o più immagini." },
    image: { accent: "Io la creo." },
    convert: { accent: "documenti." },
    transcribe: { accent: "TRASCRIVI AUDIO" },
    record: { accent: "REGISTRA AUDIO" },
  };
  const [cardTexts, setCardTexts] = useState<Record<string, WelcomeCardText>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("andreagpt-welcome-cards") || "{}") as Record<string, Partial<WelcomeCardText>>;
      // Una tantum: la seconda riga ora segue lo stile della descrizione, via grassetto e dimensione salvati prima.
      const resetAccent = localStorage.getItem("andreagpt-accent-style-reset") !== "1";
      // Una tantum: il titolo diventa il nome dello strumento (il modello è aggiunto accanto).
      const resetTitles = localStorage.getItem("andreagpt-card-titles-v2") !== "1";
      const merged: Record<string, WelcomeCardText> = {};
      for (const [key, defaults] of Object.entries(DEFAULT_CARD_TEXTS)) {
        const styles = saved[key]?.styles;
        const old = resetTitles && key !== "home" ? OLD_CARD_TEXTS[key] : undefined;
        const pick = (line: "accent" | "subtitle") => old && (saved[key]?.[line] === undefined || saved[key]?.[line] === old[line]) ? defaults[line] : saved[key]?.[line] ?? defaults[line];
        merged[key] = { title: old ? defaults.title : saved[key]?.title ?? defaults.title, accent: pick("accent"), subtitle: pick("subtitle"), styles: resetAccent && styles ? { ...styles, accent: undefined } : styles };
      }
      if (resetAccent || resetTitles) {
        localStorage.setItem("andreagpt-welcome-cards", JSON.stringify(merged));
        localStorage.setItem("andreagpt-accent-style-reset", "1");
        localStorage.setItem("andreagpt-card-titles-v2", "1");
      }
      return merged;
    } catch { return DEFAULT_CARD_TEXTS; }
  });
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState<WelcomeCardText>({ title: "", accent: "", subtitle: "" });
  function startCardEdit(id: string) {
    const current = cardTexts[id] ?? DEFAULT_CARD_TEXTS[id];
    if (!current) return;
    setCardDraft({ ...current });
    setEditingCard(id);
  }
  function saveCardEdit(id: string) {
    if (!DEFAULT_CARD_TEXTS[id]) { setEditingCard(null); return; }
    // Salva esattamente ciò che è scritto: una riga cancellata resta cancellata.
    setCardTexts((current) => ({ ...current, [id]: { title: cardDraft.title.trim(), accent: cardDraft.accent.trim(), subtitle: cardDraft.subtitle.trim(), styles: cardDraft.styles } }));
    setEditingCard(null);
  }
  function cardEditProps(id: string): CardEditProps {
    return { editing: editingCard === id, draft: cardDraft, onDraft: setCardDraft, onEdit: () => startCardEdit(id), onCancel: () => setEditingCard(null), onSave: () => saveCardEdit(id) };
  }
  const summaryToggle = <label className="welcome-chip" title="A fine trascrizione il modello scrive riassunto e punti d'azione"><input type="checkbox" checked={audioSummary} onChange={(event) => setAudioSummary(event.target.checked)} /> Riassumi dopo</label>;
  const abortRef = useRef<AbortController | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const analyzeConversationIdRef = useRef("");
  const appShellRef = useRef<HTMLDivElement>(null);
  const researchAbortRef = useRef<AbortController | null>(null);
  const researchJobRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const conversationRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [videoLink, setVideoLink] = useState("");
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
      const note = `# ${file.name}\n\n## Trascrizione\n\n${transcript}\n`;
      const saved: { name?: string } = await fetch("/api/output/Audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, content: note }) }).then(response => response.ok ? response.json() as Promise<{ name?: string }> : {}).catch(() => ({} as { name?: string }));
      if (audioSummaryRef.current) void summarizeTranscript(transcript, conversationId, saved.name ? { name: saved.name, note } : undefined);
    } catch (caught) {
      const message = userErrorMessage(caught, "Trascrizione fallita.");
      setMessages((current) => current.map((item) => item.id === audioMessageId ? { ...item, content: message, audio: { status: "error", fileName: file.name } } : item));
      setError(message);
    }
    finally { setTranscribing(false); if (audioInputRef.current) audioInputRef.current.value = ""; }
  }

  /** Chat Video: file caricato o link → trascrizione Whisper nel messaggio, nota in OUTPUT/Audio, riassunto se attivo. */
  async function transcribeVideo(source: { file: File } | { url: string }) {
    if (loading) return;
    const name = "file" in source ? source.file.name : source.url;
    if ("file" in source && (!source.file.size || source.file.size > 2048 * 1024 * 1024)) { setError("Il video deve essere non vuoto e pesare al massimo 2 GB."); return; }
    const conversationId = activeConversationId || createId();
    if (!activeConversationId) setActiveConversationId(conversationId);
    const messageId = createId();
    const startedAt = Date.now();
    const url = "url" in source ? source.url : undefined;
    stickToBottomRef.current = true;
    setMessages((current) => [...current,
      { id: createId(), role: "user", content: url ?? `🎬 ${name}` },
      { id: messageId, role: "assistant", content: "", modelName: "Whisper locale", video: { status: "transcribing", name, url }, pending: { title: url ? "Scarico e trascrivo" : "Carico e trascrivo", detail: url ? undefined : name, startedAt } }]);
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true); setError("");
    try {
      const response = "file" in source
        ? await fetch("/api/video/file", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(source.file.name) }, body: source.file, signal: controller.signal })
        : await fetch("/api/video/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: source.url }), signal: controller.signal });
      const result = await readJsonResponse<{ text?: string; title?: string; language?: string; duration?: number; error?: string }>(response);
      if (!response.ok) throw new Error(result.error || "Trascrizione video fallita.");
      const transcript = cleanAudioTranscript(result.text?.trim() || "");
      if (!transcript) throw new Error("Nessun parlato riconosciuto nel video.");
      const title = result.title || name;
      const length = result.duration ? ` · ${Math.floor(result.duration / 60)}:${String(Math.round(result.duration % 60)).padStart(2, "0")}` : "";
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: transcript, pending: undefined, video: { status: "complete", name: title, url }, logs: [`${title}${length}${result.language ? ` · ${result.language}` : ""} · ${Math.round((Date.now() - startedAt) / 1000)} s`] } : message));
      const note = `# ${title}\n\n${url ? `${url}\n\n` : ""}## Trascrizione\n\n${transcript}\n`;
      const saved: { name?: string } = await fetch("/api/output/Audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${title.slice(0, 80)}.md`, content: note }) }).then(response => response.ok ? response.json() as Promise<{ name?: string }> : {}).catch(() => ({} as { name?: string }));
      if (abortRef.current === controller) { setLoading(false); abortRef.current = null; }
      if (audioSummaryRef.current) void askVideo({ transcript, output: saved.name ? { name: saved.name, note } : undefined });
    } catch (caught) {
      const aborted = (caught as Error).name === "AbortError";
      const message = aborted ? "Trascrizione interrotta." : userErrorMessage(caught, "Trascrizione video fallita.");
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, content: message, pending: undefined, video: { status: "error", name, url } } : item));
      if (!aborted) setError(message);
    } finally {
      if (abortRef.current === controller) { setLoading(false); abortRef.current = null; }
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  /**
   * Chat Video: riassunto (senza domanda) o risposta a una domanda sulle trascrizioni, dal backend con trascrizione intera.
   * Il modello è quello del backend (qwen3:8b o il migliore installato), non quello selezionato: i modelli piccoli inventano.
   */
  async function askVideo({ transcript, question, output }: { transcript?: string; question?: string; output?: { name: string; note: string } }) {
    const transcripts = messages.filter((message) => message.video?.status === "complete" && message.content).map((message) => message.content);
    const trascrizione = transcript ?? transcripts.join("\n\n---\n\n");
    if (!trascrizione) { setError("Prima carica un video o incolla un link."); return; }
    // Scambi precedenti della chat (domande e risposte), senza trascrizioni, link e card.
    const storia = messages.filter((message) => !message.video && !message.welcomeCard && message.content.trim() && !(message.role === "user" && (/^https?:\/\/\S+$/i.test(message.content) || message.content.startsWith("🎬")))).slice(-6).map((message) => ({ role: message.role === "user" ? "user" as const : "assistant" as const, content: message.content }));
    const assistantId = createId();
    const startedAt = Date.now();
    stickToBottomRef.current = true;
    setMessages((current) => [...current, ...(question ? [{ id: createId(), role: "user" as const, content: question }] : []), { id: assistantId, role: "assistant", content: "", modelName: "Video", pending: { title: question ? "Risposta" : "Riassunto", startedAt } }]);
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true); setError("");
    const streamBatch = createStreamBatch((content) => setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content, pending: undefined } : message)));
    let text = "";
    try {
      const response = await fetch("/api/video/chiedi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trascrizione, domanda: question, storia }), signal: controller.signal });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `Errore HTTP ${response.status}`);
      if (!response.body) throw new Error("Risposta streaming non disponibile.");
      const model = response.headers.get("X-Model") ?? "";
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, modelName: model || "Video" } : message));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        // Righe di stato (\u0001parte 2/5) arrivano prima del testo.
        while (buffer.startsWith("\u0001") && buffer.includes("\n")) {
          const end = buffer.indexOf("\n");
          const detail = buffer.slice(1, end);
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, pending: { title: "Riassunto", detail: detail || undefined, startedAt } } : message));
          buffer = buffer.slice(end + 1);
        }
        if (buffer.startsWith("\u0001") && !done) continue;
        const failure = buffer.indexOf("\u0002");
        if (failure >= 0) { streamBatch.append(buffer.slice(0, failure)); throw new Error(buffer.slice(failure + 1)); }
        if (buffer) { streamBatch.append(buffer); text += buffer; buffer = ""; }
        if (done) break;
      }
      if (output && text.trim()) void fetch(`/api/output/Audio/${encodeURIComponent(output.name)}/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `${output.note}\n## Riassunto\n\n${text.trim()}\n` }) }).catch(() => undefined);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError(userErrorMessage(caught, question ? "Risposta non riuscita." : "Riassunto non riuscito."));
    } finally {
      streamBatch.flush();
      setMessages((current) => current.filter((message) => message.id !== assistantId || message.content).map((message) => message.id === assistantId ? { ...message, pending: undefined } : message));
      if (abortRef.current === controller) { setLoading(false); abortRef.current = null; }
    }
  }

  /**
   * Riassunto e punti d'azione della trascrizione, in streaming in un nuovo messaggio.
   * Trascrizioni più lunghe del contesto: sintesi parte per parte, poi riassunto finale sulle sintesi (nessun limite di lunghezza).
   */
  async function summarizeTranscript(transcript: string, conversationId: string, output?: { name: string; note: string }) {
    if (!selectedModel) { setError("Riassunto: nessun modello selezionato."); return; }
    const model = selectedModel;
    const maxTokens = isOllama ? selectedOllamaProfile.maxTokens : settings.maxTokens;
    const numCtx = isOllama ? selectedOllamaProfile.numCtx : 4096;
    // Stesso conto del backend (3 caratteri per token, 512 di margine), meno lo spazio delle istruzioni.
    const chunkChars = isOllama ? Math.max(1500, Math.floor((numCtx - maxTokens - 512 - 300) * 3 * 0.9)) : 60_000;
    const assistantId = createId();
    const startedAt = Date.now();
    setMessages((current) => [...current, { id: assistantId, role: "assistant", content: "", modelId: model.id, modelName: model.name, modelProvider: model.provider }]);
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    const streamBatch = createStreamBatch((content) => setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content } : message)));
    const setPending = (detail?: string) => setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, pending: detail ? { title: "Riassunto", detail, startedAt } : undefined } : message));
    const ask = async (prompt: string, onToken?: (token: string) => void) => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id, provider: model.providerId, conversationId, brain: false, webSearch: false,
          messages: [{ role: "system", content: "Rispondi in italiano. Non inventare nulla che non sia nella trascrizione." }, { role: "user", content: prompt }],
          ...settings, temperature: 0.2, maxTokens, numCtx, diagnostics: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `Errore HTTP ${response.status}`);
      if (!response.body) throw new Error("Risposta streaming non disponibile.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", text = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        if (done && buffer.trim()) lines.push(buffer);
        for (const line of lines) {
          const data = line.trim().replace(/^data:\s*/, "");
          if (!data || data === "[DONE]") continue;
          let event: { choices?: Array<{ delta?: { content?: string } }>; error?: string };
          try { event = JSON.parse(data); } catch { continue; }
          if (event.error) throw new Error(event.error);
          const token = event.choices?.[0]?.delta?.content ?? "";
          if (token) { text += token; onToken?.(token); }
        }
        if (done) break;
      }
      return text.trim();
    };
    /** Divide su fine frase vicino al limite, così nessuna parte supera il contesto. */
    const split = (text: string) => {
      const parts: string[] = [];
      let rest = text.trim();
      while (rest.length > chunkChars) {
        const window = rest.slice(0, chunkChars);
        const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf("\n"));
        const space = window.lastIndexOf(" ");
        const at = sentence > chunkChars * 0.6 ? sentence + 1 : space > chunkChars * 0.6 ? space : chunkChars;
        parts.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) parts.push(rest);
      return parts;
    };
    let summary = "";
    try {
      let material = transcript;
      let label = "Trascrizione";
      for (let round = 1; material.length > chunkChars; round++) {
        const parts = split(material);
        const notes: string[] = [];
        for (const [index, part] of parts.entries()) {
          setPending(`${round > 1 ? `giro ${round} · ` : ""}parte ${index + 1}/${parts.length}`);
          notes.push(await ask(`${label}, parte ${index + 1} di ${parts.length}:\n\n${part}\n\nElenca in modo sintetico i fatti, i concetti e le cose da fare di questa parte (al massimo 8 punti, con nomi, numeri e date citati). Solo l'elenco.`));
        }
        material = notes.map((note, index) => `### Parte ${index + 1}\n${note}`).join("\n\n");
        label = "Appunti per parti della trascrizione";
      }
      setPending(undefined);
      summary = await ask(`${label}:\n\n${material}\n\nScrivi:\n## Riassunto\n3-5 frasi.\n## Punti d'azione\nElenco puntato di cose da fare, con chi e quando se citati. Se non ce ne sono scrivi "Nessuno".`, (token) => streamBatch.append(token));
      // Il riassunto finisce nella stessa nota di OUTPUT/Audio.
      if (output && summary) void fetch(`/api/output/Audio/${encodeURIComponent(output.name)}/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `${output.note}\n${summary}\n` }) }).catch(() => undefined);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError(userErrorMessage(caught, "Riassunto non riuscito."));
    } finally {
      streamBatch.flush();
      setMessages((current) => current.filter((message) => message.id !== assistantId || message.content).map((message) => message.id === assistantId ? { ...message, pending: undefined } : message));
      if (abortRef.current === controller) { setLoading(false); abortRef.current = null; }
    }
  }

  function openOutputFolder(folder: "images" | "ocr" | "yolo" | null) {
    setOutputFolder(folder);
    setOutputOpen(true);
    void fetch("/api/output").then(response => response.json()).then(data => setOutputFiles(data)).catch(() => setOutputFiles(emptyOutputFiles));
  }

  function openOutputNote(note: { folder: "Analyze"; name: string }) {
    setOutputFolder("analyze");
    setCompactOpen(note);
    setOutputOpen(true);
    void fetch("/api/output").then(response => response.json()).then(data => setOutputFiles(data)).catch(() => setOutputFiles(emptyOutputFiles));
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

  useEffect(() => {
    audioSummaryRef.current = audioSummary;
    try { localStorage.setItem("andreagpt-audio-summary", String(audioSummary)); } catch { /* preferenza solo locale */ }
  }, [audioSummary]);

  useEffect(() => {
    try { localStorage.setItem("andreagpt-ocr-brain", String(ocrToBrain)); } catch { /* preferenza solo locale */ }
  }, [ocrToBrain]);

  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    setRecordingSeconds(0);
    const timer = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [recording]);

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

  const overlayOpen = brainOpen || brainGraphOpen || embeddingOpen || brainInfoOpen || detailsOpen || instructionsOpen || settingsOpen || outputOpen || Boolean(outputDelete) || researchOpen || Boolean(renameDialog);
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
  const agentModel = localOllamaModels.find((model) => model.id === agentConfig?.model);
  const agentModelOptions = agentConfig?.model && !agentModel ? [...localOllamaModels, { id: agentConfig.model, name: agentConfig.model, provider: "Ollama", providerId: "ollama" as const, description: "", tags: [] }] : localOllamaModels;
  const activeConversationTitle = conversations.find((conversation) => conversation.id === activeConversationId)?.title ?? "";
  const imageConversation = specialMode === "image" || /^Image \d+$/i.test(activeConversationTitle);
  const activeConversationMode = conversationMode(conversations.find((conversation) => conversation.id === activeConversationId));
  useEffect(() => {
    if (!settingsOpen && specialMode !== "agent") return;
    let active = true;
    void fetch("/api/agent/config").then(async (response) => {
      const data = (await response.json().catch(() => ({}))) as Partial<AgentConfig> & { error?: string };
      if (!response.ok) throw new Error(data.error || `Errore HTTP ${response.status}`);
      if (active) { setAgentConfig({ model: data.model ?? "", writable: Array.isArray(data.writable) ? data.writable : [] }); setAgentConfigError(""); }
    }).catch((caught) => { if (active) setAgentConfigError(userErrorMessage(caught, "Configurazione non disponibile.")); });
    return () => { active = false; };
  }, [settingsOpen, specialMode]);
  // Anche dopo un ricaricamento la chat riapre il suo strumento (YOLO, OCR, Analyze…).
  useEffect(() => {
    if (activeConversationMode !== "normal") setSpecialMode(activeConversationMode);
  }, [activeConversationId, activeConversationMode]);

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
  const brainPrivate = brainEnabled || messages.some((message) => message.brainPrivate) || Boolean(conversations.find((c) => c.id === activeConversationId)?.brainPrivate);
  const isOllama = selectedModel?.providerId === "ollama";
  const selectedTask = TASKS.find((task) => task.id === taskId) ?? TASKS[0];
  const filteredModels = visibleModels.filter((model) => {
    const term = search.toLowerCase();
    return `${model.name} ${model.id} ${model.provider} ${model.tags.join(" ")}`.toLowerCase().includes(term);
  });
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

  // Il testo del report sta in utils/diagnostic_report.ts: qui si cerca solo il messaggio utente che lo ha generato.
  function diagnosticReport(message: ChatMessage) {
    const messageIndex = messages.findIndex(item => item.id === message.id);
    const requestMessage = messageIndex > 0 ? [...messages.slice(0, messageIndex)].reverse().find(item => item.role === "user") : undefined;
    return buildDiagnosticReport(message, requestMessage);
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

  function toggleMessagePanel(messageId: string, panel: "brain" | "web" | "metrics" | "diagnostics" | "image" | "shap" | "semantic" | "logs") {
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

  /** SHAP: calcolato solo quando lo apri, poi resta nel messaggio. */
  async function openShap(message: ChatMessage, messageIndex: number) {
    toggleMessagePanel(message.id, "shap");
    if (message.shap || shapLoading || !message.brainSources?.length) return;
    const query = [...messages.slice(0, messageIndex)].reverse().find(item => item.role === "user")?.content.trim();
    if (!query) return;
    setShapLoading(message.id);
    try {
      const response = await fetch("/api/brain/shap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, sources: message.brainSources.map(source => source.source) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "SHAP non disponibile.");
      setMessages(current => current.map(item => item.id === message.id ? { ...item, shap: result } : item));
    } catch (caught) { setError(userErrorMessage(caught, "SHAP non disponibile.")); }
    finally { setShapLoading(""); }
  }

  /** Biforcazione: riprende la risposta dal token `at` usando `token` al posto di quello scelto dal modello. */
  async function branchFrom(message: ChatMessage, at: number, token: string, from: string, to: string) {
    if (!message.tokenTrace || branchingMessage) return;
    const prefix = message.tokenTrace.tokens.slice(0, at).map(item => item.t).join("") + token;
    setBranchingMessage(message.id);
    try {
      const response = await fetch("/api/branch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: message.tokenTrace.id, prefix }) });
      const result = await response.json() as { tokens?: TokenTrace["tokens"]; error?: string };
      if (!response.ok || !result.tokens) throw new Error(result.error || "Biforcazione non riuscita.");
      const branch = { at, from, to, token, tokens: result.tokens };
      setMessages(current => current.map(item => item.id === message.id ? { ...item, tokenBranches: [...(item.tokenBranches ?? []), branch] } : item));
    } catch (caught) { setError(userErrorMessage(caught, "Biforcazione non riuscita.")); }
    finally { setBranchingMessage(""); }
  }

  /** Anteprima di una parola alternativa: pochi token dopo il prefisso, stesso contesto della risposta. */
  async function completeWord(message: ChatMessage, prefix: string) {
    const response = await fetch("/api/branch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: message.tokenTrace!.id, prefix, maxTokens: 4 }) });
    const result = await response.json() as { text?: string; error?: string };
    if (!response.ok) throw new Error(result.error || "Completamento non riuscito.");
    return result.text ?? "";
  }

  /** Voto su una singola fonte: cambia solo il suo ranking per domande simili, non la mappa Micelio. */
  async function rateBrainSource(message: ChatMessage, messageIndex: number, source: string, rating: 1 | -1) {
    const query = [...messages.slice(0, messageIndex)].reverse().find(item => item.role === "user")?.content.trim();
    if (!query) return;
    try {
      const response = await fetch("/api/brain/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, rating, sources: [source] }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Feedback non salvato.");
      setMessages(current => current.map(item => item.id === message.id ? { ...item, sourceFeedback: { ...item.sourceFeedback, [source]: rating } } : item));
    } catch (caught) { setError(userErrorMessage(caught, "Feedback non salvato.")); }
  }

  useEffect(() => { void refreshBrainPaths(); }, []);
  useEffect(() => {
    const openBrainArchive = () => { setBrainGraphOpen(false); setEmbeddingOpen(false); setBrainOpen(true); };
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

  // La chat attiva sta già dentro "andreagpt-conversations": la vecchia copia separata occupava solo spazio.
  useEffect(() => { try { localStorage.removeItem("andreagpt-messages"); } catch { /* sessione privata */ } }, []);

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
      const conversation: Conversation = { id: activeConversationId, title, customTitle: existing?.customTitle, mode: existing?.mode, brainPrivate: existing?.brainPrivate || messages.some((m) => m.brainPrivate), messages, modelId: selectedModelId, updatedAt: Date.now() };
      const exists = Boolean(existing);
      return exists
        ? current.map((item) => item.id === activeConversationId ? conversation : item)
        : [conversation, ...current];
    });
  }, [activeConversationId, messages, selectedModelId, loading]);

  // Ogni avvio apre una scheda nuova e le vecchie restano aperte con la loro lista in memoria:
  // la scheda più recente vince, le altre smettono di scrivere e si ricaricano appena libere.
  const staleTabRef = useRef(false);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("andreagpt-tabs");
    channel.onmessage = (event) => {
      if (event.data !== "nuova-scheda") return;
      staleTabRef.current = true;
      if (!loadingRef.current) reloadStaleTab();
    };
    // Una scheda ricaricata perché vecchia non si annuncia: altrimenti le schede si ricaricherebbero a vicenda.
    let reloadedAsStale = false;
    try { reloadedAsStale = sessionStorage.getItem(STALE_RELOAD_KEY) === "1"; sessionStorage.removeItem(STALE_RELOAD_KEY); } catch { /* sessione privata */ }
    if (!reloadedAsStale) channel.postMessage("nuova-scheda");
    return () => channel.close();
  }, []);
  useEffect(() => {
    if (!staleTabRef.current || loading) return;
    // La risposta appena finita va salvata, ma solo le chat più aggiornate qui che nel browser.
    try {
      const stored = JSON.parse(localStorage.getItem("andreagpt-conversations") ?? "[]") as Conversation[];
      const newer = conversations.filter((mine) => !stored.some((other) => other.id === mine.id && other.updatedAt >= mine.updatedAt));
      if (newer.length) persistConversations([...newer, ...stored.filter((other) => !newer.some((mine) => mine.id === other.id))]);
    } catch { /* memoria piena: si ricarica comunque */ }
    reloadStaleTab();
  }, [loading]);

  useEffect(() => {
    if (staleTabRef.current) return;
    try { persistConversations(conversations); } catch { /* quota piena: resta lo stato in memoria */ }
  }, [conversations]);

  // Una cancellazione fatta in un'altra scheda, o salvata sul server, vale subito anche qui.
  useEffect(() => {
    function dropDeleted() {
      const deleted = loadDeletedConversationIds();
      setConversations((current) => current.some((conversation) => deleted.has(conversation.id)) ? current.filter((conversation) => !deleted.has(conversation.id)) : current);
      if (deleted.has(activeConversationIdRef.current)) { setActiveConversationId(""); setMessages([]); setSpecialMode("normal"); }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === DELETED_CONVERSATIONS_KEY) dropDeleted();
    }
    window.addEventListener("storage", onStorage);
    // Il localStorage può tornare indietro se Chrome si chiude male: l'elenco del server è quello che conta.
    void syncDeletedConversations().then((changed) => { if (changed) dropDeleted(); });
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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

  useEffect(() => { try { localStorage.setItem("andreagpt-diagnostics", String(diagnosticsEnabled)); } catch { /* sessione privata */ } }, [diagnosticsEnabled]);
  useEffect(() => { try { localStorage.setItem("andreagpt-brain-source-count", String(brainSourceCount)); } catch { /* sessione privata */ } }, [brainSourceCount]);
  useEffect(() => { try { localStorage.setItem("andreagpt-brain-rerank", String(brainRerank)); } catch { /* sessione privata */ } }, [brainRerank]);

  useEffect(() => {
    try { localStorage.setItem("andreagpt-settings", JSON.stringify(settings)); } catch { /* sessione privata */ }
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("andreagpt-brain-enabled", String(brainEnabled));
  }, [brainEnabled]);

  useEffect(() => {
    localStorage.setItem("andreagpt-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "cosmic" ? "#FFF8E7" : theme === "tropico" ? "#0A1426" : "#080A08");
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("andreagpt-history-collapsed", String(historyCollapsed));
    localStorage.setItem("andreagpt-models-collapsed", String(modelsCollapsed));
  }, [historyCollapsed, modelsCollapsed]);

  useEffect(() => {
    localStorage.setItem("andreagpt-custom-instructions", JSON.stringify(customInstructions));
  }, [customInstructions]);

  useEffect(() => {
    try { localStorage.setItem("andreagpt-welcome-cards", JSON.stringify(cardTexts)); } catch { /* quota superata: resta lo stato in memoria */ }
  }, [cardTexts]);

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
        const data = await response.json() as { status?: "stopped" | "unreachable" | "ready"; ready?: boolean };
        if (active) setImageService(data.ready ? { status: "ready", ready: true, message: "ComfyUI attivo" }
          : data.status === "stopped" ? { status: "stopped", ready: false, message: "ComfyUI non attivo" }
          : { status: "error", ready: false, message: "ComfyUI non raggiungibile" });
      } catch {
        if (active) setImageService({ status: "error", ready: false, message: "ComfyUI non raggiungibile" });
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

  // Notifiche di sistema a fine lavoro lungo (News, Analyze, Image, OCR): solo se la pagina non è in primo piano.
  function askNotifyPermission() {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
  }
  function notifyDone(title: string, body: string, open: () => void) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    const notification = new Notification(title, { body, icon: "/andreagpt-logo-128.png" });
    notification.onclick = () => { window.focus(); open(); notification.close(); };
  }
  function goToConversation(id: string) {
    const conversation = conversationsRef.current.find(item => item.id === id);
    if (conversation && activeConversationIdRef.current !== id) openConversation(conversation);
  }
  const conversationTitle = (id: string) => conversationsRef.current.find(item => item.id === id)?.title ?? "chat";

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
    setSpecialMode(conversationMode(conversation));
    if (models.some((model) => model.id === conversation.modelId)) setSelectedModelId(conversation.modelId);
    setSidebarOpen(false);
  }

  function deleteConversation(id: string) {
    if (loading) return;
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    // Remove the record immediately so a refresh cannot resurrect a deleted chat
    // while React is still committing the state update.
    let saved = false;
    try { persistConversations(remaining); saved = true; } catch { /* sotto: si riprova dopo aver registrato l'ID */ }
    rememberDeletedConversation(id);
    if (!saved) try { persistConversations(remaining); } catch { /* resta il filtro sugli ID cancellati */ }
    setConversations(remaining);
    if (id === activeConversationId) {
      const next = remaining[0];
      localStorage.removeItem("andreagpt-messages");
      if (next) localStorage.setItem("andreagpt-active-conversation", next.id);
      else localStorage.removeItem("andreagpt-active-conversation");
      setBrainEnabled(Boolean(next?.brainPrivate));
      setActiveConversationId(next?.id ?? "");
      setMessages(next?.messages ?? []);
      setSpecialMode(conversationMode(next));
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
    const job = createId();
    researchJobRef.current = job;
    askNotifyPermission();
    let notice: { title: string; body: string } | null = null;
    setResearchType(type); setResearchLoading(true); setResearchResult(null); setResearchPage(0); setResearchOpen(true);
    setResearchProgress(null);
    try {
      const response = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" }, body: JSON.stringify({ type, job }), signal: controller.signal });
      if (!response.ok || !/x-ndjson/.test(response.headers.get("Content-Type") ?? "") || !response.body) {
        const data = await readJsonResponse<{ label: string; article: string; sources: Array<{ id: number; title: string; url: string; description: string }>; error?: string }>(response);
        if (!response.ok) throw new Error(data.error || "Ricerca non riuscita.");
        if (researchAbortRef.current === controller) setResearchResult(data);
        notice = { title: "News pronta", body: `${data.label} · salvata in Output → News.` };
        return;
      }
      // Edizione locale in streaming: ogni riga è un evento, gli articoli arrivano appena redatti.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim() || researchAbortRef.current !== controller) continue;
          const event = JSON.parse(line) as { type: string; label?: string; sources?: Array<{ id: number; title: string; url: string; description: string }>; markdown?: string; error?: string };
          if (event.type === "done") notice = { title: "News pronta", body: "Edizione completa · salvata in Output → News." };
          if (event.type === "meta") { setResearchResult({ label: event.label ?? "", article: "", sources: event.sources ?? [] }); setResearchProgress({ done: 0, total: event.sources?.length ?? 0 }); }
          else if (event.type === "article" && event.markdown) {
            setResearchResult(current => current && { ...current, article: current.article ? `${current.article}\n\n${event.markdown}` : event.markdown! });
            setResearchProgress(current => current && { ...current, done: current.done + 1 });
          } else if (event.type === "error") throw new Error(event.error);
        }
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      // Interruzione o errore a metà: gli articoli già arrivati restano leggibili.
      if (researchAbortRef.current === controller) setResearchResult(current => current?.article ? current : { label: aborted ? "Operazione annullata" : "Errore", article: aborted ? "La creazione dell’edizione è stata annullata. Puoi riprovarla quando vuoi." : `**Ricerca non disponibile**\n\n${error instanceof Error ? error.message : "Errore sconosciuto."}`, sources: [] });
    } finally {
      if (researchAbortRef.current === controller) { researchAbortRef.current = null; researchJobRef.current = null; setResearchLoading(false); }
      if (notice && !controller.signal.aborted) notifyDone(notice.title, notice.body, () => setResearchOpen(true));
      // L'edizione è salvata in OUTPUT/News: il conteggio della cartella si aggiorna.
      void fetch("/api/output").then(response => response.json()).then(data => setOutputFiles(data)).catch(() => undefined);
    }
  }

  // Chiudere la finestra lascia lavorare il backend; solo Interrompi annulla anche lato server.
  function stopResearch() {
    if (researchJobRef.current) void fetch(`/api/research/${researchJobRef.current}`, { method: "DELETE" }).catch(() => undefined);
    researchAbortRef.current?.abort();
  }

  async function openSavedEdition(name: string) {
    const response = await fetch(`/api/output/News/${encodeURIComponent(name)}/content`);
    const text = ((await response.json().catch(() => ({}))) as { content?: string }).content?.replace(/\r\n/g, "\n") ?? "";
    const [main, sourcesPart = ""] = text.split(/^## Fonti consultate\s*$/m);
    const sources = [...sourcesPart.matchAll(/^\[(\d+)\]\s*(.+)\n(\S+)/gm)].map(match => ({ id: Number(match[1]), title: match[2], url: match[3], description: "" }));
    setResearchResult({ label: text.match(/^#\s+(.+)$/m)?.[1] ?? "News", date: text.match(/^Data:\s*(.+)$/m)?.[1], article: main.replace(/^#\s+.+$/m, "").replace(/^Data:.*$/m, "").trim() || "—", sources });
    setResearchPage(0); setOutputOpen(false); setOutputFolder(null); setResearchOpen(true);
  }

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
    const content = `# ${researchResult.label}\n\nData: ${researchResult.date ?? new Date().toLocaleDateString("it-IT")}\n\n${article}\n\n## Fonti consultate\n\n${sourceText}`;
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

  const ultimaRisposta = [...messages].reverse().find((message) => message.role === "assistant");
  const voce = useVoiceMode({ risposta: ultimaRisposta, loading, invia: (testo) => sendMessage(testo), onErrore: setError });

  async function sendMessage(text = input) {
    const content = text.trim();
    // Skill \chat: ristampa la card di benvenuto dello strumento attivo sotto i risultati, senza cancellarli.
    if (/^[\\/]chat$/i.test(content) && !attachments.length) {
      setInput("");
      // La card è quella della chat in cui ti trovi, non dell'ultimo strumento cliccato.
      const activeChat = conversations.find((conversation) => conversation.id === activeConversationId);
      const chatMode = activeChat ? conversationMode(activeChat) : specialMode;
      const cardMode = chatMode !== "normal" ? chatMode : audioWelcomeMode !== "none" ? audioWelcomeMode : messages.some((message) => message.audio) ? "transcribe" : "normal";
      if (messages.length) { stickToBottomRef.current = true; setMessages((current) => [...current, { id: createId(), role: "assistant", content: "", welcomeCard: cardMode }]); }
      return;
    }
    if ((!content && !attachments.length) || loading || (specialMode === "normal" && !selectedModel)) return;
    if (specialMode === "ocr") { await processOcrBatch(); return; }
    if (specialMode === "yolo") { await processYoloBatch(); return; }
    if (specialMode === "analyze") { await processAnalyzeBatch(content); return; }
    if (specialMode === "convert") return;
    if (specialMode === "image") { await processImage(content); return; }
    if (specialMode === "agent") { if (content) await processAgent(content); return; }
    if (specialMode === "video" && /^https?:\/\/\S+$/i.test(content) && !attachments.length) { setInput(""); await transcribeVideo({ url: content }); return; }
    // Chat Video: il testo libero è una domanda sulle trascrizioni della chat.
    if (specialMode === "video" && !attachments.length) { setInput(""); await askVideo({ question: content }); return; }
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
          brainSourceCount: brainSourceCount || undefined,
          brainRerank,
          diagnostics: diagnosticsEnabled,
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
          let event: { choices?: Array<{ delta?: { content?: string } }>; brainSources?: BrainCitation[]; webSources?: WebCitation[]; metrics?: Record<string, number>; diagnostics?: DiagnosticTrace; tokenTrace?: TokenTrace; error?: string };
          try { event = JSON.parse(data); } catch { continue; }
            if (event.error) throw new Error(event.error);
            if (event.metrics) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, metrics: event.metrics } : message));
            if (event.tokenTrace) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, tokenTrace: event.tokenTrace, tokenBranches: undefined } : message));
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
        setError(userErrorMessage(caught, "Si è verificato un errore."));
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
    } catch (caught) { setError(userErrorMessage(caught, "Compattazione non riuscita.")); }
    finally { setCompactingChat(false); }
  }

  // Chat Agente: run SSE dedicato; ogni evento aggiorna la trascrizione salvata nel messaggio assistente.
  async function processAgent(content: string) {
    const conversationId = activeConversationId || createId();
    if (!activeConversationId) setActiveConversationId(conversationId);
    const userMessage: ChatMessage = { id: createId(), role: "user", content };
    const assistantId = createId();
    const startedAt = Date.now();
    const history = messages.filter((message) => !message.welcomeCard && (message.role === "user" || message.role === "assistant") && message.content.trim()).map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
    const profile = agentModel ? { ...defaultOllamaProfile(agentModel), ...ollamaProfiles[agentModel.id] } : undefined;
    let view: AgentView = { model: agentConfig?.model, writable: agentConfig?.writable, plan: [], steps: [], approvals: [] };
    let answer = "";
    const base = [...messages, userMessage];
    const current = (): ChatMessage => ({ id: assistantId, role: "assistant", content: answer, agent: view, modelId: view.model, modelName: "Agente" });
    const render = (save = false) => {
      const message = current();
      setMessages((list) => list.map((item) => item.id === assistantId ? message : item));
      // Anche a run aperto: approvazioni ed esiti sopravvivono a una ricarica.
      if (save) setConversations((list) => list.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: [...base, message], updatedAt: Date.now() } : conversation));
    };
    stickToBottomRef.current = true;
    setMessages([...base, current()]);
    setInput(""); setAttachments([]); setError(""); setLoading(true); setAgentLiveId(assistantId);
    // Le azioni dalla card (errore approvazione, annulla) passano dalla stessa trascrizione locale del run.
    agentLiveUpdateRef.current = (update) => { view = update(view); render(); };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const body: AgentRunRequest = { conversationId, messages: [...history, { role: "user", content }], numCtx: profile?.numCtx, maxTokens: profile?.maxTokens };
      const response = await fetch("/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `Errore HTTP ${response.status}`);
      if (!response.body) throw new Error("Risposta streaming non disponibile.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        if (done && buffer.trim()) lines.push(buffer);
        let changed = false;
        let save = false;
        for (const line of lines) {
          const data = line.trim().replace(/^data:\s*/, "");
          if (!data) continue;
          if (data === "[DONE]") { finished = true; break; }
          let event: AgentEvent;
          try { event = JSON.parse(data) as AgentEvent; } catch { continue; }
          ({ view, answer } = foldAgentEvent(view, answer, event));
          changed = true;
          if (event.type === "approval" || event.type === "approval_result" || event.type === "done" || event.type === "error") save = true;
        }
        if (changed) render(save);
        if (done) break;
      }
      if (finished) void reader.cancel().catch(() => undefined);
      view = closeAgentView(view, view.error ? "Errore" : "Interrotto", startedAt);
    } catch (caught) {
      const aborted = (caught as Error).name === "AbortError";
      view = closeAgentView(aborted ? view : { ...view, error: view.error ?? userErrorMessage(caught, "Agente non disponibile.") }, aborted ? "Interrotto" : "Errore", startedAt);
    } finally {
      agentLiveUpdateRef.current = null;
      render(true);
      if (abortRef.current === controller) { setLoading(false); abortRef.current = null; }
      setAgentLiveId((id) => id === assistantId ? "" : id);
    }
  }

  function updateAgentMessage(id: string, update: (view: AgentView) => AgentView) {
    if (id === agentLiveId && agentLiveUpdateRef.current) { agentLiveUpdateRef.current(update); return; }
    setMessages((list) => list.map((message) => message.id === id && message.agent ? { ...message, agent: update(message.agent) } : message));
  }

  async function saveAgentConfig(patch: Partial<AgentConfig>) {
    setAgentConfigError("");
    try {
      const response = await fetch("/api/agent/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = (await response.json().catch(() => ({}))) as Partial<AgentConfig> & { error?: string };
      if (!response.ok) throw new Error(data.error || `Errore HTTP ${response.status}`);
      setAgentConfig((current) => ({ model: data.model ?? patch.model ?? current?.model ?? "", writable: data.writable ?? patch.writable ?? current?.writable ?? [] }));
      return true;
    } catch (caught) { setAgentConfigError(userErrorMessage(caught, "Salvataggio non riuscito.")); return false; }
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
    if (specialMode === "video") {
      const videoFile = selectedFiles.find(file => file.type.startsWith("video/") || VIDEO_FILE.test(file.name));
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!videoFile) { setError("Allega un file video."); return; }
      await transcribeVideo({ file: videoFile });
      return;
    }
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
      setError(userErrorMessage(caught, "Impossibile leggere uno degli allegati."));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function openSpecialChat(mode: Exclude<SpecialMode, "normal">) {
    abortRef.current?.abort();
    const initialInput = "";
    setLoading(false); setMessages([]); setAttachments([]); setInput(initialInput); setError(""); setBrainEnabled(false); setSpecialMode(mode); setAudioWelcomeMode("none");
    if (mode === "yolo") setYoloTask("detect");
    const prefix = mode === "ocr" ? "OCR" : mode === "yolo" ? "YOLO" : mode === "analyze" ? "Analyze" : mode === "image" ? "Image" : mode === "video" ? "Video" : mode === "agent" ? "Agente" : "Converti";
    const nextNumber = conversations.reduce((max, conversation) => {
      const match = conversation.title.match(mode === "analyze" ? /^(?:Analyze|Analizza IMG) (\d+)$/i : new RegExp(`^${prefix} (\\d+)$`, "i"));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const id = createId();
    const title = `${prefix} ${nextNumber}`;
    setActiveConversationId(id);
    setConversations((current) => [{ id, title, customTitle: true, mode, messages: [], modelId: selectedModelId, updatedAt: Date.now() }, ...current]);
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
    const conversationId = activeConversationId || createId();
    if (!activeConversationId) setActiveConversationId(conversationId);
    askNotifyPermission();
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
        let brainNote = "";
        if (ocrToBrain && result.text?.trim()) {
          const bytes = new TextEncoder().encode(result.text);
          let binary = "";
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
          const brainResponse = await fetch("/api/brain/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset: 100, files: [{ name: `${attachment.name.replace(/\.[^.]+$/, "")}-ocr.txt`, data: btoa(binary) }] }) });
          const brainResult = await brainResponse.json().catch(() => ({})) as { error?: string };
          brainNote = brainResponse.ok ? " Indicizzato nel Brain." : ` Brain non aggiornato: ${brainResult.error || `HTTP ${brainResponse.status}`}`;
        }
        results.push(`### ${attachment.name}\n${result.text || "Nessun testo riconosciuto."}\n\n_Risultato salvato in ${result.output || "OCR/output"}.${brainNote}_`);
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: results.join("\n\n") } : message));
      }
      notifyDone("OCR completato", `${results.length} file · testo in chat "${conversationTitle(conversationId)}" e in Output → OCR.`, () => goToConversation(conversationId));
    } catch (caught) { setMessages((current) => current.filter((message) => message.id !== assistantId)); setError(userErrorMessage(caught, "OCR non riuscito.")); notifyDone("OCR non riuscito", userErrorMessage(caught, "OCR non riuscito."), () => goToConversation(conversationId)); }
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
      const images: { url: string; name: string; plain?: string; cutout?: string }[] = [];
      const files: { url: string; name: string }[] = [];
      for (const attachment of pending) {
        const response = await fetch("/api/yolo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: attachment.name, type: attachment.type, task: yoloTask, data: attachment.dataUrl }) });
        const result = await response.json() as { text?: string; error?: string; image?: string; plain?: string; cutout?: string; files?: { url: string; name: string }[] };
        if (!response.ok) throw new Error(result.error || `YOLO non riuscito per ${attachment.name}.`);
        results.push(`### ${attachment.name}\n${result.text || "Nessun elemento rilevato."}`);
        if (result.image) images.push({ url: result.image, name: attachment.name, plain: result.plain, cutout: result.cutout });
        if (result.files) files.push(...result.files);
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: results.join("\n\n"), resultImages: images.length ? [...images] : undefined, resultFiles: files.length ? [...files] : undefined } : message));
      }
    } catch (caught) { setMessages((current) => current.filter((message) => message.id !== assistantId)); setError(userErrorMessage(caught, "Analisi YOLO non riuscita.")); }
    finally { setLoading(false); }
  }

  async function processAnalyzeBatch(prompt: string) {
    const pending = attachments.filter((attachment) => attachment.kind === "image" && attachment.dataUrl);
    if (!pending.length) { setError("Analyze: allega una o più immagini."); return; }
    const question = prompt.trim() || "Descrivi dettagliatamente l'immagine in italiano. Elenca oggetti, posizione, testo visibile e dettagli incerti.";
    const conversationId = activeConversationId || createId();
    const userMessage: ChatMessage = { id: createId(), role: "user", content: question, attachments: pending };
    const assistantId = createId();
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", content: "", pending: { title: "Preparo Qwen3-VL", detail: "Il primo avvio può richiedere alcuni minuti", startedAt: Date.now() } };
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
        mode: existing?.mode,
        brainPrivate: existing?.brainPrivate,
        messages: nextMessages,
        modelId: selectedModelId,
        updatedAt: Date.now(),
      };
      return existing ? current.map((conversation) => conversation.id === conversationId ? nextConversation : conversation) : [nextConversation, ...current];
    });
    if (activeConversationIdRef.current === conversationId) setMessages(initialMessages);
    setAttachments([]); setInput(""); setError(""); setLoading(true);
    setActiveOperation({ label: "Analyze", detail: "Preparazione del modello locale. Il primo avvio può richiedere alcuni minuti.", startedAt: Date.now(), inline: true });
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    analyzeConversationIdRef.current = conversationId;
    askNotifyPermission();
    const updateTargetMessages = (update: (current: ChatMessage[]) => ChatMessage[]) => {
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? { ...conversation, messages: update(conversation.messages), updatedAt: Date.now() }
        : conversation));
      if (activeConversationIdRef.current === conversationId) setMessages(update);
    };
    try {
      const results: string[] = [];
      const logs: string[] = [];
      const outputNotes: { folder: "Analyze"; name: string }[] = [];
      for (const [index, attachment] of pending.entries()) {
        const imageStarted = performance.now();
        if (activeConversationIdRef.current === conversationId) {
          setActiveOperation({ label: `Analyze ${index + 1}/${pending.length}`, detail: `Caricamento e analisi di ${attachment.name}. Il processo è attivo; puoi interromperlo con Stop.`, startedAt: Date.now(), inline: true });
        }
        updateTargetMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: results.join("\n\n"), pending: { title: "Sto analizzando il file", detail: pending.length > 1 ? `Immagine ${index + 1} di ${pending.length}` : "Qwen3-VL locale", startedAt: Date.now(), image: attachment.dataUrl } } : message));
        const response = await fetch("/api/analyze-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: attachment.name, type: attachment.type, prompt: question, data: attachment.dataUrl, maxTokens: settings.visionMaxTokens ?? 1024 }), signal: controller.signal });
        const result = await readJsonResponse<{ text?: string; output?: string; error?: string; resized?: { width: number; height: number }; model?: string; device?: string }>(response);
        if (!response.ok) throw new Error(result.error || `Analisi non riuscita per ${attachment.name}.`);
        const prefix = pending.length > 1 ? `${attachment.name} · ` : "";
        if (result.output) outputNotes.push({ folder: "Analyze", name: result.output });
        const elapsed = Math.max(1, Math.round((performance.now() - imageStarted) / 1000));
        const elapsedLabel = `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`;
        if (result.resized) logs.push(`${prefix}Input ridimensionato a ${result.resized.width}×${result.resized.height} per il modello.`);
        logs.push(`${prefix}Analisi completata · tempo: ${elapsedLabel} · modello: ${result.model || "Qwen3-VL"}${result.device ? ` · dispositivo: ${result.device}` : ""}`);
        results.push(`### ${attachment.name}\n${result.text || "Nessuna descrizione restituita."}`);
        updateTargetMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: results.join("\n\n"), logs: [...logs], outputNotes: [...outputNotes], pending: undefined } : message));
      }
      notifyDone("Analyze completato", `${pending.length} ${pending.length === 1 ? "immagine analizzata" : "immagini analizzate"} · risultato in chat "${conversationTitle(conversationId)}".`, () => goToConversation(conversationId));
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === "AbortError";
      updateTargetMessages((current) => current.map((message) => message.id === assistantId ? { ...message, pending: undefined, content: aborted ? "Analyze annullato dall’utente." : `Analyze non riuscito: ${caught instanceof Error ? caught.message : "errore sconosciuto"}` } : message));
      if (!aborted && activeConversationIdRef.current === conversationId) setError(userErrorMessage(caught, "Analisi immagine non riuscita."));
      if (!aborted) notifyDone("Analyze non riuscito", userErrorMessage(caught, "Analisi immagine non riuscita."), () => goToConversation(conversationId));
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
    if (!imageService.ready) { setError(imageService.message); return; }
    const assistantId = createId();
    const conversationId = activeConversationId;
    setMessages(current => [...current, { id: createId(), role: "user", content: prompt }, { id: assistantId, role: "assistant", content: "ComfyUI · avvio" }]);
    setInput(""); setError(""); setLoading(true);
    const started = performance.now();
    const controller = new AbortController();
    abortRef.current = controller;
    askNotifyPermission();
    let jobId = "";
    try {
      const response = await fetch("/api/image/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, ...imageSettings, flow: imageModel }), signal: controller.signal });
      const queued = await response.json() as { error?: string; jobId?: string };
      if (!response.ok || !queued.jobId) throw new Error(queued.error || "Generazione non avviata.");
      jobId = queued.jobId;
      let result: { error?: string; name?: string; url?: string; output?: string; width?: number; height?: number; seed?: number; device?: string; model?: string; generationMs?: number } = {};
      for (;;) {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        if (controller.signal.aborted) throw new DOMException("Generazione annullata.", "AbortError");
        const jobResponse = await fetch(`/api/image/jobs/${encodeURIComponent(jobId)}`);
        const job = await jobResponse.json() as typeof result & { status?: string; progress?: { phase: "queued" | "loading" | "sampling" | "decoding"; value: number; max: number } };
        if (job.status === "running") {
          const elapsedSeconds = Math.max(1, Math.round((performance.now() - started) / 1000));
          const elapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
          const progress = job.progress;
          const phase = !progress || progress.phase === "queued" ? "in coda"
            : progress.phase === "loading" ? "caricamento modelli"
            : progress.phase === "decoding" ? "decodifica"
            : `passo ${progress.value}/${progress.max} · ${Math.round(progress.value / Math.max(1, progress.max) * 100)}%`;
          setMessages(current => current.map(message => message.id === assistantId ? { ...message, content: `ComfyUI · ${phase} · ${elapsed}` } : message));
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
      notifyDone("Immagine pronta", `In chat "${conversationTitle(conversationId)}" e in Output → Immagini generate.`, () => goToConversation(conversationId));
    } catch (caught) {
      const cancelled = controller.signal.aborted;
      if (cancelled && jobId) void fetch(`/api/image/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => undefined);
      const content = cancelled ? "Generazione annullata." : `Generazione non riuscita: ${caught instanceof Error ? caught.message : "errore sconosciuto"}`;
      const failed = (message: ChatMessage): ChatMessage => message.id === assistantId ? { ...message, content } : message;
      setConversations(current => current.map(conversation => conversation.id === conversationId ? { ...conversation, messages: conversation.messages.map(failed), updatedAt: Date.now() } : conversation));
      if (activeConversationIdRef.current === conversationId) setMessages(current => current.map(failed));
      if (!cancelled) notifyDone("Immagine non riuscita", content, () => goToConversation(conversationId));
    } finally { if (abortRef.current === controller) abortRef.current = null; setLoading(false); }
  }

  if (new URLSearchParams(window.location.search).get("embeddingSpace") === "1") return <Suspense fallback={<div className="thinking">Caricamento spazio 3D…</div>}><EmbeddingSpace standalone /></Suspense>;
  if (new URLSearchParams(window.location.search).get("brainGraph") === "1") return <Suspense fallback={<div className="thinking">Caricamento grafo…</div>}><BrainGraph standalone /></Suspense>;

  // Card di benvenuto dello strumento attivo: home vuota e skill \chat.
  const renderWelcome = (specialMode: SpecialMode, audioWelcomeMode: AudioWelcomeMode) => (
            <div className={`welcome${specialMode !== "normal" || audioWelcomeMode !== "none" ? " welcome-plain" : " home-welcome"}${audioWelcomeMode !== "none" ? " audio-mode-welcome" : ""}`}>
              {audioWelcomeMode === "transcribe" && <div className="audio-mode-card"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("transcribe")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button>{editingCard === "transcribe" ? <AudioCardEditForm {...cardEditProps("transcribe")} /> : <AudioWelcomeCard variant="transcribe" recording={recording} transcribing={transcribing} title={cardTexts.transcribe.title} titleStyle={lineStyle(cardTexts.transcribe, "title")} model="Whisper locale"
                actions={<><button type="button" className="special-upload-button" onClick={() => audioInputRef.current?.click()} disabled={transcribing}><AudioLines size={17} /> Carica audio</button>{summaryToggle}</>} />}</div>}
              {audioWelcomeMode === "record" && <div className="audio-mode-card"><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("record")} title="Modifica testo della card" aria-label="Modifica testo della card"><Pencil size={15} /></button>{editingCard === "record" ? <AudioCardEditForm {...cardEditProps("record")} /> : <AudioWelcomeCard variant="record" recording={recording} transcribing={transcribing} title={cardTexts.record.title} titleStyle={lineStyle(cardTexts.record, "title")} model="Whisper locale"
                actions={<><button type="button" className={`special-upload-button${recording ? " recording" : ""}`} onClick={() => void toggleRecording()} disabled={transcribing}><Mic size={17} /> {recording ? "Termina" : "Registra"}</button>{recording && <span className="welcome-timer" role="timer" aria-label="Durata registrazione">{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}</span>}{summaryToggle}</>} />}</div>}
              {specialMode === "analyze" && <ToolWelcomeCard className="analyze-welcome" model="Qwen3-VL locale" text={cardTexts.analyze} {...cardEditProps("analyze")}
                actions={<button type="button" className="special-upload-button" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /> Carica immagini</button>} />}
              {specialMode === "ocr" && <ToolWelcomeCard model="docTR locale" text={cardTexts.ocr} {...cardEditProps("ocr")}
                actions={<><button type="button" className="special-upload-button" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /> Carica immagini o PDF</button><button type="button" className="welcome-chip" onClick={() => openOutputFolder("ocr")}><Folder size={16} /> Apri risultati</button><label className="welcome-chip" title="Indicizza subito il testo estratto nel Brain"><input type="checkbox" checked={ocrToBrain} onChange={(event) => setOcrToBrain(event.target.checked)} /> Salva nel Brain</label></>} />}
              {specialMode === "yolo" && <ToolWelcomeCard model="YOLO11 locale" text={cardTexts.yolo} {...cardEditProps("yolo")}
                actions={<><button type="button" className="special-upload-button" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /> Carica immagini</button><button type="button" className="special-upload-button" onClick={() => setYoloLiveOpen(true)}><Camera size={17} /> Live</button><select className="welcome-select" aria-label="Task YOLO" value={yoloTask} onChange={(event) => setYoloTask(event.target.value as YoloTask)}><option value="detect">Detection</option><option value="bbox">Bounding box</option><option value="segment">Segmentazione</option><option value="classify">Classificazione</option><option value="pose">Pose</option></select></>} />}
              {specialMode === "video" && <ToolWelcomeCard className="video-welcome" model="Whisper locale" text={cardTexts.video} {...cardEditProps("video")}
                actions={<><button type="button" className="special-upload-button" onClick={() => videoInputRef.current?.click()} disabled={loading}><Clapperboard size={17} /> Carica video</button>{summaryToggle}</>}>
                <form className="video-link-form" onSubmit={(event) => { event.preventDefault(); const url = videoLink.trim(); if (!/^https?:\/\/\S+$/i.test(url)) { setError("Link non valido."); return; } setVideoLink(""); void transcribeVideo({ url }); }}>
                  <Link2 size={16} aria-hidden="true" /><input type="url" inputMode="url" value={videoLink} onChange={(event) => setVideoLink(event.target.value)} placeholder="Link YouTube" aria-label="Link YouTube" /><button type="submit" className="primary-action" disabled={loading || !videoLink.trim()}>Trascrivi</button>
                </form>
              </ToolWelcomeCard>}
              {specialMode === "agent" && <ToolWelcomeCard className="agent-welcome" model={agentConfig?.model ?? "—"} text={{ ...cardTexts.agent, subtitle: "" }} editSubtitle={false} {...cardEditProps("agent")}>
                {agentConfig && <div className="agent-welcome-paths">{agentConfig.writable.length ? agentConfig.writable.map((folder) => <code key={folder}>{folder}</code>) : <span>Sola lettura</span>}</div>}
              </ToolWelcomeCard>}
              {specialMode === "convert" && <ToolWelcomeCard className="convert-welcome" model="Pandoc + LibreOffice" text={cardTexts.convert} {...cardEditProps("convert")}>
                <Suspense fallback={<div className="thinking">Caricamento convertitore…</div>}><ConvertPanel onResult={handleConvertedResult} /></Suspense>
              </ToolWelcomeCard>}
              {specialMode === "image" && <ToolWelcomeCard className="image-welcome" model={imageModel === "viggle" ? "Viggle Turbo" : "Qwen-Image 2.1"} text={{ ...cardTexts.image, subtitle: "" }} editSubtitle={false} {...cardEditProps("image")}
                status={<div className="image-status-row"><div className={`image-service-status ${imageService.status}`}><span className="status-dot" />{imageService.message}</div><div className="image-preset-row"><span>{imageSettings.width}×{imageSettings.height}</span><span>{imageModel === "viggle" ? 6 : imageSettings.steps} step</span><span>Seed {imageSettings.seed}</span></div></div>}
                actions={<div className="image-model-row" role="radiogroup" aria-label="Modello di generazione"><button type="button" role="radio" aria-checked={imageModel === "qwen"} className={imageModel === "qwen" ? "active" : ""} onClick={() => setImageModel("qwen")} title="Qwen-Image 2.1: qualità massima, ~25 passi"><strong>Qwen-Image 2.1</strong><small>Qualità · {imageSettings.steps} passi</small></button><button type="button" role="radio" aria-checked={imageModel === "viggle"} className={imageModel === "viggle" ? "active" : ""} onClick={() => setImageModel("viggle")} title="Viggle Turbo v0.2.1: distillato a 6 passi, circa 6 volte più veloce"><strong>Viggle Turbo</strong><small>Veloce · 6 passi fissi</small></button></div>} />}
              {specialMode === "normal" && audioWelcomeMode === "none" && <><button type="button" className="welcome-edit-button" onClick={() => startCardEdit("home")} title="Modifica testo di benvenuto" aria-label="Modifica testo di benvenuto"><Pencil size={15} /></button><span className="welcome-kicker">ANDREAGPT</span>{editingCard === "home" ? <WelcomeEditForm {...cardEditProps("home")} /> : <><WelcomeCardLines text={cardTexts.home} /><img className="welcome-cetriolo" src="/mascotte-welcome.png" alt="Mascotte AndreaGPT" /></>}</>}
             </div>
  );

  return (
    <div ref={appShellRef} className="app-shell" data-theme={theme === "tropico" ? "normal" : theme} data-palette={theme}>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><img src="/andreagpt-logo-128.png" alt="" /></div>
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
          <button className="sidebar-action" onClick={() => setSocialOpen(true)}><Bookmark size={17} /> Social</button>
          <button className="sidebar-action" onClick={() => setFotoOpen(true)}><Image size={17} /> Foto</button>
          <button className="sidebar-action" onClick={() => setCodeOpen(true)}><Code2 size={17} /> Code</button>
          <button className="sidebar-action" onClick={() => openOutputFolder(null)}><Folder size={17} /> Output</button>
          <button className="sidebar-action" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /> Impostazioni</button>
          <button className="sidebar-action" onClick={() => setInstructionsOpen(true)}><FileText size={17} /> Istruzioni</button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu" />}

      <main className="main-panel" style={{ "--chat-font": fonts[appearance.preferences.font], "--chat-font-size": `${appearance.preferences.size}px` } as React.CSSProperties}>
        {appearance.loaded && <UniverseBackground key={`${appearance.pictures.map(picture => picture.id).join("|")}:${appearance.preferences.pinned ?? ""}`} images={appearance.pictures.map(picture => ({ id: picture.id, url: picture.url }))} pinnedId={appearance.preferences.pinned} />}
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Apri menu"><Menu size={21} /></button>
          <div className="model-title">
            <span className={`status-dot title-dot ${loading || researchLoading || compactingChat ? "busy" : "idle"}`} aria-label={loading || researchLoading || compactingChat ? "In lavorazione" : "Pronto"} />
            {specialMode === "ocr"
              ? <div><strong>OCR locale</strong></div>
              : specialMode === "yolo"
                ? <div><strong>Analisi immagine Yolo</strong></div>
                : specialMode === "analyze"
                  ? <div><strong>Analyze</strong></div>
                : specialMode === "agent"
                  ? <div><strong>Agente{agentConfig?.model ? ` · ${agentConfig.model}` : ""}</strong></div>
                : imageConversation
                  ? <div><strong>Qwen Image 2.1</strong></div>
                : <div><strong>{selectedModel?.name ?? "Caricamento modelli"}</strong></div>}
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
            <button className={`brain-mode-button ${webSearchEnabled ? "active" : ""}`} onClick={() => setWebSearchEnabled((enabled) => !enabled)} disabled={loading || brainPrivate || webAvailable === false || specialMode === "agent"} aria-pressed={webSearchEnabled} title={brainPrivate ? "Web bloccato: la conversazione Brain è privata" : webAvailable === false ? "Ricerca Web non disponibile" : webSearchEnabled ? "Ricerca Web attiva" : "Ricerca Web disattivata"}><Globe2 size={18} /><span>Web {webSearchEnabled ? "ON" : "OFF"}</span></button>
            <button className={`brain-mode-button ${brainEnabled ? "active" : ""}`} onClick={() => setBrainMode(!brainEnabled)} disabled={loading || specialMode === "agent"} aria-pressed={brainEnabled} title={brainEnabled ? "I documenti Brain vengono consultati" : "Brain spento: i documenti non vengono consultati"}><Network className="brain-symbol" size={18} /><span>Brain {brainEnabled ? "ON" : "OFF"}</span></button>
            <button className={`brain-library-button agent-button ${specialMode === "agent" ? "active" : ""}`} onClick={() => openSpecialChat("agent")} disabled={loading} title="Nuova chat Agente"><Bot size={17} /><span>Agente</span></button>
            <button className={`brain-library-button yolo-button ${specialMode === "yolo" ? "active" : ""}`} onClick={() => openSpecialChat("yolo")} disabled={loading} title="Apri una nuova chat YOLO"><YoloIcon /><span>YOLO</span></button>
            <button className={`brain-library-button analyze-button ${specialMode === "analyze" ? "active" : ""}`} onClick={() => openSpecialChat("analyze")} disabled={loading} title="Analizza immagini con Qwen3-VL"><Eye size={17} /><span>Analyze</span></button>
            <button className={`brain-library-button image-button ${specialMode === "image" ? "active" : ""}`} onClick={() => openSpecialChat("image")} disabled={loading} title="Crea immagini con Qwen-Image-2.1"><Image size={17} /><span>Image</span></button>
            <button className={`brain-library-button video-button ${specialMode === "video" ? "active" : ""}`} onClick={() => openSpecialChat("video")} disabled={loading} title="Trascrivi un video o un link YouTube"><Clapperboard size={17} /><span>Video</span></button>
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
            {renderWelcome(specialMode, audioWelcomeMode)}
             </div>
           ) : (
            <div className="message-list">
              {messages.map((message, messageIndex) => message.welcomeCard ? <div key={message.id} className="welcome-stage message-welcome-card">{message.welcomeCard === "transcribe" || message.welcomeCard === "record" ? renderWelcome("normal", message.welcomeCard) : renderWelcome(specialModes.includes(message.welcomeCard as SpecialMode) ? message.welcomeCard as SpecialMode : "normal", "none")}</div> : (
                <article key={message.id} className={`message ${message.role}${message.agent ? " agent-message" : ""}`}>
                  <div className="message-avatar">{message.role === "user" ? <img src="/cetriolo.png" alt="Tu" /> : <img src="/andreagpt-logo-128.png" alt="AndreaGPT" />}</div>
                  <div className="message-content">
                    <div className="message-meta">{message.role === "user" ? "Tu" : specialMode === "ocr" ? "OCR locale" : specialMode === "yolo" ? "YOLO locale" : specialMode === "analyze" ? "Analyze" : specialMode === "image" ? "Qwen-Image-2.1" : specialMode === "convert" ? "Conversione locale" : message.agent ? <>Agente{message.agent.model && <span className="message-meta-detail">· {message.agent.model}</span>}{message.agent.writable?.length ? <span className="message-meta-detail">· {message.agent.writable.join(", ")}</span> : null}</> : message.modelName ?? selectedModel?.name}{message.role === "assistant" && message.modelProvider && <span className="message-model-provider">{message.modelProvider}</span>}{message.webSearch && <span className="web-search-badge"><Globe2 size={10} /> Web</span>}{message.pending?.detail && <span className="message-meta-detail">· {message.pending.detail}</span>}{message.pending && loading && <span className="message-meta-detail">· <ElapsedTime startedAt={message.pending.startedAt} /></span>}</div>
                    {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
                    {message.generatedImage && <a className="generated-image" href={message.generatedImage.url} download={message.generatedImage.name} title="Scarica immagine"><img src={message.generatedImage.url} alt={message.content || "Immagine generata"} /></a>}
                    {message.generatedFile?.data && <button type="button" className="generated-file-download" onClick={() => downloadConverted(message.generatedFile!)}><Download size={16} /> Scarica {message.generatedFile.name}</button>}
                    {message.audio?.status === "transcribing" && !message.content && <div className="audio-chat-status" role="status" aria-live="polite"><AudioCassette playing /><div><strong>Sto trascrivendo audio</strong><span>{message.audio.fileName}</span></div></div>}
                    {message.agent ? <Suspense fallback={<div className="thinking"><span /><span /><span /></div>}><AgentRun view={message.agent} answer={message.content} active={message.id === agentLiveId} logsOpen={Boolean(openMessagePanels[message.id]?.logs)} onChange={(update) => updateAgentMessage(message.id, update)} onReply={!loading && messageIndex === messages.length - 1 ? (text) => void processAgent(text) : undefined} /></Suspense> : message.content ? specialMode === "ocr" && message.role === "assistant" && !message.content.startsWith("Elaborazione OCR") ? <div className="ocr-result-editor"><textarea value={message.content} onChange={(event) => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, content: event.target.value } : item))} aria-label="Modifica risultato OCR" /><div className="ocr-result-actions"><button onClick={() => saveTextResult(message.content, "risultato-ocr.txt")}>Salva risultato</button></div></div> : <Suspense fallback={<p>{message.content}</p>}><MarkdownMessage content={message.content} privateMode={Boolean(brainPrivate || message.brainPrivate)} /></Suspense> : message.audio?.status === "transcribing" || message.pending ? null : message.role === "assistant" ? brainEnabled ? <div className="thinking">Ricerca nelle fonti Brain…</div> : <div className="thinking"><span /><span /><span /></div> : null}
                    {message.pending && (loading ? <PendingWork {...message.pending} /> : <p className="pending-stopped">Elaborazione interrotta.</p>)}
                    {message.resultImages?.length ? <ResultImages images={message.resultImages} /> : null}
                    {message.role === "assistant" && !message.generatedImage && message.content.startsWith("ComfyUI ·") && <a className="comfy-progress-link" href={comfyBrowserUrl()} target="_blank" rel="noreferrer">Apri ComfyUI</a>}
                    {message.resultFiles?.length ? <div className="result-files">{message.resultFiles.map((file) => <a key={file.url} className="generated-file-download" href={file.url} download={file.name}><Download size={16} /> {file.name.split(".").pop()?.toUpperCase()}</a>)}</div> : null}
                    {message.content && <div className="message-footer"><div className="message-actions"><button type="button" onClick={() => void copyMessage(message)} title={copiedMessageId === message.id ? "Testo copiato" : "Copia il testo"} aria-label={copiedMessageId === message.id ? "Testo copiato" : "Copia il testo"}><Copy size={14} /></button><button type="button" onClick={() => editAndResend(message)} title="Modifica e invia" aria-label="Modifica e invia"><Pencil size={14} /></button>{message.agent?.done && <button type="button" className={`agent-logs-button${openMessagePanels[message.id]?.logs ? " active" : ""}`} aria-expanded={Boolean(openMessagePanels[message.id]?.logs)} onClick={() => toggleMessagePanel(message.id, "logs")} title="Logs" aria-label="Logs"><ScrollText size={14} /></button>}{message.video?.status === "complete" && <button type="button" onClick={() => void askVideo({ transcript: message.content })} disabled={loading} title="Riassumi" aria-label="Riassumi"><Sparkles size={14} /></button>}</div>
                    {diagnosticsEnabled && message.brainSources && <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.brain)} onClick={() => toggleMessagePanel(message.id, "brain")}>{openMessagePanels[message.id]?.brain ? "▼" : "▶"} Fonti Brain ({message.brainSources.length})</button>}
                    {diagnosticsEnabled && message.webSources && <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.web)} onClick={() => toggleMessagePanel(message.id, "web")}>{openMessagePanels[message.id]?.web ? "▼" : "▶"} Fonti Web ({message.webSources.length})</button>}
                    {message.outputNotes?.map((note) => <button key={note.name} type="button" className="citation-toggle output-note-toggle" onClick={() => openOutputNote(note)}><Folder size={13} /> Apri in Output{message.outputNotes!.length > 1 ? ` · ${note.name.replace(/\.md$/i, "").replace(/^\d+-/, "")}` : ""}</button>)}
                                        {message.logs?.length ? <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.logs)} onClick={() => toggleMessagePanel(message.id, "logs")}>{openMessagePanels[message.id]?.logs ? "▼" : "▶"} Logs</button> : null}
                    {message.generatedImage && <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.image)} onClick={() => toggleMessagePanel(message.id, "image")}>{openMessagePanels[message.id]?.image ? "▼" : "▶"} Dettagli immagine</button>}
                    {diagnosticsEnabled && message.metrics && <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.metrics)} onClick={() => toggleMessagePanel(message.id, "metrics")}>{openMessagePanels[message.id]?.metrics ? "▼" : "▶"} Tempi</button>}
                    {diagnosticsEnabled && message.diagnostics && <button type="button" className="citation-toggle diagnostics-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.diagnostics)} onClick={() => toggleMessagePanel(message.id, "diagnostics")}>{openMessagePanels[message.id]?.diagnostics ? "▼" : "▶"} Log ({message.diagnostics.events.filter(event => event.status === "warning" || event.status === "error").length})</button>}
                    {diagnosticsEnabled && message.role === "assistant" && (message.tokenTrace || hasAffinity(message)) ? <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.semantic)} onClick={() => toggleMessagePanel(message.id, "semantic")} title="Parole su cui il modello era incerto e risposte alternative">{openMessagePanels[message.id]?.semantic ? "▼" : "▶"} Semantic</button> : null}
                    {diagnosticsEnabled && message.role === "assistant" && message.brainSources?.length ? <button type="button" className="citation-toggle" aria-expanded={Boolean(openMessagePanels[message.id]?.shap)} onClick={() => void openShap(message, messageIndex)} title="Quanto ogni parola della domanda ha guidato la scelta delle fonti">{openMessagePanels[message.id]?.shap ? "▼" : "▶"} Shap</button> : null}
                    {diagnosticsEnabled && openMessagePanels[message.id]?.semantic && !message.tokenTrace && <div className="citation-panel token-panel"><p className="token-summary"><AffinityScore message={message} /></p></div>}
                    {diagnosticsEnabled && openMessagePanels[message.id]?.semantic && message.tokenTrace && <TokenConfidencePanel lead={hasAffinity(message) ? <><AffinityScore message={message} /> · </> : null} trace={message.tokenTrace} branches={message.tokenBranches} branching={branchingMessage === message.id} onBranch={(at, token, from, to) => void branchFrom(message, at, token, from, to)} onComplete={(prefix) => completeWord(message, prefix)} />}
                    {diagnosticsEnabled && openMessagePanels[message.id]?.shap && (message.shap ? <ShapPanel shap={message.shap} /> : <div className="citation-panel"><p>{shapLoading === message.id ? "Calcolo SHAP: un embedding per ogni combinazione di parole…" : "SHAP non disponibile."}</p></div>)}
                    {diagnosticsEnabled && message.brainSources && openMessagePanels[message.id]?.brain && <div className="citation-panel">{message.brainSources.length ? message.brainSources.map((source) => <div key={source.id}><button type="button" className="brain-source-link" onClick={() => setCiteOpen({ ...parseCitation(source.source), text: source.text })} title="Apri il documento sul tratto citato"><strong>[{source.id}] {source.source}</strong></button><span className="brain-feedback source-feedback" aria-label={`Valuta la fonte ${source.id}`}><button className={message.sourceFeedback?.[source.source] === 1 ? "active" : ""} type="button" onClick={() => void rateBrainSource(message, messageIndex, source.source, 1)} title="Fonte giusta per questa domanda: sale per domande simili" aria-label="Fonte giusta"><ThumbsUp size={13} /></button><button className={message.sourceFeedback?.[source.source] === -1 ? "active negative" : ""} type="button" onClick={() => void rateBrainSource(message, messageIndex, source.source, -1)} title="Fonte sbagliata per questa domanda: scende per domande simili" aria-label="Fonte sbagliata"><ThumbsDown size={13} /></button></span><p>{source.text}</p></div>) : <p>Nessuna fonte pertinente trovata nell'indice.</p>}</div>}
                    {diagnosticsEnabled && message.webSources && openMessagePanels[message.id]?.web && <div className="citation-panel web-citations">{message.webSources.length ? message.webSources.map((source) => <div key={source.source}><strong>[{source.source}] <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></strong><p>{source.excerpt}</p></div>) : <p>Nessuna fonte Web datata e verificabile trovata.</p>}</div>}
                    {message.logs?.length && openMessagePanels[message.id]?.logs ? <div className="citation-panel message-logs">{message.logs.map((line, index) => <p key={index}>{line}</p>)}</div> : null}
                    {message.generatedImage && openMessagePanels[message.id]?.image && <div className="citation-panel image-details"><p>Modello: {message.generatedImage.model ?? "Qwen/Qwen-Image-2.1"}<br />Formato: {message.generatedImage.width}×{message.generatedImage.height}<br />Seed: {message.generatedImage.seed}<br />Dispositivo: {message.generatedImage.device ?? "xpu"}<br />File: {message.generatedImage.output}</p></div>}
                    {diagnosticsEnabled && message.metrics && openMessagePanels[message.id]?.metrics && <div className="citation-panel metrics-citations"><p>
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
            {voce.attiva && <div className="audio-status voice-status" role="status" aria-live="polite"><span className={voce.fase === "ascolto" ? "recording-dot" : "voice-dot"} /><strong>{voce.fase === "ascolto" ? "Ascolto" : voce.fase === "parla" ? "Parla" : "Penso"}</strong>{voce.parziale && <span className="voice-text">{voce.parziale}</span>}</div>}
            {(recording || transcribing) && <div className="audio-status" role="status"><span className={recording ? "recording-dot" : ""} />{recording ? "Sto registrando audio" : "Sto trascrivendo audio"}</div>}
            {activeOperation && !activeOperation.inline && <div className="operation-status" role="status" aria-live="polite"><span className="operation-pulse" /><span><strong>{activeOperation.label} · {formatElapsed(operationSeconds)}</strong><small>{activeOperation.detail}</small></span></div>}
            {attachments.length > 0 && <AttachmentList attachments={attachments} removable onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} />}
            {brainSource && <div className="mention-filter-chip" title="Filtro Brain attivo: la ricerca è limitata a questa fonte. Rimuovilo per cercare in tutto l'archivio."><span><span>@</span>{brainSource}</span><button type="button" onClick={() => setBrainSource("")} aria-label="Rimuovi filtro fonte Brain"><X size={14} /></button></div>}
            <div className="composer-row">
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                multiple
                accept={specialMode === "ocr" ? "image/*,.pdf" : specialMode === "video" ? VIDEO_ACCEPT : specialMode === "yolo" || specialMode === "analyze" ? "image/*" : specialMode === "normal" ? "image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.sql,.yaml,.yml,.log,.sh,.ps1,audio/*,.aac,.flac,.m4a,.mp3,.mpeg,.mp4,.ogg,.wav,.webm" : "image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.sql,.yaml,.yml,.log,.sh,.ps1"}
                onChange={(event) => void addAttachments(event.target.files ?? [])}
              />
              <input ref={videoInputRef} className="file-input" type="file" accept={VIDEO_ACCEPT} onChange={event => { const file = event.target.files?.[0]; if (file) void transcribeVideo({ file }); }} />
              <input ref={audioInputRef} className="file-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac,.aac" onChange={event => { const audio = event.target.files?.[0]; if (audio) void transcribeAudio(audio); }} />
              <div className="composer-tools" ref={composerToolsRef}><button className={`attach-button tools-toggle ${composerToolsOpen ? "active" : ""}`} onClick={() => setComposerToolsOpen((open) => !open)} aria-expanded={composerToolsOpen} aria-haspopup="menu" aria-label="Apri strumenti" title="Strumenti"><Settings2 size={18} /></button>{composerToolsOpen && <div className="composer-tools-menu" role="menu">
                <button onClick={() => { setComposerToolsOpen(false); fileInputRef.current?.click(); }} disabled={loading || attachments.length >= MAX_ATTACHMENTS || specialMode === "agent"}><Paperclip size={17} /><span>Allega file</span></button>
                <button onClick={() => void compactCurrentChat()} disabled={loading || compactingChat || messages.filter(message => message.content.trim()).length === 0}><Archive size={17} /><span>{compactingChat ? "Compatto…" : "Compatta chat"}</span></button>
                {specialMode === "yolo" && <button onClick={() => { setComposerToolsOpen(false); setYoloLiveOpen(true); }}><Camera size={17} /><span>YOLO live</span></button>}
                {specialMode === "normal" && <><button onClick={() => openAudioWelcome("transcribe")} disabled={loading || recording || transcribing}><AudioLines size={17} /><span>Trascrivi audio</span></button><button className={recording ? "active" : ""} onClick={() => openAudioWelcome("record")} disabled={loading || transcribing}><Mic size={17} /><span>{recording ? "Termina registrazione" : "Registra audio"}</span></button>
                <button className={voce.attiva ? "active" : ""} onClick={() => { setComposerToolsOpen(false); voce.toggle(); }} disabled={!voce.supportata || !selectedModel || recording || transcribing} aria-pressed={voce.attiva} title={voce.supportata ? undefined : "Non supportata da questo browser"}><AudioLines size={17} /><span>Modalità audio {voce.attiva ? "ON" : "OFF"}</span></button>
                <button className={webSearchEnabled ? "active" : ""} onClick={() => setWebSearchEnabled((enabled) => !enabled)} disabled={loading || brainPrivate || webAvailable === false}><Globe2 size={17} /><span>Web {webSearchEnabled ? "ON" : "OFF"}</span></button><button onClick={() => { setComposerToolsOpen(false); openSpecialChat("ocr"); }} disabled={loading}><ScanLine size={17} /><span>OCR</span></button><button onClick={() => { setComposerToolsOpen(false); openSpecialChat("yolo"); }} disabled={loading}><YoloIcon /><span>YOLO</span></button><button onClick={() => { setComposerToolsOpen(false); setYoloLiveOpen(true); }}><Camera size={17} /><span>YOLO live</span></button><button className={brainEnabled ? "active" : ""} onClick={() => setBrainMode(!brainEnabled)} disabled={loading}><Network size={17} /><span>Brain {brainEnabled ? "ON" : "OFF"}</span></button></>}
              </div>}</div>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => updateChatInput(event.target.value, (event.nativeEvent as InputEvent).isComposing)}
                onCompositionEnd={(event) => updateChatInput(event.currentTarget.value)}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (!files.length) return;
                  event.preventDefault();
                  void addAttachments(files);
                }}
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
              {loading ? <button className="send-button stop" onClick={stopGeneration} aria-label="Ferma generazione"><Square size={15} fill="currentColor" /></button> : <button className="send-button" onClick={() => void sendMessage()} disabled={!/^[\\/]chat$/i.test(input.trim()) && ((!input.trim() && !attachments.length) || (specialMode === "normal" && !selectedModel) || (specialMode === "image" && !imageService.ready))} aria-label="Invia"><Send size={18} /></button>}
            </div>
          </div>
        </footer>
      </main>

      {yoloLiveOpen && <YoloLive onClose={() => setYoloLiveOpen(false)} />}

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
        <Modal title="Informazioni modello" className="fit-modal" onClose={() => setDetailsOpen(false)}>
          <div className="model-detail-head"><span className="provider-avatar large">{selectedModel.provider[0].toUpperCase()}</span><div><h2>{selectedModel.name}</h2><code>{selectedModel.id}</code></div></div>
          <p className="detail-description">{selectedModel.description}</p>
          <dl className="detail-grid"><div><dt>Provider</dt><dd>{selectedModel.provider}</dd></div><div><dt>Contesto</dt><dd>{selectedModel.context ?? "Vedi model card"}</dd></div></dl>
          <div className="tag-list">{selectedModel.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          {!isOllama && <a className="external-link" href={selectedModel.providerId === "openrouter" ? `https://openrouter.ai/${selectedModel.id}` : `https://build.nvidia.com/${selectedModel.id}`} target="_blank" rel="noreferrer">Apri la model card ↗</a>}
        </Modal>
      )}

      {fotoOpen && <Modal title="Foto" className="fit-modal foto-modal" headerSlot="foto-modal-actions" wide closeOnBackdrop={false} onClose={() => setFotoOpen(false)}><Suspense fallback={<div className="thinking">Caricamento…</div>}><FotoPanel /></Suspense></Modal>}
      {socialOpen && <Modal title="Social" className="fit-modal" wide onClose={() => setSocialOpen(false)}><Suspense fallback={<div className="thinking">Caricamento…</div>}><SocialPanel /></Suspense></Modal>}
      {codeOpen && <Modal title="Code" className="fit-modal code-modal" wide onClose={() => setCodeOpen(false)}><Suspense fallback={<div className="thinking">Caricamento…</div>}><CodePanel /></Suspense></Modal>}
      {citeOpen && <Modal title="Archivio Brain" className="brain-archive-modal" wide onClose={() => setCiteOpen(null)}><Suspense fallback={<div className="thinking">Apro il documento…</div>}><BrainDocumentReader source={citeOpen.source} focus={citeOpen} backLabel="Torna alla chat" onBack={() => setCiteOpen(null)} /></Suspense></Modal>}
      {brainOpen && <Modal title="Archivio Brain" className="brain-archive-modal" headerSlot="brain-modal-actions" wide onClose={() => { setBrainOpen(false); void refreshBrainPaths(); }}><Suspense fallback={<div className="thinking">Caricamento archivio…</div>}><BrainPanel showInfo={false} locked={loading} source={brainSource} onSource={setBrainSource} onClose={() => { setBrainOpen(false); void refreshBrainPaths(); }} onOpenGraph={() => { setBrainOpen(false); setBrainGraphOpen(true); }} onOpenEmbedding={() => { setBrainOpen(false); setEmbeddingOpen(true); }} /></Suspense></Modal>}
      {outputOpen && !compactOpen && <Modal title="Output" className="output-modal fit-modal" wide={Boolean(outputFolder)} compact={!outputFolder} onClose={() => { setOutputOpen(false); setOutputFolder(null); }}><div className="output-sections">{!outputFolder ? <div className="output-folders">{([ ["images", "Immagini generate", Image], ["ocr", "OCR", FileText], ["news", "News", Newspaper], ["analyze", "Analyze", ScanEye], ["audio", "Audio", AudioLines], ["compactChat", "Chat compatte", Archive] ] as const).map(([folder, title, Icon]) => <button key={folder} className="output-folder" onClick={() => setOutputFolder(folder)}><Icon size={28} /><strong>{title}</strong><small>{outputFiles[folder].length} risultati</small></button>)}</div> : <section className="output-section"><button className="output-back" onClick={() => setOutputFolder(null)}>← Tutte le cartelle</button><h3>{outputFolderLabel[outputFolder]}</h3>{outputFolder === "news" ? <div className="output-results">{researchLoading && <div className="output-result"><button type="button" className="output-result-open" onClick={() => { setOutputOpen(false); setOutputFolder(null); setResearchOpen(true); }}><span className="output-file-icon"><span className="operation-pulse" /></span><span><strong>In corso · {formatElapsed(researchSeconds)}</strong><small>{researchProgress ? `${researchProgress.done}/${researchProgress.total} articoli` : "Ricerca fonti…"}</small><em>{researchResult?.label || "—"}</em></span></button></div>}{outputFiles.news.length ? outputFiles.news.map(file => <div key={file.name} className="output-result"><button type="button" className="output-result-open" disabled={researchLoading} onClick={() => void openSavedEdition(file.name)}><span className="output-file-icon"><Newspaper size={22} /></span><span><strong>{({ ai: "AI News", papers: "Paper scientifici", science: "Scienza e Curiosità" } as Record<string, string>)[file.name.match(/-news-(\w+)\.md$/)?.[1] ?? ""] ?? file.name}</strong><small>{new Date(file.updatedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</small><em>{file.excerpt?.replace(/^.*?Data:\s*\S+\s*/, "") || "—"}</em></span></button><button className="output-delete" onClick={() => setOutputDelete({ folder: "News", name: file.name })}>Elimina</button></div>) : !researchLoading && <p>Nessun risultato.</p>}</div> : outputFolder === "analyze" || outputFolder === "audio" ? <div className="output-results">{outputFiles[outputFolder].length ? outputFiles[outputFolder].map(file => { const folder = outputFolder === "analyze" ? "Analyze" as const : "Audio" as const; return <div key={file.name} className="output-result"><button type="button" className="output-result-open" onClick={() => setCompactOpen({ folder, name: file.name })}>{file.thumb ? <img src={file.thumb} alt="" /> : outputFolder === "audio" ? <span className="output-file-icon"><AudioLines size={22} /></span> : null}<span><strong>{file.name.replace(/\.md$/i, "").replace(/^[\dTZ-]+-(?=.)/, "")}</strong><small>{new Date(file.updatedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</small><em>{file.excerpt || "—"}</em></span></button><button className="output-delete" onClick={() => setOutputDelete({ folder, name: file.name })}>Elimina</button></div>; }) : <p>Nessun risultato.</p>}</div> : <div className="output-gallery">{outputFiles[outputFolder].length ? outputFiles[outputFolder].map(file => <div key={file.name} className="output-item-wrap">{outputFolder === "compactChat" ? <button type="button" className="output-item" onClick={() => setCompactOpen({ folder: "Compatta_chat", name: file.name })}><span className="output-file-icon"><FileText size={24} /></span><span>{file.name}</span></button> : <a href={file.url} target="_blank" rel="noreferrer" className="output-item">{file.image ? <img src={file.url} alt={file.name} /> : <span className="output-file-icon"><FileText size={24} /></span>}<span>{file.name}</span></a>}<button className="output-delete" onClick={() => setOutputDelete({ folder: outputFolder === "images" ? "Image" : outputFolder === "compactChat" ? "Compatta_chat" : outputFolder.toUpperCase() as "OCR" | "YOLO", name: file.name })}>Elimina</button></div>) : <p>Nessun file disponibile.</p>}</div>}</section>}</div></Modal>}
      {outputOpen && compactOpen && <Modal title={compactOpen.folder === "Compatta_chat" ? "Chat compatta" : compactOpen.folder} className="brain-archive-modal" wide onClose={() => { setCompactOpen(null); setOutputOpen(false); setOutputFolder(null); }}><Suspense fallback={<div className="thinking">Apro il file…</div>}><BrainDocumentReader key={`${compactOpen.folder}/${compactOpen.name}`} source={`OUTPUT/${compactOpen.folder}/${compactOpen.name}`} url={`/api/output/${compactOpen.folder}/${encodeURIComponent(compactOpen.name)}/content`} backLabel="Torna ai risultati" onBack={() => setCompactOpen(null)} image={compactOpen.folder === "Analyze" ? outputFiles.analyze.find(file => file.name === compactOpen.name)?.thumb : undefined} onClose={() => { setCompactOpen(null); setOutputOpen(false); setOutputFolder(null); }} onSave={async content => { const response = await fetch(`/api/output/${compactOpen.folder}/${encodeURIComponent(compactOpen.name)}/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Salvataggio non riuscito."); }} onDelete={() => setOutputDelete({ folder: compactOpen.folder, name: compactOpen.name })} /></Suspense></Modal>}
      {outputDelete && <Modal title="Conferma eliminazione" compact onClose={() => setOutputDelete(null)}><p>Eliminare definitivamente <strong>{outputDelete.name}</strong>?</p><div className="dialog-actions"><button className="secondary-action" onClick={() => setOutputDelete(null)}>Annulla</button><button className="danger-action" onClick={() => { const { folder, name } = outputDelete; void fetch(`/api/output/${folder}/${encodeURIComponent(name)}`, { method: "DELETE" }).then(async response => { if (!response.ok) { const message = (await response.json().catch(() => ({}))).error ?? "Eliminazione non riuscita."; window.alert(message); throw new Error(message); } return fetch("/api/output"); }).then(response => response.json()).then(data => { setOutputFiles(data); setOutputDelete(null); setCompactOpen(current => current?.folder === folder && current.name === name ? null : current); }).catch(() => undefined); }}>Elimina</button></div></Modal>}
      {researchOpen && <Modal
        className={researchFullscreen ? "research-modal-fullscreen" : researchResult?.article ? "research-modal" : "research-initial"}
        compact={!researchResult?.article && !researchFullscreen}
        title={<span className="newspaper-modal-title"><Newspaper size={19} /> Edizione News{researchLoading && researchProgress ? <small className="research-progress">{researchProgress.done}/{researchProgress.total}</small> : null}</span>}
        actions={<>
          {researchLoading && <button className="icon-button" onClick={stopResearch} aria-label="Interrompi" title="Interrompi"><Square size={15} fill="currentColor" /></button>}
          {researchResult?.article && <button className="icon-button" onClick={downloadResearchEdition} aria-label="Scarica giornale" title="Scarica giornale"><Download size={18} /></button>}
          <button className="icon-button" onClick={() => void toggleResearchFullscreen()} aria-label={researchFullscreen ? "Finestra" : "Schermo intero"} title={researchFullscreen ? "Finestra" : "Schermo intero"}>{researchFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>
        </>}
        wide={Boolean(researchResult?.article || researchFullscreen)}
        onClose={() => { setResearchOpen(false); setResearchFullscreen(false); }}
      >
        <div className="research-toolbar">
          <button disabled={researchLoading} className={researchType === "ai" ? "active" : ""} onClick={() => void createResearchEdition("ai")}>AI News</button>
          <button disabled={researchLoading} className={researchType === "papers" ? "active" : ""} onClick={() => void createResearchEdition("papers")}>Paper scientifici</button>
          <button disabled={researchLoading} className={researchType === "science" ? "active" : ""} onClick={() => void createResearchEdition("science")}>Scienza e Curiosità</button>
        </div>
        {researchLoading && !researchResult?.article ? <div className="newspaper-loading" role="status" aria-live="polite"><span className="operation-pulse" /><strong>Operazione attiva · {formatElapsed(researchSeconds)}</strong><span>{researchProgress ? `Redazione articoli · ${researchProgress.total} fonti` : "Ricerca fonti…"}</span></div> : researchResult ? (() => { const pages = researchPages(researchResult.article); const page = Math.min(researchPage, pages.length - 1); return <div className="newspaper-reader"><button className="newspaper-arrow left" aria-label="Pagina precedente" disabled={page === 0} onClick={() => setResearchPage(current => Math.max(0, current - 1))}><ChevronLeft size={25} /></button><article className="newspaper"><div className="newspaper-masthead"><span>ANDREAGPT · EDIZIONE TECNICA</span><small>{researchResult.date ?? new Date().toLocaleDateString("it-IT")}</small></div><Suspense fallback={<p>{pages[page]}</p>}><NewspaperMarkdown content={pages[page]} /></Suspense>{page === pages.length - 1 && researchResult.sources.length > 0 && <footer className="newspaper-sources"><strong>Fonti consultate</strong>{researchResult.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">[{source.id}] {source.title}</a>)}</footer>}<div className="newspaper-page-number">Pagina {page + 1} / {pages.length}</div></article><button className="newspaper-arrow right" aria-label="Pagina successiva" disabled={page === pages.length - 1} onClick={() => setResearchPage(current => Math.min(pages.length - 1, current + 1))}><ChevronRight size={25} /></button></div>; })() : <div className="newspaper-empty"><strong>Scegli un’edizione</strong><span>AndreaGPT userà solo le fonti trovate e produrrà un articolo per fonte.</span></div>}
      </Modal>}
      {renameDialog && <Modal title="Rinomina conversazione" compact onClose={() => setRenameDialog(null)}><label className="dialog-field">Nome conversazione<input autoFocus maxLength={60} value={renameDialog.title} onChange={event => setRenameDialog({ ...renameDialog, title: event.target.value })} /></label><div className="dialog-actions"><button className="secondary-action" onClick={() => setRenameDialog(null)}>Annulla</button><button className="primary-action" onClick={() => { const title = renameDialog.title.trim(); if (title) setConversations(current => current.map(item => item.id === renameDialog.id ? { ...item, title, customTitle: true } : item)); setRenameDialog(null); }}>Salva</button></div></Modal>}
      {embeddingOpen && <Suspense fallback={<div className="thinking">Caricamento EmbeddingSpace…</div>}><EmbeddingSpace onClose={() => setEmbeddingOpen(false)} /></Suspense>}
      {brainGraphOpen && <Suspense fallback={<div className="thinking">Caricamento grafo…</div>}><BrainGraph onClose={() => setBrainGraphOpen(false)} onUse={(source) => { setBrainSource(source); setBrainEnabled(true); setBrainGraphOpen(false); }} /></Suspense>}


      {instructionsOpen && (
        <Modal title="Istruzioni" className="fit-modal" onClose={() => setInstructionsOpen(false)}>
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
        <Modal title="Impostazioni" className="settings-modal fit-modal" onClose={() => setSettingsOpen(false)}>
          <div className="settings-compact">
          <div className="settings-group">
            <div className="settings-label">Tema</div>
            <div className="theme-options">
              {([["cosmic", "Latte Cosmico", "Chiaro · crema"], ["normal", "Normale", "Scuro · lime"], ["tropico", "Tropico", "Scuro · multicolore"]] as const).map(([id, name, hint]) => <button key={id} type="button" className={theme === id ? "active" : ""} onClick={() => setTheme(id)} aria-pressed={theme === id}>
                <span className={`theme-preview ${id}-preview`}><i /><i /><i /></span>
                <span><strong>{name}</strong><small>{hint}</small></span>
                {theme === id && <Check size={15} />}
              </button>)}
            </div>
          </div>
          <AppearanceSettings appearance={appearance} />
          <label className="settings-row settings-toggle"><span>Diagnostica</span><input type="checkbox" checked={diagnosticsEnabled} onChange={event => setDiagnosticsEnabled(event.target.checked)} /></label>
          <details className="settings-row">
            <summary><span>Ricerca nel Brain</span><ChevronDown size={15} /></summary>
            <div className="settings-body">
              <label className="settings-line"><span>Numero di fonti</span><select value={brainSourceCount} onChange={event => setBrainSourceCount(Number(event.target.value))}><option value={0}>Automatico</option>{[1, 2, 3, 5, 8, 10, 12].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
              <label className="settings-line"><span>Reranker</span><input type="checkbox" checked={brainRerank} onChange={event => setBrainRerank(event.target.checked)} /></label>
            </div>
          </details>
          <details className="settings-row">
            <summary><span>Generazione</span><ChevronDown size={15} /></summary>
            <div className="settings-body">
              <label className="settings-line"><span>Temperatura</span><span className="settings-range"><input type="range" min="0" max="2" step="0.1" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })} /><output>{settings.temperature.toFixed(1)}</output></span></label>
              <label className="settings-line"><span>Token massimi</span><input type="number" min="1" max="8192" value={settings.maxTokens} onChange={(event) => setSettings({ ...settings, maxTokens: Math.min(8192, Math.max(1, Number(event.target.value))) })} /></label>
            </div>
          </details>
          <details className="settings-row">
            <summary><span>Modelli locali</span><ChevronDown size={15} /></summary>
            <div className="settings-body">
              <table className="models-table">
                <thead><tr><th>Modello</th><th>Contesto</th><th>Output</th></tr></thead>
                <tbody>
                  {localOllamaModels.map(model => {
                    const profile = { ...defaultOllamaProfile(model), ...ollamaProfiles[model.id] };
                    const extendedOutput = model.id === "qwen3:14b";
                    return <tr key={model.id}>
                      <td title={model.id}>{shortModelName(model)}</td>
                      <td><select aria-label={`Contesto ${model.name}`} value={profile.numCtx} onChange={event => updateOllamaProfile(model, { numCtx: Number(event.target.value) as OllamaProfile["numCtx"] })}><option value={4096}>4096</option><option value={8192}>8192</option></select></td>
                      <td><select aria-label={`Output ${model.name}`} value={profile.maxTokens} onChange={event => updateOllamaProfile(model, { maxTokens: Number(event.target.value) as OllamaProfile["maxTokens"] })}><option value={256}>256</option><option value={512}>512</option><option value={1024}>1024</option>{extendedOutput && <><option value={2048}>2048</option><option value={4096}>4096</option></>}</select></td>
                    </tr>;
                  })}
                  <tr>
                    <td title="Qwen/Qwen3-VL-2B-Instruct · Analyze">Qwen3-VL 2B</td>
                    <td className="models-na">—</td>
                    <td><select aria-label="Output Qwen3-VL 2B" value={settings.visionMaxTokens ?? 1024} onChange={event => setSettings({ ...settings, visionMaxTokens: Number(event.target.value) as NonNullable<ChatSettings["visionMaxTokens"]> })}><option value={256}>256</option><option value={512}>512</option><option value={1024}>1024</option></select></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
          <details className="settings-row agent-settings">
            <summary><span>Agente</span><ChevronDown size={15} /></summary>
            <div className="settings-body">
              <div className="settings-line"><span>Modello</span><DropUpSelect options={agentModelOptions} value={agentConfig?.model} onChange={(model) => void saveAgentConfig({ model })} /></div>
              <div className="agent-folders">
                {agentConfig?.writable.map((folder) => <div key={folder} className="agent-folder"><code title={folder}>{folder}</code><button type="button" className="icon-button" onClick={() => void saveAgentConfig({ writable: agentConfig.writable.filter((item) => item !== folder) })} aria-label={`Rimuovi ${folder}`}><X size={14} /></button></div>)}
                {agentConfig && !agentConfig.writable.length && <span className="agent-folder-empty">Nessuna cartella scrivibile</span>}
              </div>
              <form className="agent-folder-add" onSubmit={(event) => { event.preventDefault(); const folder = agentFolderDraft.trim().replace(/\\/g, "/").replace(/\/+$/, ""); if (!folder || !agentConfig || agentConfig.writable.includes(folder)) return; void saveAgentConfig({ writable: [...agentConfig.writable, folder] }).then((ok) => { if (ok) setAgentFolderDraft(""); }); }}>
                <input value={agentFolderDraft} onChange={(event) => setAgentFolderDraft(event.target.value)} placeholder="cartella/relativa" aria-label="Cartella scrivibile" disabled={!agentConfig} />
                <button type="submit" className="settings-small-button" disabled={!agentConfig || !agentFolderDraft.trim()}>Aggiungi</button>
              </form>
              {agentConfigError && <p className="agent-settings-error">{agentConfigError}</p>}
            </div>
          </details>
          <LocalModelCookbook models={models} onChoose={(id) => { chooseModel(id); setSettingsOpen(false); }} />
          <button type="button" className="settings-done" onClick={() => setSettingsOpen(false)}>Fatto</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ResultImages({ images }: { images: { url: string; name: string; plain?: string; cutout?: string }[] }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  // Versioni già pronte (senza box, scontornata): i pulsanti scambiano solo l'immagine mostrata.
  const [shownBoxes, setShownBoxes] = useState<Set<string>>(new Set());
  const [cutouts, setCutouts] = useState<Set<string>>(new Set());
  const toggle = (set: (update: (current: Set<string>) => Set<string>) => void, key: string) => set(current => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });
  return <div className="result-images">
    {images.map((image) => {
      const cut = Boolean(image.cutout && cutouts.has(image.url));
      // Di default senza box: la checkbox li mostra.
      const boxes = !image.plain || shownBoxes.has(image.url);
      const shown = cut ? image.cutout! : !boxes && image.plain ? image.plain : image.url;
      return <div key={image.url} className="result-image">
        <button type="button" className={cut ? "cutout" : ""} onClick={() => setPreview({ url: shown, name: image.name })} title={image.name}><img src={shown} alt={image.name} /></button>
        <div className="result-image-actions">
          {image.plain && <label className="welcome-chip"><input type="checkbox" checked={boxes} disabled={cut} onChange={() => toggle(setShownBoxes, image.url)} /> Box</label>}
          {image.cutout && <button type="button" className="welcome-chip" onClick={() => toggle(setCutouts, image.url)}>{cut ? "Mostra sfondo" : "Rimuovi sfondo"}</button>}
          <a className="welcome-chip" href={shown} download={`${image.name.replace(/\.[^.]+$/, "")}${cut ? "-scontornata.png" : !boxes && image.plain ? "-senza-box.jpg" : "-yolo.jpg"}`}><Download size={15} /> Scarica</a>
        </div>
      </div>;
    })}
    {preview && <ImageLightbox src={preview.url} name={preview.name} onClose={() => setPreview(null)} />}
  </div>;
}

function AttachmentList({ attachments, removable = false, onRemove }: { attachments: ChatAttachment[]; removable?: boolean; onRemove?: (id: string) => void }) {
  const [preview, setPreview] = useState<ChatAttachment | null>(null);
  return <div className={`attachment-list ${removable ? "pending" : "sent"}`}>
    {attachments.map((attachment) => {
      const viewable = attachment.kind === "image" && Boolean(attachment.dataUrl);
      return (
        <div className={`attachment-card ${attachment.kind} ${viewable ? "viewable" : ""}`} key={attachment.id} title={`${attachment.name} · ${formatFileSize(attachment.size)}`} onClick={viewable ? () => setPreview(attachment) : undefined}>
          {viewable
            ? <img src={attachment.dataUrl} alt={attachment.name} />
            : <span className="attachment-icon">{attachment.kind === "image" ? <Image size={19} /> : <FileText size={19} />}</span>}
          <span className="attachment-copy"><strong>{attachment.name}</strong><small>{attachment.kind === "image" ? "Immagine" : attachment.kind === "pdf" ? "PDF" : "Documento"} · {formatFileSize(attachment.size)}</small></span>
          {removable && <button onClick={(event) => { event.stopPropagation(); onRemove?.(attachment.id); }} aria-label={`Rimuovi ${attachment.name}`}><X size={14} /></button>}
        </div>
      );
    })}
    {preview && <ImageLightbox src={preview.dataUrl!} name={preview.name} onClose={() => setPreview(null)} />}
  </div>;
}

function ImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // portal dentro .app-shell per ereditare il tema; evita ancestor con backdrop-filter che rompono position:fixed
  return createPortal(
    <Modal title={name} className="image-viewer-modal" onClose={onClose}>
      <img src={src} alt={name} />
    </Modal>,
    document.querySelector(".app-shell") ?? document.body,
  );
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

/** Attesa dentro il messaggio: titolo, tempo che scorre e barra animata. */
function PendingWork({ title, image }: { title: string; detail?: string; startedAt: number; image?: string }) {
  return <div className={image ? "pending-work has-image" : "pending-work"} role="status" aria-live="polite">
    <div className="pending-work-head"><strong>{title}</strong></div>
    {image ? <ScanGrid image={image} /> : <div className="pending-work-bar" aria-hidden="true"><span /></div>}
  </div>;
}

/** Immagine in analisi coperta da una griglia 4×4 che si scopre una cella alla volta, poi ricomincia. */
function ScanGrid({ image }: { image: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setStep(current => current >= 16 ? 0 : current + 1), step >= 16 ? 1400 : 170);
    return () => window.clearTimeout(timer);
  }, [step]);
  return <div className="scan-grid" style={{ backgroundImage: `url(${image})` }} aria-hidden="true">
    {Array.from({ length: 16 }, (_, cell) => <i key={cell} className={cell < step - 1 || step >= 16 ? "ok" : cell === step - 1 ? "now" : ""} />)}
  </div>;
}

/** Tempo trascorso, aggiornato ogni secondo (mostrato nella riga meta del messaggio). */
function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  return <time className="elapsed-time">{formatElapsed(Math.max(0, Math.floor((now - startedAt) / 1000)))}</time>;
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

function Modal({ title, onClose, onBack, children, headerSlot, actions, wide = false, compact = false, closeOnBackdrop = true, className = "" }: { title: React.ReactNode; onClose: () => void; onBack?: () => void; children: React.ReactNode; headerSlot?: string; actions?: React.ReactNode; wide?: boolean; compact?: boolean; closeOnBackdrop?: boolean; className?: string }) {
  return <div className={`modal-backdrop${compact ? " compact-backdrop" : ""}`} onClick={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""} ${compact ? "compact-modal" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} onClick={(event) => event.stopPropagation()}><header>{onBack && <button className="modal-back" aria-label="Indietro" onClick={onBack}><ArrowLeft size={17} /></button>}<h2>{title}</h2>{headerSlot && <div id={headerSlot} className="modal-header-slot" />}{actions && <div className="modal-actions">{actions}</div>}<button className="icon-button" aria-label="Chiudi" onClick={onClose}><X size={19} /></button></header><div className="modal-body">{children}</div></section></div>;
}

function loadMessages(): ChatMessage[] {
  try {
    const saved = JSON.parse(localStorage.getItem("andreagpt-messages") ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

const DELETED_CONVERSATIONS_KEY = "andreagpt-deleted-conversations";
const STALE_RELOAD_KEY = "andreagpt-stale-reload";

function reloadStaleTab() {
  try { sessionStorage.setItem(STALE_RELOAD_KEY, "1"); } catch { /* sessione privata */ }
  location.reload();
}

/** ID cancellati: filtrati a ogni lettura e scrittura, così una scheda vecchia non può farli ricomparire. */
function loadDeletedConversationIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(DELETED_CONVERSATIONS_KEY) ?? "[]");
    return new Set<string>(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set<string>();
  }
}

function sendDeletedConversations(ids: string[]) {
  // keepalive: la richiesta parte anche se la pagina viene chiusa subito dopo il clic.
  return fetch("/api/conversations/deleted", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
}

/** Unisce gli ID cancellati del server e del browser; true se il browser ne ha ricevuti di nuovi. */
async function syncDeletedConversations() {
  try {
    const { ids } = await fetch("/api/conversations/deleted").then((response) => response.json() as Promise<{ ids: string[] }>);
    const server = new Set(ids);
    const local = loadDeletedConversationIds();
    const missingOnServer = [...local].filter((id) => !server.has(id));
    if (missingOnServer.length) void sendDeletedConversations(missingOnServer.slice(-1000)).catch(() => undefined);
    const missingLocally = ids.filter((id) => !local.has(id));
    if (!missingLocally.length) return false;
    try { localStorage.setItem(DELETED_CONVERSATIONS_KEY, JSON.stringify([...local, ...missingLocally].slice(-5000))); } catch { /* memoria piena: il filtro in memoria basta per questa sessione */ }
    return true;
  } catch {
    return false;
  }
}

function rememberDeletedConversation(id: string) {
  void sendDeletedConversations([id]).catch(() => undefined);
  const deleted = JSON.stringify([...loadDeletedConversationIds(), id].slice(-5000));
  try { localStorage.setItem(DELETED_CONVERSATIONS_KEY, deleted); return; } catch { /* memoria piena: sotto si libera spazio */ }
  // La cancellazione deve restare salvata anche a memoria piena: via la copia vecchia e gli allegati pesanti.
  try { localStorage.removeItem("andreagpt-messages"); } catch { /* ignora */ }
  try { localStorage.setItem(DELETED_CONVERSATIONS_KEY, deleted); return; } catch { /* ancora piena */ }
  try {
    const stored = JSON.parse(localStorage.getItem("andreagpt-conversations") ?? "[]") as Conversation[];
    localStorage.setItem("andreagpt-conversations", JSON.stringify(stored.filter((conversation) => conversation.id !== id).map((conversation) => ({ ...conversation, messages: withoutHeavyPayloads(conversation.messages) }))));
    localStorage.setItem(DELETED_CONVERSATIONS_KEY, deleted);
  } catch { /* sessione privata */ }
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem("andreagpt-conversations");
    const saved = JSON.parse(raw ?? "[]");
    if (Array.isArray(saved) && saved.length) {
      const deleted = loadDeletedConversationIds();
      return saved.filter((conversation: Conversation) => !deleted.has(conversation.id)).map((conversation: Conversation) => conversation.customTitle ? conversation : {
        ...conversation,
        title: createConversationTitleFromMessages(conversation.messages),
      });
    }
    // Migrazione dal vecchio formato solo se la lista non è mai esistita: una lista svuotata resta vuota.
    if (raw !== null) return [];
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

function persistConversations(allConversations: Conversation[]) {
  const deleted = loadDeletedConversationIds();
  const conversations = allConversations.filter((conversation) => !deleted.has(conversation.id));
  try {
    localStorage.setItem("andreagpt-conversations", JSON.stringify(conversations));
    return;
  } catch { /* memoria piena: sotto le versioni leggere */ }
  try { localStorage.removeItem("andreagpt-messages"); } catch { /* ignora */ }
  try {
    localStorage.setItem("andreagpt-conversations", JSON.stringify(conversations.map((conversation) => ({ ...conversation, messages: withoutAttachmentPayloads(conversation.messages) }))));
    return;
  } catch { /* ancora piena */ }
  localStorage.setItem("andreagpt-conversations", JSON.stringify(conversations.map((conversation) => ({ ...conversation, messages: withoutHeavyPayloads(conversation.messages) }))));
}

/** Ultima riserva: testo dei messaggi sì, allegati e file convertiti no. */
function withoutHeavyPayloads(messages: ChatMessage[]) {
  return withoutAttachmentPayloads(messages).map(({ generatedFile, ...message }) => generatedFile ? { ...message, generatedFile: { ...generatedFile, data: "" } } : message);
}

function withoutAttachmentPayloads(messages: ChatMessage[]) {
  // la traccia dei token resta solo in memoria: pesante e legata a un contesto server temporaneo
  return messages.map(({ tokenTrace: _tokenTrace, tokenBranches: _tokenBranches, ...message }) => ({
    ...message,
    attachments: message.attachments?.map(({ dataUrl: _dataUrl, text: _text, ...attachment }) => attachment),
  }));
}
