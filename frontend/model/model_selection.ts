import type { ModelInfo } from "../types/types";

export function modelForPrivateChat(currentId: string, models: ModelInfo[]): string {
  if (models.some(model => model.id === currentId && model.providerId === "ollama")) return currentId;
  return (models.find(model => model.providerId === "ollama" && model.tags.includes("Veloce"))
    ?? models.find(model => model.providerId === "ollama"))?.id ?? "";
}
