export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  customTitle?: boolean;
  messages: ChatMessage[];
  modelId: string;
  updatedAt: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
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
}
