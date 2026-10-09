/**
 * Configurazione dell'Agente: modello Ollama e cartelle scrivibili, salvate in data/tools/agent/config.json.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentConfig } from "../../frontend/types/agent";
import { AgentError, parseRelative } from "./agent_workspace";

export const DEFAULT_AGENT_CONFIG: AgentConfig = { model: "qwen3:14b", writable: ["fake"] };
const configFile = (toolsRoot: string) => path.join(toolsRoot, "agent", "config.json");

/** Valida le cartelle scrivibili: relative, senza "..", non vietate, massimo 20, senza doppioni. */
export function validateWritable(list: unknown): string[] {
  if (!Array.isArray(list)) throw new AgentError("writable deve essere un elenco.");
  const result = [...new Set(list.map(entry => {
    try { return parseRelative(entry).join("/"); }
    catch (error) { throw new AgentError(`Cartella scrivibile non valida "${String(entry)}": ${error instanceof Error ? error.message : ""}`); }
  }))];
  if (result.length > 20) throw new AgentError("Massimo 20 cartelle scrivibili.");
  return result;
}

export function validateModel(model: unknown): string {
  if (typeof model !== "string" || !/^[\w.:/-]{1,200}$/.test(model)) throw new AgentError("Modello non valido.");
  return model;
}

/** Legge la configurazione; file assente o rovinato = predefinita. */
export async function loadAgentConfig(toolsRoot: string): Promise<AgentConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(configFile(toolsRoot), "utf8")) as Partial<AgentConfig>;
    return { model: validateModel(raw.model ?? DEFAULT_AGENT_CONFIG.model), writable: validateWritable(raw.writable ?? DEFAULT_AGENT_CONFIG.writable) };
  } catch { return { ...DEFAULT_AGENT_CONFIG, writable: [...DEFAULT_AGENT_CONFIG.writable] }; }
}

/** Aggiorna e salva la configurazione (scrittura atomica). */
export async function saveAgentConfig(toolsRoot: string, patch: Partial<AgentConfig>): Promise<AgentConfig> {
  const current = await loadAgentConfig(toolsRoot);
  const next: AgentConfig = {
    model: patch.model === undefined ? current.model : validateModel(patch.model),
    writable: patch.writable === undefined ? current.writable : validateWritable(patch.writable),
  };
  const file = configFile(toolsRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2));
  await fs.rename(temp, file);
  return next;
}
