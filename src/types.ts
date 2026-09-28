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
  metrics?: Record<string, number>;
  diagnostics?: DiagnosticTrace;
  diagnosticFeedback?: 1 | -1;
  generatedImage?: { url: string; name: string; width: number; height: number; seed: number; output: string; device?: string; model?: string };
  generatedFile?: { name: string; type: string; data: string };
  audio?: { status: "transcribing" | "complete" | "error"; fileName: string };
}

export interface DiagnosticEvent {
  at: string;
  stage: "request" | "router" | "searchx" | "micelio" | "embedding" | "rag" | "model" | "response";
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
  ollamaMaxTokens?: 256 | 512 | 1024;
}

export interface BrainCitation {
  id: string;
  source: string;
  text: string;
  micelioScore?: number;
}
