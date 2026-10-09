import type { AgentApproval, AgentTranscript } from "./agent";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "pdf" | "text";
  dataUrl?: string;
  text?: string;
}

/** Spiegazione SHAP per parola, calcolata dal backend su richiesta. */
export interface ShapResult { query: string; words: string[]; exact: boolean; evaluations: number; overall: number[]; coveredBy: number[]; findings: string[]; sources: Array<{ source: string; similarity: number; baseline: number; shares: number[]; present: boolean[] }> }

/** Token generato: testo, probabilità della scelta, alternative [testo, probabilità]. */
export type TraceToken = { t: string; p: number; alt: Array<[string, number]> };
/** Probabilità dei token di una risposta; id = contesto lato server per le biforcazioni. */
export type TokenTrace = { id: string; tokens: TraceToken[] };
/** Ramo: risposta ripresa dal token `at` forzando `token`; `from`/`to` = parola scelta e parola alternativa. */
export type TokenBranch = { at: number; from: string; to?: string; token: string; tokens: TraceToken[] };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  modelId?: string;
  modelName?: string;
  modelProvider?: string;
  attachments?: ChatAttachment[];
  webSearch?: boolean;
  webSources?: WebCitation[];
  brainPrivate?: boolean;
  brainSources?: BrainCitation[];
  feedback?: 1 | -1;
  sourceFeedback?: Record<string, 1 | -1>;
  shap?: ShapResult;
  /** Solo in memoria: non salvati con la conversazione. */
  tokenTrace?: TokenTrace;
  tokenBranches?: TokenBranch[];
  metrics?: Record<string, number>;
  diagnostics?: DiagnosticTrace;
  diagnosticFeedback?: 1 | -1;
  generatedImage?: { url: string; name: string; width: number; height: number; seed: number; output: string; device?: string; model?: string };
  generatedFile?: { name: string; type: string; data: string };
  /** Immagini prodotte da uno strumento (es. YOLO annotato), apribili a schermo intero. */
  resultImages?: { url: string; name: string; plain?: string; cutout?: string }[];
  /** File scaricabili prodotti da uno strumento (es. CSV/JSON dei bounding box). */
  resultFiles?: { url: string; name: string }[];
  /** Note salvate in OUTPUT (es. Analyze), apribili dal pulsante "Apri in Output". */
  outputNotes?: { folder: "Analyze"; name: string }[];
  audio?: { status: "transcribing" | "complete" | "error"; fileName: string };
  /** Trascrizione di un video caricato o di un link (chat Video). */
  video?: { status: "transcribing" | "complete" | "error"; name: string; url?: string };
  /** Lavoro in corso mostrato nel messaggio stesso (titolo + tempo che scorre). */
  pending?: { title: string; detail?: string; startedAt: number; image?: string };
  /** Righe tecniche (tempi, modello, dispositivo) mostrate solo dal pulsante Logs. */
  logs?: string[];
  /** Messaggio-segnaposto creato da \chat: card di benvenuto dello strumento della chat (ocr, yolo, transcribe…). */
  welcomeCard?: string;
  /** Trascrizione della chat Agente (piano, passi, approvazioni). */
  agent?: AgentView;
}

/** Approvazione come mostrata in chat: errore dell'ultima azione e annullamento dopo l'applicazione. */
export type AgentApprovalView = AgentApproval & { error?: string; undone?: boolean };
/** AgentTranscript del contratto + cartelle scrivibili ricevute in "start" e stato locale delle approvazioni. */
export type AgentView = Omit<AgentTranscript, "approvals"> & { approvals: AgentApprovalView[]; writable?: string[] };

export interface DiagnosticEvent {
  at: string;
  stage: "request" | "router" | "searchx" | "semantic" | "embedding" | "rag" | "model" | "response";
  status: "ok" | "warning" | "error" | "info";
  message: string;
  durationMs?: number;
  details?: Record<string, string | number | boolean | null>;
}

export interface DiagnosticTrace { requestId: string; events: DiagnosticEvent[] }

export interface WebCitation {
  source: number;
  title: string;
  url: string;
  excerpt: string;
}

export interface Conversation {
  id: string;
  title: string;
  customTitle?: boolean;
  /** Strumento della chat (yolo, ocr, analyze…): resta valido anche se la chat viene rinominata. */
  mode?: string;
  brainPrivate?: boolean;
  messages: ChatMessage[];
  modelId: string;
  updatedAt: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerId?: "nvidia" | "openrouter" | "ollama";
  description: string;
  tags: string[];
  context?: string;
  featured?: boolean;
}

export interface TaskPreset {
  id: string;
  name: string;
  shortName: string;
  description: string;
  prompt: string;
  icon: string;
  suggestedModel?: string;
}

export interface ChatSettings {
  temperature: number;
  maxTokens: number;
  numCtx?: 4096 | 8192;
  ollamaMaxTokens?: 256 | 512 | 1024 | 2048 | 4096;
  visionMaxTokens?: 256 | 512 | 1024;
}

export interface BrainCitation {
  id: string;
  source: string;
  text: string;
}
