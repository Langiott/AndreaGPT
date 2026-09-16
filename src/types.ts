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
  attachments?: ChatAttachment[];
  webSearch?: boolean;
  brainPrivate?: boolean;
  brainSources?: BrainCitation[];
  metrics?: Record<string, number>;
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
}
